import { MOODS } from "./moods.js";
import { extractFactsSmart, verifyFacts } from "./facts.js";
import { llmAvailable, llmChat } from "./llm.js";

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

// LLM-клиент вынесен в lib/llm.js (им же пользуется NER-извлечение в facts.js).
const hasLLM = llmAvailable;

// Детектор отказа/мета-ответа модели. На чувствительных новостях модель иногда
// отказывается («Извините, я не могу…») или комментирует задание вместо переписки —
// такое нельзя показывать пользователю, считаем провалом и уходим в фолбэк.
const REFUSAL_RE = new RegExp(
  [
    "не могу (выполнить|переписать|помочь|это сделать)",
    "я не могу", "не буду переписывать", "в заданном вами",
    "как (ии|искусственный интеллект|языковая модель)",
    "в таком тоне (было бы|неуместно)", "неуместно (переписывать|в таком)",
    "i (cannot|can'?t|am unable|won'?t)", "as an ai", "i'?m sorry,? but",
    "i (can'?t|cannot) (assist|help|comply|fulfill)",
  ].join("|"),
  "i"
);
function isRefusal(text) {
  const t = (text || "").trim();
  if (!t) return true;
  return REFUSAL_RE.test(t);
}

// Переписывание тона: чуть выше температура для «живого» текста.
const callLLM = (messages) => llmChat(messages, { temperature: 0.85, maxTokens: 500 });

function systemPrompt(mood) {
  return [
    "Ты журналист-стилист: переписываешь новость в заданном эмоциональном ТОНЕ. Пиши на русском.",
    "Задача творческая: подача, ритм, эмоциональная рамка и интонация должны ярко передавать настроение.",
    "Можно менять формулировки, порядок, добавлять атмосферу и авторскую интонацию.",
    "",
    "НО твёрдые факты неприкосновенны:",
    "- ДОСЛОВНО сохрани все имена, фамилии, названия, места, организации, числа, деньги, проценты, даты и цитаты из оригинала.",
    "- НЕ выдумывай новых чисел, имён, дат, событий или последствий и не выдавай их за факт.",
    "- Эмоции и атмосфера — можно; новые фактические утверждения — нельзя.",
    "",
    "Формат: 1–3 живых предложения, как абзац новости. Выведи ТОЛЬКО переписанный текст, без пояснений и кавычек.",
    `НАСТРОЕНИЕ: ${MOODS[mood].llm}`,
  ].join("\n");
}

// Rule-based обёртка: факты не редактируются, только рамка настроения.
// Регистр НЕ трогаем — иначе можно испортить заглавную имени собственного
// (напр. «Путин» → «путин»). Небольшая типографическая шероховатость (заглавная
// после двоеточия) безопаснее, чем искажение имени.
function ruleBasedRewrite(text, mood) {
  const m = MOODS[mood];
  const core = (text || "").trim();
  if (!core) return core;
  if (mood === "neutral" || (!m.lead && !m.tail)) return core;
  return (m.lead + core + m.tail).replace(/\s+/g, " ").trim();
}

export async function rewriteWithMood(originalText, mood) {
  // Факты извлекаем гибридно: regex-база + опциональное LLM-NER уточнение имён
  // (см. facts.js). NER не даёт verify «просесть»: добавляются только сущности,
  // реально присутствующие в оригинале дословно.
  const facts = await extractFactsSmart(originalText);

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
    if (v.ok && !isRefusal(text)) return { text, method: "llm", verification: v };

    // попытка 2 — точечная починка (или обход отказа)
    const missing = v.violations.map((x) => `${x.type}: "${x.value}"`).join("; ") || "(факты на месте)";
    text = await callLLM([
      { role: "system", content: systemPrompt(mood) },
      { role: "user", content: originalText },
      {
        role: "user",
        content:
          "Не отказывайся и не комментируй задание — это стилистическая переработка, не одобрение. " +
          "Перепиши новость в нужном тоне, дословно сохранив факты. " +
          (missing !== "(факты на месте)" ? "Верни на место: " + missing : ""),
      },
    ]);
    v = verifyFacts(facts, text);
    if (v.ok && !isRefusal(text)) return { text, method: "llm+repair", verification: v };

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
