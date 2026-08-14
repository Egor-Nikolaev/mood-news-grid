// CLI-сидинг базы: node scripts/ingest.mjs
import { ingestAll } from "../lib/ingest.js";

const res = await ingestAll();
console.log("Ingest done.");
console.log("  добавлено новых:", res.added);
console.log("  всего в базе:   ", res.total);
for (const r of res.report) {
  if (r.error) console.log(`  ${r.source}: ОШИБКА — ${r.error}`);
  else console.log(`  ${r.source}: +${r.added}`);
}
process.exit(0);
