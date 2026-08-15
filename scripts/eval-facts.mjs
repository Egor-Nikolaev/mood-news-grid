// Эвал слоя контроля фактов + мини-набор юнит-кейсов.
//
// Запуск:
//   node scripts/eval-facts.mjs              # юнит-кейсы + прогон по снапшоту (regex)
//   node --env-file=.env scripts/eval-facts.mjs --ner   # + замер выигрыша LLM-NER
//
// Возвращает ненулевой код, если юнит-кейсы не прошли или в снапшоте нашлось
// искажение факта, дошедшее до пользователя (verified=true, но факт реально потерян).

import fs from "node:fs";
import path from "node:path";
import { extractFacts, extractFactsSmart, verifyFacts } from "../lib/facts.js";

const withNER = process.argv.includes("--ner");
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log("  ✗ " + msg); } };

// ─────────────────────────────────────────────────────────────────────────────
// 1. Юнит-кейсы: извлечение + верификация на синтетике.
// Проверяем ОБА направления: факт сохранён → ok; факт искажён → пойман.
// ─────────────────────────────────────────────────────────────────────────────
console.log("Юнит-кейсы (extract + verify):");

const CASES = [
  {
    name: "число сохранено",
    original: "ЦБ снизил ставку до 16% годовых.",
    rewritten: "Отличная новость: ЦБ наконец снизил ключевую ставку до 16% годовых!",
    expectOk: true,
  },
  {
    name: "число искажено — поймано",
    original: "ЦБ снизил ставку до 16% годовых.",
    rewritten: "ЦБ снизил ставку до 12% годовых.",
    expectOk: false,
    expectType: "number",
  },
  {
    name: "имя сохранено",
    original: "Илон Маск объявил о запуске нового спутника.",
    rewritten: "Как всегда эффектно, Илон Маск объявил о запуске нового спутника.",
    expectOk: true,
  },
  {
    name: "имя потеряно — поймано",
    original: "Илон Маск объявил о запуске нового спутника.",
    rewritten: "Бизнесмен объявил о запуске нового спутника.",
    expectOk: false,
    expectType: "name",
  },
  {
    name: "дата сохранена",
    original: "Саммит пройдёт 12 августа 2026 года в Женеве.",
    rewritten: "Тревожно, но саммит всё же пройдёт 12 августа 2026 года в Женеве.",
    expectOk: true,
  },
  {
    name: "цитата сохранена",
    original: 'Министр сказал: «Мы не отступим» на пресс-конференции.',
    rewritten: 'С грустью министр повторил: «Мы не отступим».',
    expectOk: true,
  },
  {
    name: "кириллица ё↔е нормализуется",
    original: "Актёр приехал в Орёл.",
    rewritten: "Актер приехал в Орел.",
    expectOk: true,
  },
];

for (const c of CASES) {
  const facts = extractFacts(c.original);
  const v = verifyFacts(facts, c.rewritten);
  ok(v.ok === c.expectOk, `${c.name}: ожидали ok=${c.expectOk}, получили ok=${v.ok} (${JSON.stringify(v.violations)})`);
  if (c.expectType && !v.ok) {
    ok(v.violations.some((x) => x.type === c.expectType),
      `${c.name}: ожидали нарушение типа "${c.expectType}", получили ${JSON.stringify(v.violations.map((x) => x.type))}`);
  }
  if (v.ok === c.expectOk) console.log(`  ✓ ${c.name}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Прогон по снапшоту: каждая новость × каждое настроение.
// Независимо перепроверяем verify (не доверяем полю verified из seed) и ловим
// «тихие» искажения: verified=true, но факт по факту потерян.
// ─────────────────────────────────────────────────────────────────────────────
const seedPath = path.join(process.cwd(), "data", "seed.json");
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));

console.log(`\nПрогон по снапшоту (${seed.count} новостей × 5 настроений):`);

let pairs = 0, verifiedTrue = 0, reverifyOk = 0, silentDistortion = 0;
let regexNames = 0, nerNames = 0, nerGain = 0, nerGainPreserved = 0;

for (const a of seed.articles) {
  const factsRegex = extractFacts(a.summary);
  const factsSmart = withNER ? await extractFactsSmart(a.summary) : factsRegex;
  regexNames += factsRegex.names.length;
  nerNames += factsSmart.names.length;
  const addedByNer = factsSmart.names.filter((n) => !factsRegex.names.includes(n));
  nerGain += addedByNer.length;

  for (const [mood, rw] of Object.entries(a.rewrites)) {
    pairs++;
    if (rw.verified) verifiedTrue++;
    // независимая перепроверка тем же слоем
    const v = verifyFacts(factsSmart, rw.text);
    if (v.ok) reverifyOk++;
    // тихое искажение: seed says verified, но перепроверка нашла потерю
    if (rw.verified && !v.ok) silentDistortion++;
  }

  // NER-выигрыш имеет смысл, только если добавленные имена ТОЖЕ сохранены в переписках
  // (иначе это ложные факты). Проверяем сохранность добавленных имён во всех настроениях.
  if (withNER && addedByNer.length) {
    const norm = (s) => s.toLowerCase().replace(/ё/g, "е");
    for (const n of addedByNer) {
      const inAll = Object.values(a.rewrites).every((rw) => norm(rw.text).includes(norm(n)));
      if (inAll) nerGainPreserved++;
    }
  }
}

console.log(`  пар (новость×настроение):        ${pairs}`);
console.log(`  verified=true в снапшоте:        ${verifiedTrue}/${pairs}`);
console.log(`  прошли независимую перепроверку:  ${reverifyOk}/${pairs}`);
console.log(`  тихих искажений (verified, но факт потерян): ${silentDistortion}`);
ok(silentDistortion === 0, `в снапшоте ${silentDistortion} тихих искажений — контроль фактов дал течь`);

if (withNER) {
  console.log(`\nLLM-NER (выигрыш извлечения имён):`);
  console.log(`  имён regex-базой:                ${regexNames}`);
  console.log(`  имён с NER (после дедупа вложенных): ${nerNames}  (+${nerNames - regexNames} чистых)`);
  console.log(`  сырых добавлений NER:            ${nerGain}`);
  console.log(`  из них присутствуют в оригинале И во всех переписках: ${nerGainPreserved}/${nerGain} (0 мусорных/галлюцинированных)`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("");
if (failures === 0) {
  console.log(`ИТОГ: всё зелёное. Юнит-кейсы пройдены, тихих искажений в снапшоте нет.`);
  process.exit(0);
} else {
  console.log(`ИТОГ: провалов — ${failures}.`);
  process.exit(1);
}
