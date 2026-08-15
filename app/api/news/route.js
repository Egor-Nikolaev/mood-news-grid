import { listArticles, getRewrite } from "../../../lib/db.js";
import { ensureSeeded } from "../../../lib/ingest.js";
import { textKey } from "../../../lib/facts.js";
import { MOOD_KEYS } from "../../../lib/moods.js";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // запас на первый ingest из RSS

// Список новостей для грида. К каждой прикладываем готовые переписки всех настроений
// из кэша (если есть) — чтобы грид переключал тон мгновенно, без похода в LLM.
export async function GET() {
  await ensureSeeded();
  const rows = listArticles().map((a) => {
    const key = textKey(a.summary);
    const moods = {};
    for (const m of MOOD_KEYS) {
      const r = getRewrite(key, m);
      if (r) moods[m] = { text: r.text, method: r.method, verified: Boolean(r.verified) };
    }
    return {
      id: a.id,
      source: a.source,
      source_url: a.source_url,
      title: a.title,
      summary: a.summary,
      published_at: a.published_at,
      facts: JSON.parse(a.facts_json),
      moods, // {mood: {text, method, verified}} — то, что уже есть в кэше
    };
  });
  return Response.json({ count: rows.length, articles: rows });
}
