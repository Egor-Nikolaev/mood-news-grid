// Извлечение фактов из текста и проверка, что они сохранились после переписывания.
// Идея: тон меняем, но "твёрдые" факты (числа, даты, деньги, проценты, имена
// собственные, цитаты) должны остаться дословно. Это и есть контроль галлюцинаций.

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December|" +
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

// Стоп-слова, чтобы не тащить в "имена" начала предложений и служебные слова.
const STOP = new Set([
  "The", "A", "An", "This", "That", "These", "Those", "It", "He", "She", "They",
  "We", "You", "I", "But", "And", "Or", "If", "In", "On", "At", "For", "To",
  "Of", "With", "As", "By", "From", "After", "Before", "While", "When", "Where",
  "There", "Here", "His", "Her", "Their", "Its", "Our", "Your", "My", "New",
  "Mr", "Ms", "Mrs", "Dr",
]);

function uniq(arr) {
  return [...new Set(arr)];
}

// Числа, проценты, деньги, годы. Нормализуем к строкам для точного сравнения.
function extractNumbers(text) {
  const out = [];
  // деньги: $5, £3.2bn, €10 million
  for (const m of text.matchAll(/[$£€]\s?\d[\d,.]*\s?(?:bn|billion|m|million|k|thousand|trillion|tn)?/gi)) {
    out.push(m[0].replace(/\s+/g, " ").trim());
  }
  // проценты
  for (const m of text.matchAll(/\d[\d,.]*\s?%|\d[\d,.]*\s?per\s?cent/gi)) {
    out.push(m[0].replace(/\s+/g, "").replace(/percent/i, "%"));
  }
  // любые числа с разделителями (в т.ч. годы, счёт, количества)
  for (const m of text.matchAll(/\b\d[\d,.]*\b/g)) {
    out.push(m[0]);
  }
  return uniq(out);
}

function extractDates(text) {
  const out = [];
  for (const m of text.matchAll(new RegExp(`\\b(?:${MONTHS})\\b\\.?(?:\\s+\\d{1,2})?(?:,?\\s+\\d{4})?`, "gi"))) {
    out.push(m[0].replace(/\s+/g, " ").trim());
  }
  for (const m of text.matchAll(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi)) {
    out.push(m[0]);
  }
  for (const m of text.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    out.push(m[0]);
  }
  return uniq(out);
}

// Имена собственные: последовательности слов с заглавной буквы (Joe Biden, United Nations).
function extractNames(text) {
  const out = [];
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) {
    out.push(m[1]);
  }
  // одиночные заглавные слова (страны/организации/аббревиатуры), кроме стоп-слов и начала предложения
  for (const m of text.matchAll(/(?:[.!?]\s+|^)?\b([A-Z][a-zA-Z]{2,})\b/g)) {
    const w = m[1];
    if (STOP.has(w)) continue;
    out.push(w);
  }
  // аббревиатуры целиком капсом: UN, NASA, EU
  for (const m of text.matchAll(/\b([A-Z]{2,})\b/g)) {
    out.push(m[1]);
  }
  return uniq(out);
}

function extractQuotes(text) {
  const out = [];
  for (const m of text.matchAll(/[“"]([^”"]{4,})[”"]/g)) {
    out.push(normalize(m[1]));
  }
  return uniq(out);
}

function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Полный набор фактов документа.
export function extractFacts(text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return {
    numbers: extractNumbers(clean),
    dates: extractDates(clean),
    names: extractNames(clean),
    quotes: extractQuotes(clean),
  };
}

// Проверка: все ли факты оригинала присутствуют в переписанном тексте.
// Возвращает { ok, violations: [{type, value}], preserved, total }.
export function verifyFacts(originalFacts, rewrittenText) {
  const rewritten = rewrittenText || "";
  const rewrittenNorm = normalize(rewritten);
  const violations = [];
  let total = 0;
  let preserved = 0;

  const checkExact = (type, values) => {
    for (const v of values) {
      total++;
      // числа/даты/имена ищем как подстроку без учёта регистра и лишних пробелов
      if (rewrittenNorm.includes(normalize(v))) preserved++;
      else violations.push({ type, value: v });
    }
  };

  checkExact("number", originalFacts.numbers);
  checkExact("date", originalFacts.dates);
  checkExact("name", originalFacts.names);

  // цитаты проверяем мягче: допускаем, что кавычки могли переставить,
  // но само содержимое цитаты (>= 4 символов) должно встречаться дословно
  for (const q of originalFacts.quotes) {
    total++;
    if (rewrittenNorm.includes(q)) preserved++;
    else violations.push({ type: "quote", value: q });
  }

  return { ok: violations.length === 0, violations, preserved, total };
}
