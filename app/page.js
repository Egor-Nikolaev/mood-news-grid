"use client";

import { useEffect, useState, useCallback } from "react";

// Настроения + акцентные цвета (спокойные, editorial, не кислота).
const MOODS = [
  { key: "neutral", label: "Нейтрально", dot: "#8b8992", tint: "rgba(139,137,146,0.07)" },
  { key: "joyful", label: "Радостно", dot: "#c98a2b", tint: "rgba(201,138,43,0.09)" },
  { key: "sad", label: "Грустно", dot: "#4f6d8c", tint: "rgba(79,109,140,0.09)" },
  { key: "ironic", label: "Иронично", dot: "#7c6ba8", tint: "rgba(124,107,168,0.09)" },
  { key: "anxious", label: "Тревожно", dot: "#b5553f", tint: "rgba(181,85,63,0.09)" },
];
const moodOf = (k) => MOODS.find((m) => m.key === k) || MOODS[0];

const METHOD_NOTE = {
  "llm": "переписано нейросетью, факты сверены и на месте",
  "llm+repair": "нейросеть исказила факт — система поймала и восстановила его",
  "rule-based": "переписано по шаблону (без нейросети), факты не менялись",
  "rule-based(fallback)": "нейросеть не справилась — безопасный откат по шаблону",
};

function factCount(f) {
  if (!f) return 0;
  return (f.numbers?.length || 0) + (f.dates?.length || 0) + (f.names?.length || 0) + (f.quotes?.length || 0);
}
// текст новости в выбранном настроении (из кэша), иначе оригинал
const moodText = (a, mood) => (mood === "neutral" ? a.summary : a.moods?.[mood]?.text || a.summary);

// --- иконки (inline SVG) ---
const IconShield = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" />
  </svg>
);
const IconRefresh = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
  </svg>
);
const IconClose = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
const IconCheck = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.2 2.2L15.5 9.5" />
  </svg>
);
const IconAlert = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 3 2 20h20L12 3z" /><path d="M12 9v5M12 17.5v.5" />
  </svg>
);
const IconCompare = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M12 3v18" />
  </svg>
);

