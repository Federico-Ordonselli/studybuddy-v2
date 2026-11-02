"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ServedQuestion } from "@/lib/studioTypes";
import { InlineText } from "./InlineText";

/**
 * Quiz a scelta multipla sulle sezioni già ascoltate. Risposta e spiegazione arrivano con la domanda: è un
 * esercizio di recupero, non un esame (niente FSRS). Tasti 1–9 per scegliere, Invio per andare avanti.
 */
export default function StudioQuiz({ lessonId, onClose }: { lessonId: number; onClose: () => void }) {
  const [questions, setQuestions] = useState<ServedQuestion[] | null>(null);
  const [error, setError] = useState("");
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setQuestions(null); setI(0); setPicked(null); setScore(0); setError("");
    fetch(`/api/studio/quiz?id=${lessonId}&n=10`)
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "Errore"); return b.questions as ServedQuestion[]; })
      .then(setQuestions)
      .catch((e: Error) => setError(e.message));
  }, [lessonId]);
  useEffect(load, [load]);
  useEffect(() => { box.current?.focus(); }, [i, questions]);

  const q = questions?.[i];
  const done = !!questions && i >= questions.length;
  const choose = useCallback((n: number) => {
    if (!q || picked !== null) return;
    setPicked(n);
    if (n === q.answer) setScore((s) => s + 1);
  }, [q, picked]);
  const next = useCallback(() => { setPicked(null); setI((x) => x + 1); }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (!q) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= q.options.length && picked === null) { e.preventDefault(); choose(n - 1); }
      else if (e.key === "Enter" && picked !== null) { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [q, picked, choose, next, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-scrim flex items-start md:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Quiz su ciò che hai ascoltato"
        className="w-full max-w-2xl rounded-xl border border-border bg-raised p-6 md:p-8 outline-none shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between gap-4 mb-5">
          <div className="text-[10px] uppercase tracking-[0.3em] text-fg-dim">
            Quiz {questions && !done && questions.length ? `· ${i + 1} di ${questions.length}` : ""}
          </div>
          <button onClick={onClose} className="text-sm text-fg-dim hover:text-fg">Chiudi (Esc)</button>
        </div>

        {error && <p className="text-danger">{error}</p>}
        {!questions && !error && <p className="text-fg-muted">Preparo le domande…</p>}
        {questions && !questions.length && (
          <p className="text-fg-muted">Ancora nessuna domanda: finisci di ascoltare una sezione (o segnala come ascoltata) e riprova.</p>
        )}

        {q && (
          <div>
            <div className="text-xs text-fg-dim mb-2"><InlineText text={q.sectionTitle} /></div>
            <h2 className="font-display text-2xl tracking-tight leading-snug mb-5"><InlineText text={q.q} /></h2>
            <ol className="flex flex-col gap-2">
              {q.options.map((o, n) => {
                const state = picked === null ? "idle" : n === q.answer ? "right" : n === picked ? "wrong" : "idle";
                return (
                  <li key={n}>
                    <button onClick={() => choose(n)} aria-disabled={picked !== null}
                      className={`w-full text-left rounded-lg border px-4 py-3 flex gap-3 transition-colors ${
                        state === "right" ? "border-ok bg-[var(--success-soft)] text-[var(--on-success-soft)]"
                        : state === "wrong" ? "border-danger bg-[var(--danger-soft)] text-[var(--on-danger-soft)]"
                        : "border-border-strong bg-surface hover:bg-surface-2"}`}>
                      <span className="font-mono text-sm text-fg-dim w-4 shrink-0">{n + 1}</span>
                      <span className="flex-1"><InlineText text={o} /></span>
                      {state === "right" && <span className="text-sm font-medium">✓ corretta</span>}
                      {state === "wrong" && <span className="text-sm font-medium">✗ la tua</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
            {picked !== null && (
              <div className="mt-5" role="status">
                <p className="font-medium">{picked === q.answer ? "Giusto." : "Non è questa."}</p>
                {q.why && <p className="mt-1 text-fg-muted"><InlineText text={q.why} /></p>}
                <button onClick={next} autoFocus className="mt-4 rounded-lg bg-accent text-on-accent hover:bg-accent-hover px-4 py-2">
                  {i + 1 < questions!.length ? "Avanti (Invio)" : "Vedi il risultato"}
                </button>
              </div>
            )}
          </div>
        )}

        {done && questions!.length > 0 && (
          <div role="status">
            <p className="font-display text-3xl tracking-tight">{score} su {questions!.length}</p>
            <p className="mt-2 text-fg-muted">Le domande vengono dalle sezioni che hai ascoltato, metà dalle ultime due.</p>
            <div className="mt-5 flex gap-3">
              <button onClick={load} className="rounded-lg bg-accent text-on-accent hover:bg-accent-hover px-4 py-2">Altro giro</button>
              <button onClick={onClose} className="rounded-lg border border-border-strong px-4 py-2 hover:bg-surface-2">Torna alla lezione</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
