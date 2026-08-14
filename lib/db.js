import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

// Единая точка доступа к базе.
// Локально файл лежит в data/mood-news.db (в .gitignore).
// На serverless (Vercel) writable только /tmp, поэтому база там эфемерная,
// а новости досеиваются автоматически при пустой базе (см. lib/ingest.js).
const DATA_DIR =
  process.env.DB_DIR ||
  (process.env.VERCEL ? "/tmp/mood-news" : path.join(process.cwd(), "data"));
mkdirSync(DATA_DIR, { recursive: true });

let _db;

export function getDb() {
  if (_db) return _db;
  _db = new Database(path.join(DATA_DIR, "mood-news.db"));
  _db.pragma("journal_mode = WAL");
  migrate(_db);
  return _db;
}

// path тут не нужен наружу, но экспорт директории удобен для диагностики
export function dataDir() {
  return DATA_DIR;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      guid         TEXT UNIQUE,           -- дедуп по ссылке/guid из RSS
      source       TEXT NOT NULL,          -- имя источника (BBC, NPR, ...)
      source_url   TEXT NOT NULL,          -- ссылка на оригинал
      title        TEXT NOT NULL,
      summary      TEXT NOT NULL,          -- исходный текст новости (что переписываем)
      published_at TEXT,
      fetched_at   TEXT NOT NULL,
      facts_json   TEXT NOT NULL           -- извлечённые факты (кэш), см. lib/facts.js
    );

    CREATE TABLE IF NOT EXISTS rewrites (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id     INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      mood           TEXT NOT NULL,        -- neutral / joyful / sad / ironic / anxious
      text           TEXT NOT NULL,        -- переписанный текст
      method         TEXT NOT NULL,        -- llm | llm+repair | rule-based | rule-based(fallback)
      verified       INTEGER NOT NULL,     -- 1 если все факты на месте
      violations_json TEXT NOT NULL,       -- список потерянных/искажённых фактов
      created_at     TEXT NOT NULL,
      UNIQUE(article_id, mood)             -- один кэш на пару статья+настроение
    );
  `);
}

// --- articles ---
export function upsertArticle(a) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO articles (guid, source, source_url, title, summary, published_at, fetched_at, facts_json)
    VALUES (@guid, @source, @source_url, @title, @summary, @published_at, @fetched_at, @facts_json)
    ON CONFLICT(guid) DO NOTHING
  `);
  const info = stmt.run(a);
  return info.changes > 0;
}

export function listArticles() {
  return getDb()
    .prepare(`SELECT * FROM articles ORDER BY datetime(published_at) DESC, id DESC`)
    .all();
}

export function getArticle(id) {
  return getDb().prepare(`SELECT * FROM articles WHERE id = ?`).get(id);
}

export function countArticles() {
  return getDb().prepare(`SELECT COUNT(*) AS n FROM articles`).get().n;
}

// --- rewrites (кэш) ---
export function getRewrite(articleId, mood) {
  return getDb()
    .prepare(`SELECT * FROM rewrites WHERE article_id = ? AND mood = ?`)
    .get(articleId, mood);
}

export function saveRewrite(r) {
  const db = getDb();
  db.prepare(`
    INSERT INTO rewrites (article_id, mood, text, method, verified, violations_json, created_at)
    VALUES (@article_id, @mood, @text, @method, @verified, @violations_json, @created_at)
    ON CONFLICT(article_id, mood) DO UPDATE SET
      text = excluded.text,
      method = excluded.method,
      verified = excluded.verified,
      violations_json = excluded.violations_json,
      created_at = excluded.created_at
  `).run(r);
}
