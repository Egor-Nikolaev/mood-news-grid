// Определения настроений: инструкция для LLM + rule-based обёртка на случай без ключа.
// Rule-based НЕ переписывает факты, а оборачивает исходный текст рамкой настроения
// и точечно подкручивает вводные слова. Так факты сохраняются by design.

export const MOODS = {
  neutral: {
    label: "Нейтрально",
    emoji: "⚖️",
    llm: "Neutral, factual newswire tone. No emotional colouring, no opinion.",
    lead: "",
    tail: "",
  },
  joyful: {
    label: "Радостно",
    emoji: "😄",
    llm: "Upbeat, warm, optimistic tone. Frame the same facts in a hopeful, encouraging light.",
    lead: "Great news — ",
    tail: " Honestly, there's a lot to feel good about here.",
  },
  sad: {
    label: "Грустно",
    emoji: "😔",
    llm: "Sombre, melancholic tone. Frame the same facts as heavy and disheartening.",
    lead: "Sadly, ",
    tail: " It's hard not to feel the weight of it.",
  },
  ironic: {
    label: "Иронично",
    emoji: "😏",
    llm: "Dry, ironic, lightly sarcastic tone. Wry framing, but never invent or drop facts.",
    lead: "Well, of course — ",
    tail: " Who could possibly have seen that coming.",
  },
  anxious: {
    label: "Тревожно",
    emoji: "😟",
    llm: "Anxious, worried tone. Frame the same facts as concerning and uncertain.",
    lead: "Worryingly, ",
    tail: " It's hard not to wonder what comes next.",
  },
};

export const MOOD_KEYS = Object.keys(MOODS);

export function isMood(m) {
  return Object.prototype.hasOwnProperty.call(MOODS, m);
}
