import Parser from "rss-parser";
import { FEEDS } from "./feeds.js";
import { extractFacts } from "./facts.js";
import { upsertArticle, countArticles } from "./db.js";

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
