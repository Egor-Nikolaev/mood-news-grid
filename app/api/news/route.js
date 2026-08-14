import { listArticles } from "../../../lib/db.js";
import { ensureSeeded } from "../../../lib/ingest.js";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // запас на первый ingest из RSS

// Список новостей для грида. Факты отдаём распарсенными, чтобы фронт мог показать счётчик.
export async function GET() {
  // на пустой базе (первый заход / холодный старт на serverless) — сидим сами
  await ensureSeeded();
  const rows = listArticles().map((a) => ({
    id: a.id,
    source: a.source,
    source_url: a.source_url,
    title: a.title,
    summary: a.summary,
    published_at: a.published_at,
    facts: JSON.parse(a.facts_json),
  }));
  return Response.json({ count: rows.length, articles: rows });
}
