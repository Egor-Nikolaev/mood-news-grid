import Parser from "rss-parser";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { FEEDS } from "./feeds.js";
import { extractFacts, textKey } from "./facts.js";
import { upsertArticle, countArticles, saveRewrite } from "./db.js";

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

// Фильтр чувствительных тем: война, насилие, жертвы, катастрофы. Переписывать такие
// новости «радостно» морально-этически неуместно — не берём их в ленту вовсе.
// Аббревиатуры — с Unicode-границами (\b на кириллице не работает), чтобы «ВСУ/СВО/БПЛА»
// ловились, но «свой/свои» — нет. Остальное — стемами (границы не нужны).
const SENSITIVE_STEMS = [
  "войн", "военн", "фронт", "обстрел", "наступлени", "беспилотник", "ракет", "снаряд",
  "взрыв", "теракт", "террор", "погиб", "жертв", "ранен", "убит", "убийств", "расстрел",
  "смерт", "гибел", "катастроф", "крушени", "насили", "изнасил", "суицид", "самоуб",
  "мобилизац", "ядерн", "боевик", "заложник", "пытк", "миномёт", "минобороны", "оккупац",
  "штурм", "пострадавш", "удар по", "атаков", "атаки", "атака", "дрон",
  "мертв", "мёртв", "скончал", "умерл", "утонул", "трагед", "трагич", "погром",
];
const SENSITIVE_RE = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:всу|сво|бпла|вс\\s?рф)(?![\\p{L}\\p{N}])" +
    "|(?:" + SENSITIVE_STEMS.join("|") + ")",
  "iu"
);
function isSensitive(text) {
  return SENSITIVE_RE.test((text || "").toLowerCase());
}

// Ёмкая сводка: 1–2 предложения, до ~320 символов, обрез по границе предложения.
// Короткий текст даёт более чистую и «панчевую» переписку под настроение.
function trimSummary(s, max = 320) {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastEnd > 80) return cut.slice(0, lastEnd + 1).trim();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim() + "…";
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
    if (a.rewrites) {
      const key = textKey(a.summary);
      for (const [mood, r] of Object.entries(a.rewrites)) {
        saveRewrite({
          text_key: key,
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
        const summary = trimSummary(stripHtml(item.contentSnippet || item.content || item.summary || ""));
        const title = stripHtml(item.title || "");
        if (!title || summary.length < 20) continue; // мусор/пустышки пропускаем
        if (isSensitive(`${title} ${summary}`)) continue; // война/насилие/жертвы — не берём

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
