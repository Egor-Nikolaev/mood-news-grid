import { MOODS } from "./moods.js";
import { extractFacts, verifyFacts } from "./facts.js";

// Переписывание тона с гарантией сохранения фактов.
//
// Стратегия (по убыванию приоритета):
//   1. LLM (OpenRouter free-модель), строгий промпт "меняй только тон, факты дословно".
//   2. LLM-ответ проверяем verifyFacts(). Если факт потерян — одна попытка "починки"
//      с явным списком, что вернуть на место.
//   3. Если LLM недоступен или после починки всё ещё врёт — rule-based обёртка,
//      которая факты не трогает by design (verified всегда true).
//
// Возвращает { text, method, verification }.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function hasLLM() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callLLM(messages) {
  const model = process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
  // Бесплатные модели часто отвечают 429/503 (общий лимит провайдера) —
  // делаем пару ретраев с паузой, прежде чем сдаться и уйти в фолбэк.
  const maxAttempts = Number(process.env.OPENROUTER_MAX_ATTEMPTS) || 3;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(1200 * attempt);
    let res;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "X-Title": "Mood News Grid",
        },
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 500 }),
      });
    } catch (e) {
      lastErr = e;
      continue; // сетевой сбой — ретрай
    }
    if (res.status === 429 || res.status === 503) {
      lastErr = new Error(`OpenRouter ${res.status} (rate-limited)`);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    let text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("OpenRouter: пустой ответ");
    // некоторые модели оборачивают ответ в кавычки/маркдаун — чистим
    text = text.replace(/^```[a-z]*\n?|\n?```$/g, "").trim();
    return text;
  }
  throw lastErr || new Error("OpenRouter: не удалось получить ответ");
}

function systemPrompt(mood) {
  return [
    "You rewrite a news item in a specific emotional TONE.",
    "HARD RULES — this is a fact-preservation task, not a creative one:",
    "- Do NOT add, remove, or change any fact: names, places, organisations, numbers, money, percentages, dates, and quoted phrases must appear verbatim.",
    "- Do NOT invent new facts or consequences.",
    "- Only change wording, framing and emotional colour.",
    "- Keep it roughly the same length. Output ONLY the rewritten text, no preamble.",
    `TONE: ${MOODS[mood].llm}`,
  ].join("\n");
}

// Rule-based обёртка: факты не редактируются, только рамка настроения.
function ruleBasedRewrite(text, mood) {
  const m = MOODS[mood];
  const core = (text || "").trim();
  if (mood === "neutral" || (!m.lead && !m.tail)) return core;
  // первую букву ядра делаем строчной, чтобы lead склеился грамматично
  const joined = m.lead + core.charAt(0).toLowerCase() + core.slice(1);
  return (joined + m.tail).replace(/\s+/g, " ").trim();
}

export async function rewriteWithMood(originalText, mood) {
  const facts = extractFacts(originalText);

  // neutral без ключа = исходник как есть (тон и так нейтральный)
  if (!hasLLM()) {
    const text = ruleBasedRewrite(originalText, mood);
    return { text, method: "rule-based", verification: verifyFacts(facts, text) };
  }

  try {
    // попытка 1
    let text = await callLLM([
      { role: "system", content: systemPrompt(mood) },
      { role: "user", content: originalText },
    ]);
    let v = verifyFacts(facts, text);
    if (v.ok) return { text, method: "llm", verification: v };

    // попытка 2 — точечная починка с указанием пропавших фактов
    const missing = v.violations.map((x) => `${x.type}: "${x.value}"`).join("; ");
    text = await callLLM([
      { role: "system", content: systemPrompt(mood) },
      { role: "user", content: originalText },
      {
        role: "user",
        content:
          "Your rewrite dropped or altered these facts. Rewrite again in the same tone, " +
          "restoring every one of them VERBATIM: " + missing,
      },
    ]);
    v = verifyFacts(facts, text);
    if (v.ok) return { text, method: "llm+repair", verification: v };

    // LLM всё ещё врёт — падаем на детерминированный фолбэк
    const safe = ruleBasedRewrite(originalText, mood);
    return { text: safe, method: "rule-based(fallback)", verification: verifyFacts(facts, safe) };
  } catch (err) {
    // сеть/лимит/нет модели — тоже фолбэк, приложение не падает
    const safe = ruleBasedRewrite(originalText, mood);
    return {
      text: safe,
      method: "rule-based(fallback)",
      verification: verifyFacts(facts, safe),
      note: String(err.message || err),
    };
  }
}
