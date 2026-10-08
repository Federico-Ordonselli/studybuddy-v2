"use client";

import { useEffect, useRef, useState } from "react";
import { post } from "@/lib/client/api";
import { S } from "./styles";
import { mmss, sessionKey, type Citation, type Grade, type Msg, type QuizQuestion } from "./types";

async function chat(body: Record<string, unknown>) {
  return post<{ reply: string; citations?: Citation[]; question?: QuizQuestion; grade?: Grade; sessionId?: number }>("/api/chat", body);
}

/** Thread del tutor: `socratic` (sessione salvata e ripresa) o `quiz` (domanda → valutazione). */
export default function TutorView({ domainId, mode, initialInput = "" }: { domainId: number; mode: "socratic" | "quiz"; initialInput?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(initialInput);
  const [loading, setLoading] = useState(false);
  const [pendingQ, setPendingQ] = useState<QuizQuestion | null>(null);
  const [sessionId, setSessionId] = useState<number | undefined>();
  const [video, setVideo] = useState<{ path: string; startSec: number; label: string } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Socratico: riprende la sessione salvata per questo dominio (il componente è rimontato per dominio/modalità).
  useEffect(() => {
    if (mode !== "socratic") return;
    const sid = Number(localStorage.getItem(sessionKey(domainId)) || 0);
    if (!sid) return;
    fetch(`/api/session?id=${sid}`).then((r) => r.json()).then((s) => {
      if (s.history?.length) {
        setSessionId(sid);
        setMsgs(s.history.map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content })));
      }
    }).catch(() => {});
  }, [domainId, mode]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, loading]);

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
    <>
      {video && (
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
  );
}