export default function Home() {
  const [articles, setArticles] = useState([]);
  const [mood, setMood] = useState("neutral");
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [selected, setSelected] = useState(null);

  const loadNews = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/news");
    const json = await res.json();
    setArticles(json.articles || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadNews(); }, [loadNews]);

  async function ingest() {
    setIngesting(true);
    await fetch("/api/ingest", { method: "POST" });
    await loadNews();
    setIngesting(false);
  }

  const m = moodOf(mood);

  return (
    <div className="wrap">
      <header className="masthead">
        <p className="eyebrow">Настроение новостей</p>
        <h1>Одни и те же факты — <em>пять настроений</em></h1>
        <p className="lede">
          Выберите настроение — и лента новостей переписывается в этом тоне прямо на карточках.
          Меняется только подача: имена, числа, даты и цитаты остаются неизменными и проверяются кодом.
          Нажмите на новость, чтобы сравнить с оригиналом.
        </p>
      </header>

      <div className="toolbar">
        <div className="moods" role="tablist" aria-label="Настроение">
          {MOODS.map((mm) => (
            <button
              key={mm.key}
              role="tab"
              aria-selected={mood === mm.key}
              className={"mood-btn" + (mood === mm.key ? " active" : "")}
              style={{ "--dot": mm.dot }}
              onClick={() => setMood(mm.key)}
            >
              <span className="mood-dot" />
              {mm.label}
            </button>
          ))}
        </div>
        <button className={"btn-ghost" + (ingesting ? " spinning" : "")} onClick={ingest} disabled={ingesting}>
          <IconRefresh />
          {ingesting ? "Обновляю…" : "Обновить"}
        </button>
      </div>

      {loading ? (
        <div className="skeleton-grid">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel" />)}
        </div>
      ) : articles.length === 0 ? (
        <div className="center">
          Новостей пока нет. Нажмите «Обновить» или запустите <code>npm run ingest</code>.
        </div>
      ) : (
        <div className="grid">
          {articles.map((a) => (
            <button key={a.id} className="card" style={{ "--dot": m.dot }} onClick={() => setSelected(a)}>
              <span className="kicker">{a.source}</span>
              <h3>{a.title}</h3>
              <p className="snippet" style={mood !== "neutral" ? { color: "var(--text)" } : undefined}>
                {moodText(a, mood)}
              </p>
              <div className="foot">
                <span className="chip"><IconShield /> {factCount(a.facts)} фактов под защитой</span>
                <span className="compare-hint"><IconCompare /> сравнить</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <Modal article={selected} initialMood={mood} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function Modal({ article, initialMood, onClose }) {
  const [mood, setMood] = useState(initialMood);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const m = moodOf(mood);

  useEffect(() => {
    let alive = true;

    // нейтральное = оригинал, показываем мгновенно
    if (mood === "neutral") {
      setData({ text: article.summary, method: "rule-based", verification: { ok: true, violations: [] }, cached: true });
      setLoading(false);
      return;
    }
    // если тон уже есть в кэше (пришёл с гридом) — мгновенно, без запроса
    const pre = article.moods?.[mood];
    if (pre) {
      setData({ text: pre.text, method: pre.method, verification: { ok: pre.verified, violations: [] }, cached: true });
      setLoading(false);
      return;
    }
    // иначе генерируем вживую
    setLoading(true);
    setData(null);
    fetch("/api/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: article.summary, source_url: article.source_url, mood }),
    })
      .then((r) => r.json())
      .then((d) => { if (alive) { setData(d); setLoading(false); } });
    return () => { alive = false; };
  }, [mood, article]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const v = data?.verification;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <p className="kicker" style={{ "--dot": m.dot }}>{article.source}</p>
            <h2>{article.title}</h2>
            <p className="src-line">
              Источник: <a href={article.source_url} target="_blank" rel="noreferrer">{article.source_url}</a>
            </p>
          </div>
          <button className="close" onClick={onClose} aria-label="Закрыть"><IconClose /></button>
        </div>

        <div className="moods" role="tablist" aria-label="Настроение" style={{ marginBottom: "var(--sp-4)" }}>
          {MOODS.map((mm) => (
            <button
              key={mm.key}
              role="tab"
              aria-selected={mood === mm.key}
              className={"mood-btn" + (mood === mm.key ? " active" : "")}
              style={{ "--dot": mm.dot }}
              onClick={() => setMood(mm.key)}
            >
              <span className="mood-dot" />
              {mm.label}
            </button>
          ))}
        </div>

        <div className="compare">
          <div className="col">
            <div className="col-label">Оригинал</div>
            <p>{article.summary}</p>
          </div>
          <div className="col mood" style={{ "--dot": m.dot, "--mood-tint": m.tint }}>
            <div className="col-label"><span className="mood-dot" style={{ "--dot": m.dot }} /> {m.label}</div>
            {loading ? <p className="thinking">Переписываю тон…</p> : <p>{data?.text}</p>}
          </div>
        </div>

        {!loading && v && (
          <div className={"verify " + (v.ok ? "ok" : "bad")}>
            <div className="badge">
              {v.ok ? <IconCheck /> : <IconAlert />}
              {v.ok ? "Факты сохранены" : "Обнаружено искажение фактов"}
            </div>
            {!v.ok && v.violations?.length > 0 && (
              <ul>
                {v.violations.map((x, i) => (<li key={i}>{x.type}: «{x.value}» — потерян или изменён</li>))}
              </ul>
            )}
            <div className="method">
              {METHOD_NOTE[data.method] || data.method}
              {data.cached ? " · из кэша" : ""}
              <span className="method-raw"> · {data.method}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
