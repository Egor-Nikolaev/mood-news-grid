import { getRewrite, saveRewrite } from "../../../lib/db.js";
import { rewriteWithMood } from "../../../lib/rewrite.js";
import { isMood } from "../../../lib/moods.js";
import { textKey } from "../../../lib/facts.js";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // запас на ретраи LLM

// Переписать новость под настроение. Кэш адресуется ХЭШОМ текста новости (textKey),
// поэтому чужую переписку показать невозможно, и не важно, с какого инстанса/id пришёл запрос.
export async function POST(req) {
  const { text, source_url, mood, force } = await req.json().catch(() => ({}));

  if (!isMood(mood)) {
    return Response.json({ error: "Некорректный mood" }, { status: 400 });
  }
  if (!text || !text.trim()) {
    return Response.json({ error: "Нет текста новости для переписки" }, { status: 400 });
  }

  const key = textKey(text);

  if (!force) {
    const cached = getRewrite(key, mood);
    if (cached) {
      return Response.json({
        cached: true,
        original: text,
        source_url: source_url || null,
        mood,
        text: cached.text,
        method: cached.method,
        verification: { ok: Boolean(cached.verified), violations: JSON.parse(cached.violations_json) },
      });
    }
  }

  const result = await rewriteWithMood(text, mood);

  saveRewrite({
    text_key: key,
    mood,
    text: result.text,
    method: result.method,
    verified: result.verification.ok ? 1 : 0,
    violations_json: JSON.stringify(result.verification.violations),
    created_at: new Date().toISOString(),
  });

  return Response.json({
    cached: false,
    original: text,
    source_url: source_url || null,
    mood,
    text: result.text,
    method: result.method,
    verification: result.verification,
    note: result.note,
  });
}
