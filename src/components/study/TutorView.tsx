"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { decodedSse } from "@/lib/client/sse";
import { post } from "@/lib/client/api";
import CitationChip from "./CitationChip";
import ConfidencePicker from "./ConfidencePicker";
import Markdown from "./Markdown";
import { S } from "./styles";
import VerdictPanel from "./VerdictPanel";
import VideoPanel from "./VideoPanel";
import { sessionKey, type Citation, type Confidence, type Grade, type Msg, type PlayingVideo, type PublicHint, type QuizQuestion } from "./types";

async function chat(body: Record<string, unknown>) {
  return post<{ reply: string; citations?: Citation[]; question?: QuizQuestion; grade?: Grade; source?: Citation; sessionId?: number }>("/api/chat", body);
}

/** Thread del tutor: `socratic` (sessione salvata e ripresa) o `quiz` (domanda → valutazione). */
export default function TutorView({ domainId, mode, initialInput = "" }: { domainId: number; mode: "socratic" | "quiz"; initialInput?: string }) {
  const router = useRouter();
  const [cardError, setCardError] = useState("");
  const [adding, setAdding] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(initialInput);
  const [loading, setLoading] = useState(false);
  const [pendingQ, setPendingQ] = useState<QuizQuestion | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null); // per le domande aperte del quiz
  const [sessionId, setSessionId] = useState<number | undefined>();
  const [hint, setHint] = useState<PublicHint | null>(null);
  const [guarded, setGuarded] = useState(false);
  const [video, setVideo] = useState<PlayingVideo | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const threadRef = useRef<HTMLDivElement>(null);

  // Socratico: riprende la sessione salvata per questo dominio (il componente è rimontato per dominio/modalità).
  useEffect(() => {
    if (mode !== "socratic") return;
    const sid = Number(localStorage.getItem(sessionKey(domainId)) || 0);
    if (!sid) return;
    fetch(`/api/session?id=${sid}`).then((r) => r.json()).then((s) => {
      if (s.history?.length) {
        setSessionId(sid);
        if (s.hint) setHint(s.hint);
        setMsgs(s.history.map((m: { role: "user" | "assistant"; content: string; citations?: Citation[]; tag?: string }) => ({ role: m.role, content: m.content, citations: m.citations, tag: m.tag })));
      }
    }).catch(() => {});
  }, [domainId, mode]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, loading]);

  async function submitAnswer(ans: string, q: QuizQuestion, conf?: Confidence) {
    if (loading) return;
    setMsgs((m) => [...m, { role: "user", content: ans }]);
    setPendingQ(null); setConfidence(null); setLoading(true);
    try {
      const turn = await chat({ mode: "review", domainId, question: q, answer: ans });
      setMsgs((m) => [...m, { role: "assistant", content: turn.reply, tag: "Valutazione", grade: turn.grade, source: turn.source, reviewQuiz: q, confidence: conf }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `Errore: ${e}` }]);
    } finally { setLoading(false); }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    if (mode === "quiz" && pendingQ) {
      if (needsConfidence && !confidence) return; // «Invia» è disattivo finché non scegli la fiducia: la risposta resta
      setInput(""); await submitAnswer(text, pendingQ, confidence ?? undefined); return;
    }
    setInput("");
    if (mode === "socratic") { await streamSocratic(text, { message: text }); return; }
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    try {
      const turn = await chat({ mode: "quiz", domainId, message: text });
      setMsgs((m) => [...m, { role: "assistant", content: turn.reply, tag: "Domanda", citations: turn.citations, question: turn.question }]);
      if (turn.question) setPendingQ(turn.question);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `Errore: ${e}` }]);
    } finally { setLoading(false); }
  }

  /** Un turno socratico in streaming; `userText` è ciò che compare nel thread. */
  async function streamSocratic(userText: string, extra: Record<string, unknown>, tag?: string) {
    setMsgs((m) => [...m, { role: "user", content: userText }]);
    setLoading(true); setGuarded(false);
    let streamPlaceholder = false;
    try {
      abortRef.current = new AbortController();
      const response = await fetch("/api/chat", {method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({mode,domainId,sessionId,stream:true,...extra}), signal:abortRef.current.signal});
      if (!response.ok) throw new Error((await response.json()).error ?? "Errore del tutor");
      if (!response.body) throw new Error("Stream assente");
      streamPlaceholder = true;
      setMsgs(m => [...m,{role:"assistant",content:"",tag}]);
      let completed = false;
      for await (const {event,data} of decodedSse(response.body)) {
        if (event === "metadata") {
          setSessionId(data.sessionId); setHint(data.hint); setGuarded(Boolean(data.guarded));
          try { localStorage.setItem(sessionKey(domainId),String(data.sessionId)); } catch {}
          setMsgs(m => m.map((msg,i) => i === m.length-1 ? {...msg,citations:data.citations} : msg));
        } else if (event === "token") {
          setMsgs(m => m.map((msg,i) => i === m.length-1 ? {...msg,content:msg.content+data.text} : msg));
        } else if (event === "error") throw new Error(data.error);
        else if (event === "done") { completed = true; setHint(data.hint); }
      }
      if (!completed) throw new Error("Risposta incompleta. Riprova.");
    } catch (e) {
      setMsgs((m) => {
        const last = m.at(-1);
        const history = streamPlaceholder && last?.role === "assistant" && !last.content ? m.slice(0, -1) : m;
        return [...history, { role: "assistant", content: `Errore: ${e}` }];
      });
    } finally { setLoading(false); setGuarded(false); }
  }

  async function newProblem() {
    if (!sessionId || loading) return;
    try {
      const r = await post<{ hint: PublicHint }>("/api/chat", { mode, domainId, sessionId, action: "new-problem" });
      setHint(r.hint);
      setMsgs((m) => [...m, { role: "assistant", content: "Nuovo problema: si riparte dal primo indizio.", tag: "Nuovo problema" }]);
    } catch (e) { setCardError(String(e)); }
  }
  const revealSolution = () => streamSocratic("Mostra la soluzione", { action: "solution" }, "Soluzione");

  async function addToReview(index: number, quiz: QuizQuestion) {
    setAdding(true);setCardError("");
    try {
      await post("/api/cards",{domainId,question:quiz.question,answer:quiz.answer});
      setMsgs(m=>m.map((msg,i)=>i===index?{...msg,addedToReview:true}:msg));
      router.refresh();
    } catch(e) {setCardError(String(e));} finally {setAdding(false);}
  }

  // fiducia solo sulle domande aperte: le mcq si rispondono con un clic sull'opzione
  const needsConfidence = mode === "quiz" && pendingQ?.type === "open";
  const placeholder = mode === "socratic"
    ? "Fai una domanda sul materiale…"
    : pendingQ ? "Scrivi la tua risposta…" : "Argomento su cui generare una domanda…";

  return (
    <>
      <VideoPanel video={video} onClose={() => setVideo(null)} />

          <div ref={threadRef} style={S.thread}>
            {msgs.length === 0 && (
              <div style={S.empty}>
                {mode === "socratic"
                  ? "Modalità socratica: alle domande di spiegazione il tutor risponde citando il materiale; sugli esercizi ti guida un indizio alla volta. Dopo 2 tentativi puoi chiedere la soluzione."
                  : "Modalità quiz: dai un argomento, rispondi alla domanda, ricevi una valutazione."}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} style={{ ...S.row, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ ...S.bubble, ...(m.role === "user" ? S.user : S.assistant) }}>
                  {m.tag && <div style={S.badge}>{m.tag}</div>}
                  {m.role === "user" ? <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div> : m.grade ? null : <Markdown text={m.content} />}
                  {m.question?.type === "mcq" && m.question.options && (
                    <div style={S.opts}>
                      {m.question.options.map((opt, k) => (
                        <button key={k} onClick={() => pendingQ && submitAnswer(opt, m.question!)} disabled={!pendingQ || loading} style={S.opt}>{opt}</button>
                      ))}
                    </div>
                  )}
                  {m.grade && (
                    <div style={{ marginTop: 4 }}><VerdictPanel grade={m.grade} source={m.source} confidence={m.confidence} expected={m.confidence === 3 && m.grade.verdict === "wrong" ? m.reviewQuiz?.answer : undefined} onPlay={setVideo} /></div>
                  )}
                  {m.grade && m.grade.verdict !== "correct" && m.reviewQuiz && (
                    <button style={S.ghost} disabled={adding || m.addedToReview} onClick={()=>addToReview(i,m.reviewQuiz!)}>
                      {m.addedToReview ? "Aggiunta al ripasso" : "Aggiungi al ripasso"}
                    </button>
                  )}
                  {m.citations && m.citations.length > 0 && (
                    <div style={S.cites}>
                      {m.citations.map((c) => <CitationChip key={c.n} c={c} onPlay={setVideo} />)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && <div style={{ ...S.row, justifyContent: "flex-start" }}><div style={{ ...S.bubble, ...S.assistant }}><span className="spin" /> <span style={{ color: "var(--muted)" }}>{guarded ? "preparo un indizio…" : "sto pensando…"}</span></div></div>}
          </div>

          {cardError && <p role="alert" style={{color:"var(--danger)"}}>{cardError}</p>}
          {needsConfidence && <ConfidencePicker value={confidence} onChange={setConfidence} disabled={loading} />}
          <div style={S.inputBar}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={placeholder} rows={1} style={S.textarea} disabled={!domainId} />
            <button onClick={send} disabled={loading || !domainId || !input.trim() || (needsConfidence && !confidence)} style={S.send}>Invia</button>
          </div>
          {mode === "socratic" && sessionId && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
              <span>Indizio {hint?.level ?? 1}/4 · tentativi {Math.min(hint?.attempts ?? 0, 2)}/2</span>
              <button style={S.ghost} onClick={newProblem} disabled={loading}>Nuovo problema</button>
              <button style={S.ghost} onClick={revealSolution} disabled={loading || !hint?.canReveal}
                title={hint?.canReveal ? "Mostra la soluzione completa" : "Si sblocca dopo 2 tentativi"}>
                {hint?.canReveal ? "Mostra soluzione" : "Mostra soluzione (dopo 2 tentativi)"}
              </button>
            </div>
          )}
    </>
  );
}
