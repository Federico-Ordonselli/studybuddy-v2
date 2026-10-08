"use client";

import { useEffect, useState } from "react";
import { post } from "@/lib/client/api";
import { S } from "./styles";
import type { ReviewCard, ReviewResult } from "./types";

/** Ripasso SM-2: coda delle carte in scadenza (figli inclusi se è un macro) + generazione carte. */
export default function ReviewView({ domainId }: { domainId: number }) {
  const [due, setDue] = useState(0);
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [genTopic, setGenTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false); // senza, al primo render compariva «nessuna carta»

  async function loadDue(d: number) {
    const r = await fetch(`/api/review?domainId=${d}`).then((x) => x.json());
    setDue(r.due ?? 0); setCard(r.card ?? null); setResult(null); setAnswer(""); setLoaded(true);
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
      const r = await post<ReviewResult>("/api/review", { cardId: card.id, answer: answer.trim(), domainId });
      setResult(r); setDue(r.remaining);
    } catch (e) {
      setResult({ grade: { quality: 0, correct: false, feedback: `Errore: ${e}` }, expected: "", intervalDays: 0, dueAt: 0, remaining: due });
    } finally { setBusy(false); }
  }

  async function nextCard() {
    if (domainId) await loadDue(domainId);
  }

  useEffect(() => { void loadDue(domainId); }, [domainId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={S.review}>
      <div style={S.reviewBar}>
        <span>🗂 <b>{loaded ? due : "…"}</b> {due === 1 ? "carta in scadenza" : "carte in scadenza"}</span>
        <div style={{ display: "flex", gap: 8, flex: 1, justifyContent: "flex-end" }}>
          <input value={genTopic} onChange={(e) => setGenTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") generateCards(); }}
            placeholder="Genera carte da un argomento…" style={{ ...S.select, flex: 1, maxWidth: 360 }} disabled={false} />
          <button onClick={generateCards} disabled={busy || false || !genTopic.trim()} style={S.send}>
            {busy ? <span className="spin" /> : "Genera"}
          </button>
        </div>
      </div>

      {!loaded ? (
        <div style={S.empty}><span className="spin" /></div>
      ) : !card ? (
        <div style={S.empty}>Nessuna carta in scadenza. Genera nuove carte da un argomento qui sopra.</div>
      ) : (
        <div style={S.card}>
          <div style={S.badge}>Domanda</div>
          <div style={{ fontSize: 16, lineHeight: 1.5 }}>{card.question}</div>

          {!result ? (
            <>
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3}
                placeholder="La tua risposta…" style={{ ...S.textarea, marginTop: 14 }} />
              <button onClick={submitReview} disabled={busy || !answer.trim()} style={{ ...S.send, marginTop: 10, padding: "10px 18px" }}>
                {busy ? <span className="spin" /> : "Valuta"}
              </button>
            </>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 14 }}>
                Esito: <b style={{ color: result.grade.correct ? "#6ee7a8" : "#ff8f8f" }}>
                  {result.grade.quality}/5 {result.grade.correct ? "✓" : "✗"}
                </b>
                <span style={{ color: "var(--muted)" }}> · prossimo ripasso tra {result.intervalDays} {result.intervalDays === 1 ? "giorno" : "giorni"}</span>
              </div>
              <p style={{ margin: "10px 0", lineHeight: 1.5 }}>{result.grade.feedback}</p>
              {result.expected && (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Risposta attesa: {result.expected}</div>
              )}
              <button onClick={nextCard} disabled={busy} style={{ ...S.send, marginTop: 12, padding: "10px 18px" }}>
                {due > 0 ? "Prossima carta" : "Fine ripasso"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
