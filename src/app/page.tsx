"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "socratic" | "quiz" | "review" | "studio";

interface Domain { id: number; name: string; docs: number }

interface Citation {
  n: number;
  documentId: number;
  kind: string;
  label: string;
  snippet: string;
  startSec?: number;
  endSec?: number;
  video?: { path: string; startSec: number };
}

interface QuizQuestion {
  type: "open" | "mcq";
  question: string;
  options?: string[];
  answer: string;
  rationale: string;
}

interface Grade { quality: number; correct: boolean; feedback: string }

interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  tag?: string;
  grade?: Grade;
  question?: QuizQuestion;
}

interface ReviewCard { id: number; question: string }
interface ReviewResult { grade: Grade; expected: string; intervalDays: number; dueAt: number; remaining: number }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const sessionKey = (d: number) => `sb_session_${d}`;

export default function Home() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainId, setDomainId] = useState<number | undefined>();
  const [mode, setMode] = useState<Mode>("socratic");

  // chat (socratic/quiz)
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingQ, setPendingQ] = useState<QuizQuestion | null>(null);
  const [sessionId, setSessionId] = useState<number | undefined>();
  const [video, setVideo] = useState<{ path: string; startSec: number; label: string } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // review (SM-2)
  const [due, setDue] = useState(0);
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [genTopic, setGenTopic] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/domains").then((r) => r.json()).then((d) => {
      setDomains(d.domains ?? []);
      if (d.domains?.[0]) setDomainId(d.domains[0].id);
    }).catch(() => {});
  }, []);

  // Cambio dominio/modalità: azzera il contesto; per il socratico riprende la sessione salvata.
  useEffect(() => {
    if (domainId === undefined) return;
    setMsgs([]); setPendingQ(null); setVideo(null); setSessionId(undefined);
    setCard(null); setResult(null); setAnswer("");
    if (mode === "review") { void loadDue(domainId); return; }
    if (mode === "socratic") {
      const sid = Number(localStorage.getItem(sessionKey(domainId)) || 0);
      if (sid) {
        fetch(`/api/session?id=${sid}`).then((r) => r.json()).then((s) => {
          if (s.history?.length) {
            setSessionId(sid);
            setMsgs(s.history.map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content })));
          }
        }).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainId, mode]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, loading]);

  async function loadDue(d: number) {
    const r = await fetch(`/api/review?domainId=${d}`).then((x) => x.json());
    setDue(r.due ?? 0); setCard(r.card ?? null); setResult(null); setAnswer("");
  }

  async function generateCards() {
    if (!domainId || !genTopic.trim() || busy) return;
    setBusy(true);
    try {
      await fetch("/api/cards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId, topic: genTopic.trim(), n: 5 }),
      });
      setGenTopic("");
      await loadDue(domainId);
    } finally { setBusy(false); }
  }

  async function submitReview() {
    if (!card || !answer.trim() || busy) return;
    setBusy(true);
    try {
      const r = await post<ReviewResult>("/api/review", { cardId: card.id, answer: answer.trim() });
      setResult(r); setDue(r.remaining);
    } catch (e) {
      setResult({ grade: { quality: 0, correct: false, feedback: `Errore: ${e}` }, expected: "", intervalDays: 0, dueAt: 0, remaining: due });
    } finally { setBusy(false); }
  }

  async function nextCard() {
    if (domainId) await loadDue(domainId);
  }

  async function submitAnswer(ans: string, q: QuizQuestion) {
    if (loading) return;
    setMsgs((m) => [...m, { role: "user", content: ans }]);
    setPendingQ(null); setLoading(true);
    try {
      const turn = await chat({ mode: "review", question: q, answer: ans });
      setMsgs((m) => [...m, { role: "assistant", content: turn.reply, tag: "Valutazione", grade: turn.grade }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `Errore: ${e}` }]);
    } finally { setLoading(false); }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    if (mode === "quiz" && pendingQ) { await submitAnswer(text, pendingQ); return; }
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    try {
      if (mode === "socratic") {
        const turn = await chat({ mode, domainId, message: text, sessionId });
        if (turn.sessionId && domainId) { setSessionId(turn.sessionId); localStorage.setItem(sessionKey(domainId), String(turn.sessionId)); }
        setMsgs((m) => [...m, { role: "assistant", content: turn.reply, citations: turn.citations }]);
      } else {
        const turn = await chat({ mode: "quiz", domainId, message: text });
        setMsgs((m) => [...m, { role: "assistant", content: turn.reply, tag: "Domanda", citations: turn.citations, question: turn.question }]);
        if (turn.question) setPendingQ(turn.question);
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `Errore: ${e}` }]);
    } finally { setLoading(false); }
  }

  const placeholder = mode === "socratic"
    ? "Fai una domanda sul materiale…"
    : pendingQ ? "Scrivi la tua risposta…" : "Argomento su cui generare una domanda…";

  return (
    <main style={S.main}>
      <header style={S.header}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>StudyBuddy <span style={{ color: "var(--accent)" }}>v2</span></div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={domainId ?? ""} onChange={(e) => setDomainId(Number(e.target.value))} style={S.select}>
            {domains.length === 0 && <option value="">nessun dominio — usa npm run ingest</option>}
            {domains.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.docs})</option>)}
          </select>
          <div style={S.tabs}>
            {(["socratic", "quiz", "review", "studio"] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} style={{ ...S.tab, ...(mode === m ? S.tabActive : {}) }}>
                {m === "socratic" ? "Socratico" : m === "quiz" ? "Quiz" : m === "review" ? "Ripasso" : "Studio"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {video && (mode === "socratic" || mode === "quiz") && (
        <div style={S.player}>
          <div style={S.playerHead}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>▶ {video.label} · {mmss(video.startSec)}</span>
            <button onClick={() => setVideo(null)} style={S.x}>✕</button>
          </div>
          <video key={video.path + video.startSec}
            src={`/api/video?path=${encodeURIComponent(video.path)}#t=${video.startSec}`}
            controls autoPlay style={{ width: "100%", borderRadius: 8, background: "#000" }} />
        </div>
      )}

      {mode === "studio" ? (
        <StudioView domainId={domainId} />
      ) : mode === "review" ? (
        <ReviewView
          due={due} card={card} answer={answer} setAnswer={setAnswer} result={result}
          genTopic={genTopic} setGenTopic={setGenTopic} onGenerate={generateCards}
          onSubmit={submitReview} onNext={nextCard} busy={busy} disabled={!domainId}
        />
      ) : (
        <>
          <div ref={threadRef} style={S.thread}>
            {msgs.length === 0 && (
              <div style={S.empty}>
                {mode === "socratic"
                  ? "Modalità socratica: il tutor ti guida con domande e indizi, citando il materiale. La conversazione viene salvata e ripresa."
                  : "Modalità quiz: dai un argomento, rispondi alla domanda, ricevi una valutazione."}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} style={{ ...S.row, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ ...S.bubble, ...(m.role === "user" ? S.user : S.assistant) }}>
                  {m.tag && <div style={S.badge}>{m.tag}</div>}
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                  {m.question?.type === "mcq" && m.question.options && (
                    <div style={S.opts}>
                      {m.question.options.map((opt, k) => (
                        <button key={k} onClick={() => pendingQ && submitAnswer(opt, m.question!)} disabled={!pendingQ || loading} style={S.opt}>{opt}</button>
                      ))}
                    </div>
                  )}
                  {m.grade && (
                    <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
                      Qualità SM-2: <b style={{ color: m.grade.correct ? "#6ee7a8" : "#ff8f8f" }}>{m.grade.quality}/5</b>
                    </div>
                  )}
                  {m.citations && m.citations.length > 0 && (
                    <div style={S.cites}>
                      {m.citations.map((c) => (
                        <button key={c.n} title={c.snippet}
                          onClick={() => c.video && setVideo({ path: c.video.path, startSec: c.video.startSec, label: c.label })}
                          style={{ ...S.cite, cursor: c.video ? "pointer" : "default" }}>
                          <span style={S.citeN}>[{c.n}]</span>
                          <span style={{ color: "var(--muted)" }}>{c.kind}</span>
                          <span style={S.citeLabel}>{c.label}</span>
                          {c.video && <span style={S.citePlay}>▶ {mmss(c.video.startSec)}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && <div style={{ ...S.row, justifyContent: "flex-start" }}><div style={{ ...S.bubble, ...S.assistant }}><span className="spin" /> <span style={{ color: "var(--muted)" }}>sto pensando…</span></div></div>}
          </div>

          <div style={S.inputBar}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={placeholder} rows={1} style={S.textarea} disabled={!domainId} />
            <button onClick={send} disabled={loading || !domainId || !input.trim()} style={S.send}>Invia</button>
          </div>
        </>
      )}
    </main>
  );
}

function ReviewView(p: {
  due: number; card: ReviewCard | null; answer: string; setAnswer: (s: string) => void;
  result: ReviewResult | null; genTopic: string; setGenTopic: (s: string) => void;
  onGenerate: () => void; onSubmit: () => void; onNext: () => void; busy: boolean; disabled: boolean;
}) {
  return (
    <div style={S.review}>
      <div style={S.reviewBar}>
        <span>🗂 <b>{p.due}</b> {p.due === 1 ? "carta in scadenza" : "carte in scadenza"}</span>
        <div style={{ display: "flex", gap: 8, flex: 1, justifyContent: "flex-end" }}>
          <input value={p.genTopic} onChange={(e) => p.setGenTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") p.onGenerate(); }}
            placeholder="Genera carte da un argomento…" style={{ ...S.select, flex: 1, maxWidth: 360 }} disabled={p.disabled} />
          <button onClick={p.onGenerate} disabled={p.busy || p.disabled || !p.genTopic.trim()} style={S.send}>
            {p.busy ? <span className="spin" /> : "Genera"}
          </button>
        </div>
      </div>

      {!p.card ? (
        <div style={S.empty}>Nessuna carta in scadenza. Genera nuove carte da un argomento qui sopra.</div>
      ) : (
        <div style={S.card}>
          <div style={S.badge}>Domanda</div>
          <div style={{ fontSize: 16, lineHeight: 1.5 }}>{p.card.question}</div>

          {!p.result ? (
            <>
              <textarea value={p.answer} onChange={(e) => p.setAnswer(e.target.value)} rows={3}
                placeholder="La tua risposta…" style={{ ...S.textarea, marginTop: 14 }} />
              <button onClick={p.onSubmit} disabled={p.busy || !p.answer.trim()} style={{ ...S.send, marginTop: 10, padding: "10px 18px" }}>
                {p.busy ? <span className="spin" /> : "Valuta"}
              </button>
            </>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 14 }}>
                Esito: <b style={{ color: p.result.grade.correct ? "#6ee7a8" : "#ff8f8f" }}>
                  {p.result.grade.quality}/5 {p.result.grade.correct ? "✓" : "✗"}
                </b>
                <span style={{ color: "var(--muted)" }}> · prossimo ripasso tra {p.result.intervalDays} {p.result.intervalDays === 1 ? "giorno" : "giorni"}</span>
              </div>
              <p style={{ margin: "10px 0", lineHeight: 1.5 }}>{p.result.grade.feedback}</p>
              {p.result.expected && (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Risposta attesa: {p.result.expected}</div>
              )}
              <button onClick={p.onNext} disabled={p.busy} style={{ ...S.send, marginTop: 12, padding: "10px 18px" }}>
                {p.due > 0 ? "Prossima carta" : "Fine ripasso"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Tool = "summary" | "map" | "slides";
interface ConceptNode { id: string; label: string }
interface ConceptEdge { from: string; to: string; label?: string }
interface SlideT { title: string; bullets: string[]; imagePrompt: string; image?: { format: string; content: string } }

function StudioView({ domainId }: { domainId?: number }) {
  const [topic, setTopic] = useState("");
  const [tool, setTool] = useState<Tool | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [map, setMap] = useState<{ nodes: ConceptNode[]; edges: ConceptEdge[] } | null>(null);
  const [slides, setSlides] = useState<SlideT[] | null>(null);

  async function run(t: Tool) {
    if (!topic.trim() || !domainId || loading) return;
    setTool(t); setLoading(true); setSummary(null); setMap(null); setSlides(null);
    try {
      if (t === "summary") setSummary((await post<{ summary: string }>("/api/summarize", { domainId, topic })).summary);
      else if (t === "map") setMap(await post<{ nodes: ConceptNode[]; edges: ConceptEdge[] }>("/api/conceptmap", { domainId, topic }));
      else {
        const r = await post<{ slides: SlideT[] }>("/api/slides", { domainId, topic, n: 4 });
        setSlides(r.slides);
        void loadImages(r.slides);
      }
    } catch (e) {
      if (t === "summary") setSummary(`Errore: ${e}`);
    } finally { setLoading(false); }
  }

  // Immagini lazy, una per slide: il deck è già visibile mentre si riempiono.
  async function loadImages(ss: SlideT[]) {
    for (let i = 0; i < ss.length; i++) {
      try {
        const r = await post<{ image: { format: string; content: string } }>("/api/slides/image", { prompt: ss[i].imagePrompt || ss[i].title });
        setSlides((prev) => { if (!prev) return prev; const c = [...prev]; c[i] = { ...c[i], image: r.image }; return c; });
      } catch { /* slide senza immagine */ }
    }
  }

  const tools: [Tool, string][] = [["summary", "Riassunto"], ["map", "Mappa concettuale"], ["slides", "Slide"]];

  return (
    <div style={S.review}>
      <div style={S.reviewBar}>
        <input value={topic} onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && tool) run(tool); }}
          placeholder="Argomento da studiare…" style={{ ...S.select, flex: 1, minWidth: 220 }} disabled={!domainId} />
        {tools.map(([t, label]) => (
          <button key={t} onClick={() => run(t)} disabled={loading || !domainId || !topic.trim()}
            style={{ ...S.tab, border: "1px solid var(--border)", borderRadius: 8, ...(tool === t ? S.tabActive : {}) }}>
            {label}
          </button>
        ))}
      </div>

      {loading && <div style={{ ...S.empty, marginTop: 24 }}><span className="spin" /> {tool === "slides" ? "genero le slide…" : tool === "map" ? "costruisco la mappa…" : "riassumo il materiale…"}</div>}

      {!loading && !tool && <div style={S.empty}>Scrivi un argomento e scegli uno strumento: riassunto map-reduce, mappa concettuale, o slide con immagini generate.</div>}

      {summary !== null && <div style={S.card}><Markdown text={summary} /></div>}
      {map !== null && (map.nodes.length ? <div style={S.card}><ConceptMapSvg nodes={map.nodes} edges={map.edges} /></div> : <div style={S.empty}>Nessuna mappa generata.</div>)}
      {slides !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {slides.map((s, i) => (
            <div key={i} style={S.card}>
              <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 280px" }}>
                  <div style={S.badge}>Slide {i + 1}</div>
                  <h3 style={{ margin: "2px 0 10px" }}>{s.title}</h3>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    {s.bullets.map((b, k) => <li key={k}>{b}</li>)}
                  </ul>
                </div>
                <div style={S.slideImg} className="slide-img">
                  {s.image
                    ? (s.image.format === "svg"
                        ? <div style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: s.image.content }} />
                        : <img src={s.image.content} alt={s.title} />)
                    : <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--muted)", fontSize: 13 }}><span className="spin" /> &nbsp;immagine…</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Mappa concettuale: layout radiale deterministico (nodo 0 al centro). */
function ConceptMapSvg({ nodes, edges }: { nodes: ConceptNode[]; edges: ConceptEdge[] }) {
  const W = 720, H = 460, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 70;
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    if (i === 0) pos.set(n.id, { x: cx, y: cy });
    else {
      const a = (2 * Math.PI * (i - 1)) / Math.max(1, nodes.length - 1) - Math.PI / 2;
      pos.set(n.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    }
  });
  const w = (label: string) => Math.min(170, 30 + label.length * 7);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {edges.map((e, i) => {
        const a = pos.get(e.from), b = pos.get(e.to);
        if (!a || !b) return null;
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2a2f3a" strokeWidth={1.5} />
            {e.label && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3} fill="#98a0b3" fontSize={10} textAnchor="middle">{e.label}</text>}
          </g>
        );
      })}
      {nodes.map((n, i) => {
        const p = pos.get(n.id)!; const bw = w(n.label);
        return (
          <g key={n.id}>
            <rect x={p.x - bw / 2} y={p.y - 16} width={bw} height={32} rx={8}
              fill={i === 0 ? "#2b6cff" : "#1e222b"} stroke={i === 0 ? "#6ea8fe" : "#2a2f3a"} strokeWidth={1.5} />
            <text x={p.x} y={p.y + 4} fill="#e6e8ee" fontSize={11.5} textAnchor="middle">
              {n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Mini renderer markdown: titoletti (##/###), bullet (-/*), grassetto **…**. */
function Markdown({ text }: { text: string }) {
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>);
  const lines = text.split("\n");
  return (
    <div style={{ lineHeight: 1.6 }}>
      {lines.map((l, i) => {
        const t = l.trim();
        if (/^#{1,6}\s/.test(t)) return <h3 key={i} style={{ margin: "14px 0 6px", color: "var(--accent)" }}>{t.replace(/^#{1,6}\s/, "")}</h3>;
        if (/^[-*]\s/.test(t)) return <div key={i} style={{ paddingLeft: 16 }}>• {bold(t.replace(/^[-*]\s/, ""))}</div>;
        if (!t) return <div key={i} style={{ height: 6 }} />;
        return <p key={i} style={{ margin: "4px 0" }}>{bold(t)}</p>;
      })}
    </div>
  );
}

async function chat(body: Record<string, unknown>) {
  return post<{ reply: string; citations?: Citation[]; question?: QuizQuestion; grade?: Grade; sessionId?: number }>("/api/chat", body);
}

async function post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j as T;
}

const S: Record<string, React.CSSProperties> = {
  main: { maxWidth: 860, margin: "0 auto", height: "100dvh", display: "flex", flexDirection: "column", padding: "0 16px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" },
  select: { background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px" },
  tabs: { display: "flex", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" },
  tab: { background: "transparent", color: "var(--muted)", border: "none", padding: "7px 14px" },
  tabActive: { background: "var(--accent-2)", color: "#fff" },
  player: { marginTop: 12, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 10 },
  playerHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  x: { background: "transparent", border: "none", color: "var(--muted)", fontSize: 14 },
  thread: { flex: 1, overflowY: "auto", padding: "16px 0", display: "flex", flexDirection: "column", gap: 12 },
  empty: { color: "var(--muted)", textAlign: "center", margin: "auto", maxWidth: 460, lineHeight: 1.6 },
  row: { display: "flex" },
  bubble: { maxWidth: "82%", padding: "10px 13px", borderRadius: 14, lineHeight: 1.5, border: "1px solid var(--border)" },
  user: { background: "var(--user)", borderBottomRightRadius: 4 },
  assistant: { background: "var(--panel)", borderBottomLeftRadius: 4 },
  badge: { display: "inline-block", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--accent)", marginBottom: 6 },
  opts: { display: "flex", flexDirection: "column", gap: 6, marginTop: 10 },
  opt: { textAlign: "left", background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", lineHeight: 1.4 },
  cites: { display: "flex", flexDirection: "column", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" },
  cite: { display: "flex", alignItems: "center", gap: 8, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 9px", textAlign: "left", color: "var(--text)", fontSize: 12.5, width: "fit-content", maxWidth: "100%" },
  citeN: { color: "var(--accent)", fontWeight: 700 },
  citeLabel: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 420 },
  citePlay: { color: "#6ee7a8", whiteSpace: "nowrap" },
  inputBar: { display: "flex", gap: 8, padding: "12px 0 18px", borderTop: "1px solid var(--border)" },
  textarea: { width: "100%", resize: "none", background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 13px", lineHeight: 1.4, maxHeight: 160 },
  send: { background: "var(--accent-2)", color: "#fff", border: "none", borderRadius: 10, padding: "0 18px", fontWeight: 600, minWidth: 84 },
  review: { flex: 1, overflowY: "auto", padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 },
  reviewBar: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", color: "var(--text)" },
  card: { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  slideImg: { flex: "1 1 240px", minWidth: 220, aspectRatio: "4 / 3", background: "#1e222b", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" },
};
