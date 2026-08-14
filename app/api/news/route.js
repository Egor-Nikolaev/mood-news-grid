import { listArticles } from "../../../lib/db.js";

export const dynamic = "force-dynamic";

// Список новостей для грида. Факты отдаём распарсенными, чтобы фронт мог показать счётчик.
export async function GET() {
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
