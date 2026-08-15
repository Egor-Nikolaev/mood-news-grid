// Извлечение фактов из текста и проверка, что они сохранились после переписывания.
// Тон меняем, но "твёрдые" факты (числа, даты, деньги, проценты, имена собственные,
// цитаты) должны остаться дословно. Это и есть контроль галлюцинаций LLM.
//
// ВАЖНО: все regex на Unicode-классах (\p{Lu}/\p{Ll}/\p{L} с флагом u), иначе
// кириллица не ловится — \w и \b в JS по умолчанию только для латиницы/цифр.
//
// Имена извлекаются гибридно: быстрый детерминированный regex (база, всегда) плюс
// опциональное LLM-NER уточнение (extractFactsSmart) — модель ловит имена, которые
// эвристика пропускает, но добавляются ТОЛЬКО сущности, реально присутствующие в
// оригинале дословно (фильтр анти-галлюцination), поэтому verify не может «просесть».

import { llmAvailable, llmChat } from "./llm.js";

// Частые слова с заглавной (начало предложения / служебные), которые НЕ имена.
// Нужны, чтобы ловить имя в начале предложения («Зеленский заявил…»), но не тащить
// туда обычные слова («Спрос вырос…», «Власти сообщили…»).
const STOP = new Set([
  // местоимения/союзы/предлоги/наречия
  "Как", "Что", "Чтобы", "Это", "Этот", "Эта", "Эти", "Он", "Она", "Они", "Мы", "Вы",
  "Но", "Или", "Если", "По", "На", "Во", "За", "Из", "От", "До", "Для", "При", "После",
  "Под", "Над", "Также", "Тогда", "Там", "Здесь", "Его", "Её", "Их", "Наш", "Ваш", "Мой",
  "Ранее", "Сейчас", "Сегодня", "Вчера", "Завтра", "Более", "Менее", "Около", "Почти",
  "Однако", "Между", "Через", "Кроме", "Против", "Среди", "Свои", "Весь", "Все", "Всё",
  "Несмотря", "Согласно", "Затем", "Позже", "Теперь", "Только", "Всего", "Уже", "Ещё",
  "Первый", "Второй", "Новый", "Новые", "Вместе", "Именно", "Пока", "Даже",
  // глаголы речи/бытия (частые в начале новости)
  "Сообщается", "Сообщил", "Сообщили", "Заявил", "Заявили", "Отмечается", "Отмечают",
  "Стало", "Стали", "Стал", "Произошло", "Планируется", "Ожидается", "Может", "Могут",
  "Будет", "Будут", "Был", "Была", "Были", "Есть", "Оказалось", "Выяснилось",
  // родовые существительные (не собственные)
  "Власти", "Власть", "Полиция", "Полицейские", "Компания", "Компании", "Президент",
  "Премьер", "Министр", "Министерство", "Правительство", "Суд", "Совет", "Депутат",
  "Депутаты", "Глава", "Группа", "Сотрудники", "Специалисты", "Эксперты", "Эксперт",
  "Жители", "Люди", "Мужчина", "Женщина", "Дети", "Спрос", "Цена", "Цены", "Рынок",
  "Банк", "Курс", "Число", "Количество", "Уровень", "Часть", "Работа", "Система",
  "Данные", "Информация", "Ситуация", "Проект", "Программа", "Закон", "Документ",
  "Решение", "Вопрос", "Дело", "Случай", "Событие", "Авария", "Пожар", "Взрыв", "Удар",
  "Атака", "Видео", "Фото", "Грабители", "Военные", "Депутатов",
  // частые прилагательные-нации (в начале предложения = не имя)
  "Российские", "Российский", "Российская", "Российского", "Украинские", "Украинский",
  "Американские", "Американский", "Европейские", "Европейский",
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
  // одиночная заглавная В СЕРЕДИНЕ предложения (после строчной/цифры/кавычки/скобки) —
  // там заглавная почти всегда имя собственное.
  for (const m of text.matchAll(
    /(?<=[\p{Ll}0-9»”"')\-],?\s)\p{Lu}\p{Ll}{2,}/gu
  )) {
    if (!STOP.has(m[0])) out.push(m[0]);
  }
  // одиночная заглавная В НАЧАЛЕ предложения — берём, только если это не частое обычное
  // слово из STOP (новости часто начинаются с субъекта: «Зеленский заявил…»).
  for (const m of text.matchAll(/(?:^|[.!?…]\s+)(\p{Lu}\p{Ll}{2,})/gu)) {
    if (!STOP.has(m[1])) out.push(m[1]);
  }
  // аббревиатуры капсом: НАТО, США, ООН, UN, NASA
  for (const m of text.matchAll(/\p{Lu}{2,}/gu)) {
    out.push(m[0]);
  }
  return dedupNames(out);
}

// Дедуп имён: убираем одиночные слова, которые уже входят в мультислово-имя
// («Егор» при наличии «Егор Корнев»), чтобы не раздувать счётчик фактов.
function dedupNames(arr) {
  const all = uniq(arr);
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

// Стабильный ключ по содержимому оригинала (FNV-1a). Кэш переписок адресуется
// текстом новости, а не autoincrement id — так исключён показ чужой переписки.
export function textKey(s) {
  const t = normalize(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return "t" + h.toString(36) + "_" + t.length;
}

// Полный набор фактов документа (синхронно, только regex — быстрый путь).
export function extractFacts(text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return {
    numbers: extractNumbers(clean),
    dates: extractDates(clean),
    names: extractNames(clean),
    quotes: extractQuotes(clean),
  };
}

// LLM-NER: извлечение именованных сущностей моделью. Возвращает массив строк.
// Ключевая страховка: оставляем только те сущности, которые ДОСЛОВНО (нормализованно)
// присутствуют в оригинале. Так галлюцинация модели не может добавить факт, которого
// нет в тексте, и, значит, не может сломать верификацию переписок.
export async function extractNamesLLM(text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean || !llmAvailable()) return [];

  const sys =
    "Ты — извлекатель именованных сущностей. Верни из текста все имена собственные: " +
    "людей, организации, географические названия, бренды/продукты, названия событий и турниров. " +
    "Выводи ТОЛЬКО JSON-массив строк, дословно как в тексте (в именительном виде, как встречается), " +
    "без пояснений и markdown. Не добавляй ничего, чего нет в тексте. Если сущностей нет — [].";

  let raw;
  try {
    raw = await llmChat(
      [
        { role: "system", content: sys },
        { role: "user", content: clean },
      ],
      { temperature: 0, maxTokens: 300 }
    );
  } catch {
    return []; // NER — необязательное обогащение; ошибка сети не должна ломать факты
  }

  // Вытаскиваем JSON-массив даже если модель что-то дописала вокруг.
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const haystack = normalize(clean);
  return uniq(
    parsed
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => s.length >= 2)
      // анти-галлюцинация: сущность обязана присутствовать в оригинале дословно
      .filter((s) => haystack.includes(normalize(s)))
  );
}

// Гибридный набор фактов: regex-база + опциональное LLM-NER уточнение имён.
// Если LLM недоступен или LLM_NER=0 — идентичен extractFacts (regex).
// numbers/dates/quotes остаются на regex (надёжны и не требуют модели).
export async function extractFactsSmart(text) {
  const base = extractFacts(text);
  if (!llmAvailable() || process.env.LLM_NER === "0") return base;

  const nerNames = await extractNamesLLM(text);
  if (!nerNames.length) return base;

  return { ...base, names: dedupNames([...base.names, ...nerNames]) };
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
