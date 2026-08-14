"use client";

import { useEffect, useState, useCallback } from "react";

const MOODS = [
  { key: "neutral", label: "⚖️ Нейтрально" },
  { key: "joyful", label: "😄 Радостно" },
  { key: "sad", label: "😔 Грустно" },
  { key: "ironic", label: "😏 Иронично" },
  { key: "anxious", label: "😟 Тревожно" },
];

function factCount(f) {
  if (!f) return 0;
  return (f.numbers?.length || 0) + (f.dates?.length || 0) + (f.names?.length || 0) + (f.quotes?.length || 0);
}

export default function Home() {
  const [articles, setArticles] = useState([]);
  const [mood, setMood] = useState("neutral");
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [selected, setSelected] = useState(null); // {article, data, loading}

  const loadNews = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/news");
    const json = await res.json();
    setArticles(json.articles || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  async function ingest() {
    setIngesting(true);
    await fetch("/api/ingest", { method: "POST" });
    await loadNews();
    setIngesting(false);
  }

  async function openArticle(article) {
    setSelected({ article, data: null, loading: true });
    const res = await fetch("/api/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId: article.id, mood }),
    });
    const data = await res.json();
    setSelected({ article, data, loading: false });
  }

  return (
    <div className="wrap">
      <header>
        <h1>Mood News Grid</h1>
        <p>
          Реальные новости из открытых RSS-источников. Один и тот же факт можно прочитать в разном
          настроении — но сами факты (имена, числа, даты, цитаты) остаются неизменными и проверяются кодом.
        </p>
      </header>

      <div className="toolbar">
        <div className="moods">
          {MOODS.map((m) => (
            <button
              key={m.key}
              className={"mood-btn" + (mood === m.key ? " active" : "")}
              onClick={() => setMood(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={ingest} disabled={ingesting}>
          {ingesting ? "Обновляю…" : "↻ Обновить новости"}
        </button>
      </div>

      {loading ? (
        <div className="center">Загрузка…</div>
      ) : articles.length === 0 ? (
        <div className="center">
          Новостей пока нет. Нажми «Обновить новости» или запусти <code>npm run ingest</code>.
        </div>
      ) : (
        <div className="grid">
          {articles.map((a) => (
            <div key={a.id} className="card" onClick={() => openArticle(a)}>
              <span className="src">{a.source}</span>
              <h3>{a.title}</h3>
              <p className="snippet">{a.summary.slice(0, 140)}…</p>
              <div className="meta">
                <span className="tag">{factCount(a.facts)} фактов под защитой</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <Modal
          selected={selected}
          mood={mood}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function Modal({ selected, mood, onClose }) {
  const { article, data, loading } = selected;
  const moodLabel = MOODS.find((m) => m.key === mood)?.label || mood;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <span className="src">{article.source}</span>
        <h2>{article.title}</h2>
        <div className="src-line">
          Источник: <a href={article.source_url} target="_blank" rel="noreferrer">{article.source_url}</a>
        </div>

        <div className="compare">
          <div className="col">
            <h4>Оригинал</h4>
            <p>{article.summary}</p>
          </div>
          <div className="col">
            <h4>{moodLabel}</h4>
            {loading ? <p className="spinner">Переписываю тон…</p> : <p>{data?.text}</p>}
          </div>
        </div>

        {!loading && data?.verification && (
          <div className={"verify " + (data.verification.ok ? "ok" : "bad")}>
            <span className="badge">
              {data.verification.ok ? "✓ Факты сохранены" : "✗ Обнаружено искажение фактов"}
            </span>
            {!data.verification.ok && (
              <ul>
                {data.verification.violations.map((v, i) => (
                  <li key={i}>{v.type}: «{v.value}» — потерян или изменён</li>
                ))}
              </ul>
            )}
            <div className="method">
              Метод: {data.method}{data.cached ? " (из кэша)" : ""}
              {data.note ? ` · ${data.note}` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
