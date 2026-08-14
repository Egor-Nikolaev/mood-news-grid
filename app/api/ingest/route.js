import { ingestAll } from "../../../lib/ingest.js";

export const dynamic = "force-dynamic";

// Ручной запуск подтяжки новостей из RSS (кнопка "Обновить" на фронте).
export async function POST() {
  const res = await ingestAll();
  return Response.json(res);
}
