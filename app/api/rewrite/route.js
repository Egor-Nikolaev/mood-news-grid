import { getArticle, getRewrite, saveRewrite } from "../../../lib/db.js";
import { rewriteWithMood } from "../../../lib/rewrite.js";
import { isMood } from "../../../lib/moods.js";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // запас на ретраи LLM

// Переписать новость под настроение.
//
// Источник текста: фронт присылает сам текст новости (`text`), поэтому эндпоинт не
// зависит от id статьи. Это важно на serverless (Vercel), где каждый инстанс держит
// свою эфемерную /tmp-базу и autoincrement id между инстансами может разойтись.
//
// Кэш (article_id + mood) — best-effort: работает, если статья есть в базе этого
// инстанса; иначе просто пропускаем кэш, результат от этого не меняется.
export async function POST(req) {
  const { articleId, text, source_url, mood, force } = await req.json().catch(() => ({}));

  if (!isMood(mood)) {
    return Response.json({ error: "Некорректный mood" }, { status: 400 });
  }

  const article = articleId ? getArticle(articleId) : null;
  const originalText = text || article?.summary;
  const srcUrl = source_url || article?.source_url || null;

  if (!originalText) {
    return Response.json({ error: "Нет текста новости для переписки" }, { status: 400 });
  }

  // отдать из кэша, если он есть на этом инстансе
  if (!force && article) {
    const cached = getRewrite(article.id, mood);
    if (cached) {
      return Response.json({
        cached: true,
        original: originalText,
        source_url: srcUrl,
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

  const result = await rewriteWithMood(originalText, mood);

  // кэшируем только при наличии строки статьи (FK на articles.id)
  if (article) {
    saveRewrite({
      article_id: article.id,
      mood,
      text: result.text,
      method: result.method,
      verified: result.verification.ok ? 1 : 0,
      violations_json: JSON.stringify(result.verification.violations),
      created_at: new Date().toISOString(),
    });
  }

  return Response.json({
    cached: false,
    original: originalText,
    source_url: srcUrl,
    mood,
    text: result.text,
    method: result.method,
    verification: result.verification,
    note: result.note,
  });
}
