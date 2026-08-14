// Извлечение фактов из текста и проверка, что они сохранились после переписывания.
// Тон меняем, но "твёрдые" факты (числа, даты, деньги, проценты, имена собственные,
// цитаты) должны остаться дословно. Это и есть контроль галлюцинаций LLM.
//
// ВАЖНО: все regex на Unicode-классах (\p{Lu}/\p{Ll}/\p{L} с флагом u), иначе
// кириллица не ловится — \w и \b в JS по умолчанию только для латиницы/цифр.

// Частые слова с заглавной (начало предложения / служебные), которые не имена.
const STOP = new Set([
  // ru
  "Как", "Что", "Это", "Этот", "Эта", "Он", "Она", "Они", "Мы", "Вы", "Но", "Или",
  "Если", "По", "На", "Во", "За", "Из", "От", "До", "Для", "При", "После", "Под",
  "Также", "Тогда", "Там", "Здесь", "Его", "Её", "Их", "Наш", "Ваш", "Мой", "Новый",
  "Ранее", "Сейчас", "Сегодня", "Вчера", "Завтра", "Более", "Менее", "Около", "Почти",
  "Однако", "Между", "Через", "Кроме", "Против", "Среди", "Свои", "Весь", "Все", "Всё",
  // en
  "The", "A", "An", "This", "That", "It", "He", "She", "They", "We", "You",
  "But", "And", "Or", "If", "In", "On", "At", "For", "To", "Of", "With", "As", "By",
  "From", "After", "Before", "New", "Mr", "Ms", "Mrs", "Dr",
]);

const uniq = (arr) => [...new Set(arr)];
const trimEdges = (s) => s.replace(/^[\s.,;:]+|[\s.,;:]+$/g, "");

// --- числа, деньги, проценты, годы ---
function extractNumbers(text) {
  const out = [];
  // деньги: $5, ₽100, 5 млрд руб, 10 млн долларов, €9 млн
  for (const m of text.matchAll(
    /[$£€₽]\s?\d[\d\s.,]*|\d[\d\s.,]*\s?(?:млрд|млн|тыс|трлн)\.?(?:\s?(?:руб\p{Ll}*|долл\p{Ll}*|евро|₽|\$|€))?|\d[\d\s.,]*\s?(?:руб\p{Ll}*|долл\p{Ll}*|евро|₽)/giu
  )) {
    out.push(trimEdges(m[0].replace(/\s+/g, " ")));
  }
  // проценты
  for (const m of text.matchAll(/\d[\d.,]*\s?%|\d[\d.,]*\s?процент\p{Ll}*/giu)) {
    out.push(trimEdges(m[0].replace(/\s+/g, " ")));
  }
  // любые числа (годы, счёт, количества) — без хвостовых разделителей
  for (const m of text.matchAll(/\d[\d.,]*\d|\d/gu)) {
    out.push(m[0]);
  }
  return uniq(out.filter(Boolean));
}

// --- даты ---
const MONTHS_RU =
  "январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр";
const MONTHS_EN =
  "January|February|March|April|May|June|July|August|September|October|November|December|" +
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

function extractDates(text) {
  const out = [];
  // «12 августа 2024», «в марте»
  for (const m of text.matchAll(
    new RegExp(`(?:\\d{1,2}\\s+)?(?:${MONTHS_RU})\\p{Ll}*(?:\\s+\\d{4})?`, "giu")
  )) {
    out.push(trimEdges(m[0].replace(/\s+/g, " ")));
  }
  for (const m of text.matchAll(
    new RegExp(`(?:${MONTHS_EN})\\.?(?:\\s+\\d{1,2})?(?:,?\\s+\\d{4})?`, "giu")
  )) {
    out.push(trimEdges(m[0].replace(/\s+/g, " ")));
  }
  // дни недели (полные формы с типичными окончаниями)
  for (const m of text.matchAll(
    /(?:понедельник|вторник|сред[ауы]|четверг|пятниц[ауеы]|суббот[ауеы]|воскресень[ея])/giu
  )) {
    out.push(m[0]);
  }
  // годы
  for (const m of text.matchAll(/(?:19|20)\d{2}(?:\s?год\p{Ll}*|\s?г\.)?/giu)) {
    out.push(trimEdges(m[0].replace(/\s+/g, " ")));
  }
  return uniq(out.filter(Boolean));
}

// --- имена собственные (кириллица + латиница) ---
function extractNames(text) {
  const out = [];
  // «Дональд Трамп», «Соединённых Штатов», «United Nations» — мультислово почти всегда имя
  for (const m of text.matchAll(/\p{Lu}\p{Ll}+(?:[-\s]\p{Lu}\p{Ll}+)+/gu)) {
    out.push(m[0].replace(/\s+/g, " "));
  }
  // одиночная заглавная В СЕРЕДИНЕ предложения (после строчной/цифры/кавычки/скобки).
  // Заглавная в начале предложения неоднозначна (может быть обычным словом), её пропускаем —
  // это осознанный размен в сторону точности, чтобы не плодить ложные «искажения».
  for (const m of text.matchAll(
    /(?<=[\p{Ll}0-9»”"')\-],?\s)\p{Lu}\p{Ll}{2,}/gu
  )) {
    if (!STOP.has(m[0])) out.push(m[0]);
  }
  // аббревиатуры капсом: НАТО, США, ООН, UN, NASA
  for (const m of text.matchAll(/\p{Lu}{2,}/gu)) {
    out.push(m[0]);
  }
  // дедуп: убираем одиночные слова, которые уже входят в мультислово-имя
  // («Егор» при наличии «Егор Корнев»), чтобы не раздувать счётчик фактов
  const all = uniq(out);
  const multi = all.filter((n) => /[\s-]/.test(n));
  return all.filter((n) => {
    if (/[\s-]/.test(n)) return true;
    return !multi.some((mw) => mw.split(/[\s-]/).includes(n));
  });
}

// --- цитаты ---
function extractQuotes(text) {
  const out = [];
  // «ёлочки», „лапки", "прямые"
  for (const m of text.matchAll(/[«„“"]([^»“”"]{4,})[»“”"]/gu)) {
    out.push(normalize(m[1]));
  }
  return uniq(out);
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
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
export function verifyFacts(originalFacts, rewrittenText) {
  const rewrittenNorm = normalize(rewrittenText || "");
  const violations = [];
  let total = 0;
  let preserved = 0;

  const check = (type, values) => {
    for (const v of values) {
      total++;
      if (rewrittenNorm.includes(normalize(v))) preserved++;
      else violations.push({ type, value: v });
    }
  };

  check("number", originalFacts.numbers);
  check("date", originalFacts.dates);
  check("name", originalFacts.names);
  check("quote", originalFacts.quotes);

  return { ok: violations.length === 0, violations, preserved, total };
}
