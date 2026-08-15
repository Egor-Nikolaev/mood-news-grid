import Parser from "rss-parser";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { FEEDS } from "./feeds.js";
import { extractFacts } from "./facts.js";
import { upsertArticle, countArticles, getArticleByGuid, saveRewrite } from "./db.js";

// Тянем реальные новости из RSS, чистим, извлекаем факты и кладём в базу.
const parser = new Parser({ timeout: 15000 });

function stripHtml(s) {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Загрузка офлайн-снапшота (data/seed.json): реальные новости + запечённые переписки.
// Даёт мгновенный первый экран на serverless без сетевого запроса к RSS и без
// похода в лимитированный LLM (переписки берутся из кэша).
function loadSeed() {
  const seedPath = path.join(process.cwd(), "data", "seed.json");
  if (!existsSync(seedPath)) return 0;
  let seed;
  try {
    seed = JSON.parse(readFileSync(seedPath, "utf8"));
  } catch {
    return 0;
  }
  let n = 0;
  for (const a of seed.articles || []) {
    const facts = a.facts || extractFacts(`${a.title}. ${a.summary}`);
    const added = upsertArticle({
      guid: a.guid,
      source: a.source,
      source_url: a.source_url,
      title: a.title,
      summary: a.summary,
      published_at: a.published_at || null,
      fetched_at: a.fetched_at || new Date(0).toISOString(),
      facts_json: JSON.stringify(facts),
    });
    if (!added) continue;
    n++;
    const row = getArticleByGuid(a.guid);
    if (row && a.rewrites) {
      for (const [mood, r] of Object.entries(a.rewrites)) {
        saveRewrite({
          article_id: row.id,
          mood,
          text: r.text,
          method: r.method,
          verified: r.verified ? 1 : 0,
          violations_json: JSON.stringify(r.violations || []),
          created_at: new Date(0).toISOString(),
        });
      }
    }
  }
  return n;
}

// Досеивание при пустой базе (нужно на эфемерном serverless, где /tmp сбрасывается).
// Сначала мгновенный снапшот, если его нет — живой RSS. Гонки не критичны:
// upsert по уникальному guid отсекает дубли.
let _seeding = null;
export async function ensureSeeded() {
  if (countArticles() > 0) return { seeded: false, total: countArticles() };
  const fromSeed = loadSeed();
  if (fromSeed > 0) return { seeded: true, source: "seed", total: countArticles() };
  if (!_seeding) {
    _seeding = ingestAll().finally(() => {
      _seeding = null;
    });
  }
  const res = await _seeding;
  return { seeded: true, source: "rss", total: res.total };
}

export async function ingestAll({ perFeed } = {}) {
  const limit = perFeed || Number(process.env.INGEST_PER_FEED) || 8;
  let added = 0;
  const report = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      let feedAdded = 0;
      for (const item of (parsed.items || []).slice(0, limit)) {
        const summary = stripHtml(item.contentSnippet || item.content || item.summary || "");
        const title = stripHtml(item.title || "");
        if (!title || summary.length < 20) continue; // мусор/пустышки пропускаем

        const guid = item.guid || item.link;
        const ok = upsertArticle({
          guid,
          source: feed.source,
          source_url: item.link || guid,
          title,
          summary,
          published_at: item.isoDate || item.pubDate || null,
          fetched_at: new Date().toISOString(),
          facts_json: JSON.stringify(extractFacts(`${title}. ${summary}`)),
        });
        if (ok) {
          added++;
          feedAdded++;
        }
      }
      report.push({ source: feed.source, added: feedAdded });
    } catch (err) {
      report.push({ source: feed.source, error: String(err.message || err) });
    }
  }

  return { added, total: countArticles(), report };
}
