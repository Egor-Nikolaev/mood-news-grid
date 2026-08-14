import { getArticle, getRewrite, saveRewrite } from "../../../lib/db.js";
import { rewriteWithMood } from "../../../lib/rewrite.js";
import { isMood } from "../../../lib/moods.js";

export const dynamic = "force-dynamic";

// Переписать конкретную новость под настроение. Результат кэшируется в базе:
// повторный запрос той же пары (article, mood) отдаётся мгновенно, без похода в LLM.
export async function POST(req) {
  const { articleId, mood, force } = await req.json().catch(() => ({}));

  if (!articleId || !isMood(mood)) {
    return Response.json({ error: "Нужны валидные articleId и mood" }, { status: 400 });
  }

  const article = getArticle(articleId);
  if (!article) return Response.json({ error: "Новость не найдена" }, { status: 404 });

  if (!force) {
    const cached = getRewrite(articleId, mood);
    if (cached) {
      return Response.json({
        cached: true,
        original: article.summary,
        source_url: article.source_url,
        mood,
        text: cached.text,
        method: cached.method,
        verification: {
          ok: Boolean(cached.verified),
          violations: JSON.parse(cached.violations_json),
        },
      });
    }
  }

  const result = await rewriteWithMood(article.summary, mood);

  saveRewrite({
    article_id: articleId,
    mood,
    text: result.text,
    method: result.method,
    verified: result.verification.ok ? 1 : 0,
    violations_json: JSON.stringify(result.verification.violations),
    created_at: new Date().toISOString(),
  });

  return Response.json({
    cached: false,
    original: article.summary,
    source_url: article.source_url,
    mood,
    text: result.text,
    method: result.method,
    verification: result.verification,
    note: result.note,
  });
}
