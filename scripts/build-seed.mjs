// Генерация офлайн-снапшота: реальные новости + запечённые переписки всех настроений.
// Запуск: node --env-file=.env scripts/build-seed.mjs [limit]
// Результат: data/seed.json (коммитится) — мгновенный первый экран на serverless.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db.js";
import { rewriteWithMood } from "../lib/rewrite.js";
import { verifyFacts, extractFacts } from "../lib/facts.js";
import { MOOD_KEYS } from "../lib/moods.js";

const limit = Number(process.argv[2]) || 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = getDb()
  .prepare(`SELECT * FROM articles ORDER BY datetime(published_at) DESC, id DESC LIMIT ?`)
  .all(limit);

console.log(`Пеку снапшот: ${rows.length} новостей × ${MOOD_KEYS.length} настроений…`);

const articles = [];
for (const [i, a] of rows.entries()) {
  const facts = JSON.parse(a.facts_json);
  const rewrites = {};
  for (const mood of MOOD_KEYS) {
    if (mood === "neutral") {
      // нейтральный = оригинал дословно, без похода в LLM
      const v = verifyFacts(extractFacts(a.summary), a.summary);
      rewrites[mood] = { text: a.summary, method: "rule-based", verified: v.ok, violations: v.violations };
      continue;
    }
    // ретраим, пока не получим живой LLM (фолбэк в снапшот не пускаем — там бледные тексты)
    let r = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      r = await rewriteWithMood(a.summary, mood);
      if (r.method.startsWith("llm")) break;
      await sleep(6000); // подождать, пока отпустит rate-limit
    }
    rewrites[mood] = {
      text: r.text,
      method: r.method,
      verified: r.verification.ok,
      violations: r.verification.violations,
    };
    process.stdout.write(`  [${i + 1}/${rows.length}] ${mood}: ${r.method}\n`);
    await sleep(2500); // троттлинг между настроениями
  }
  articles.push({
    guid: a.guid,
    source: a.source,
    source_url: a.source_url,
    title: a.title,
    summary: a.summary,
    published_at: a.published_at,
    fetched_at: a.fetched_at,
    facts,
    rewrites,
  });
}

const out = { generatedAt: new Date().toISOString(), count: articles.length, articles };
const dest = path.join(process.cwd(), "data", "seed.json");
writeFileSync(dest, JSON.stringify(out, null, 2), "utf8");
const llm = articles.flatMap((a) => Object.values(a.rewrites)).filter((r) => r.method.startsWith("llm")).length;
console.log(`Готово: ${dest} · ${articles.length} новостей · ${llm} переписок через LLM`);
process.exit(0);
