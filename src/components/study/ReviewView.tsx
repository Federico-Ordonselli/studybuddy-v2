"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { post } from "@/lib/client/api";
import { timeUntil } from "@/lib/format";
import CardManager from "./CardManager";
import { S } from "./styles";
import VerdictPanel from "./VerdictPanel";
import VideoPanel from "./VideoPanel";
import { RATING_LABEL, type OverrideResult, type PlayingVideo, type Rating, type ReviewCard, type ReviewResult } from "./types";

/** Ripasso FSRS: coda delle carte in scadenza (figli inclusi se è un macro) + generazione carte. */
export default function ReviewView({ domainId }: { domainId: number }) {
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [due, setDue] = useState(0);
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState("");
  const [fixing, setFixing] = useState(false);   // pannello «Il voto è sbagliato» aperto
  const [corrected, setCorrected] = useState(false);
  const [genTopic, setGenTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState<PlayingVideo | null>(null);
  const [loaded, setLoaded] = useState(false); // senza, al primo render compariva «nessuna carta»

  async function loadDue(d: number) {
    const r = await fetch(`/api/review?domainId=${d}`).then((x) => x.json());
    setDue(r.due ?? 0); setCard(r.card ?? null); setResult(null); setError(""); setFixing(false); setCorrected(false); setAnswer(""); setVideo(null); setLoaded(true);
  }

  async function generateCards() {
    if (!domainId || !genTopic.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/cards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId, topic: genTopic.trim(), n: 5 }),
      });
      setGenTopic("");
      await loadDue(domainId);
      setVersion(v=>v+1);
      if (res.ok) router.refresh(); // aggiorna i badge della sidebar
    } finally { setBusy(false); }
  }

  async function submitReview() {
    if (!card || !answer.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const r = await post<ReviewResult>("/api/review", { cardId: card.id, answer: answer.trim(), domainId });
      setResult(r); setDue(r.remaining);
      router.refresh(); // aggiorna i badge della sidebar
    } catch (e) {
      setError(`Errore: ${e instanceof Error ? e.message : e}`); // la carta non è stata toccata: si può riprovare
    } finally { setBusy(false); }
  }

  /** Correzione del voto del giudice: rischedula l'ultima review con il rating scelto. */
  async function overrideRating(rating: Rating) {
    if (!card || !result || busy) return;
    setBusy(true); setError("");
    try {
      const r = await post<OverrideResult>("/api/review/override", { cardId: card.id, rating, domainId });
      setResult({ ...result, rating: r.rating, dueAt: r.dueAt }); setDue(r.remaining);
      setFixing(false); setCorrected(true);
      router.refresh();
    } catch (e) {
      setError(`Errore: ${e instanceof Error ? e.message : e}`);
    } finally { setBusy(false); }
  }

  async function nextCard() {
    if (domainId) await loadDue(domainId);
  }

  useEffect(() => { void loadDue(domainId); }, [domainId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={S.review}>
      <VideoPanel video={video} onClose={() => setVideo(null)} />
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
              {error && <p role="alert" style={{ color: "var(--danger)", margin: "10px 0 0" }}>{error}</p>}
            </>
          ) : (
            <div style={{ marginTop: 14 }}>
              <VerdictPanel grade={result.grade} expected={result.expected} source={result.source} onPlay={setVideo}>
                <span>· <b>{RATING_LABEL[result.rating]}</b>{corrected && " (corretto da te)"}
                  <span style={{ color: "var(--muted)" }}> · prossimo ripasso {timeUntil(result.dueAt)}</span></span>
              </VerdictPanel>
              {fixing ? (
                <div role="group" aria-label="Voto corretto" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>Voto corretto:</span>
                  {([1, 2, 3, 4] as Rating[]).map((r) => (
                    <button key={r} onClick={() => overrideRating(r)} disabled={busy || r === result.rating}
                      aria-pressed={r === result.rating} style={{ ...S.opt, padding: "6px 12px" }}>
                      {RATING_LABEL[r]}{r === result.rating && " (attuale)"}
                    </button>
                  ))}
                  <button onClick={() => setFixing(false)} disabled={busy} style={S.x}>Annulla</button>
                </div>
              ) : (
                <button onClick={() => setFixing(true)} disabled={busy} style={{ ...S.x, marginTop: 10, padding: 0, textDecoration: "underline" }}>
                  Il voto è sbagliato
                </button>
              )}
              {error && <p role="alert" style={{ color: "var(--danger)", margin: "10px 0 0" }}>{error}</p>}
              <div>
                <button onClick={nextCard} disabled={busy} style={{ ...S.send, marginTop: 12, padding: "10px 18px" }}>
                  {due > 0 ? "Prossima carta" : "Fine ripasso"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <CardManager domainId={domainId} version={version} onChange={()=>{void loadDue(domainId);router.refresh();}} />
    </div>
  );
}
