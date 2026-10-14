"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, post } from "@/lib/client/api";
import type { CornellView, LessonView, PretestView } from "@/lib/lessonStudyTypes";
import type { CardDraft } from "@/lib/tutor/cardGen";
import CardPreview from "./CardPreview";
import { S } from "./styles";

type Mode = "cornell" | "pretest";
const messageOf = (e: unknown) => e instanceof Error ? e.message : String(e);
function stash(key: string, value: unknown) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* lo stato resta in memoria */ }
}
function stored(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}
const buttonStyle = (disabled: boolean) => ({ ...S.ghost, ...(disabled ? S.ghostDisabled : {}), marginTop: 0 });

export default function LessonStudyView({ domainId, mode }: { domainId: number; mode: Mode }) {
  const [lessons, setLessons] = useState<LessonView[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    api<{ lessons: LessonView[] }>("GET", `/api/lessons?domainId=${domainId}`)
      .then((r) => { if (!cancelled) { setLessons(r.lessons); setSelected(r.lessons[0]?.id ?? 0); } })
      .catch((e) => { if (!cancelled) setError(messageOf(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [domainId, retry]);
  const lesson = lessons.find((l) => l.id === selected);
  return (
    <section aria-label={mode === "cornell" ? "Appunti Cornell" : "Domande prima di guardare"} style={S.card}>
      <h2 className="text-lg font-semibold">{mode === "cornell" ? "Appunti guidati · Cornell" : "Domande prima di guardare"}</h2>
      <p className="text-sm text-fg-muted mt-2 mb-4">{mode === "cornell"
        ? "Scegli una lezione, scrivi gli appunti sotto le domande e concludi con un riassunto di 3–5 frasi. Salva per ritrovarli nelle note del corso."
        : "Prova a rispondere prima di studiare la lezione, anche scrivendo «non so». Le domande ti aiutano a cercare i punti importanti: non riceverai un voto e non saranno aggiunte carte al ripasso."}</p>
      {loading ? <p role="status">Carico le lezioni…</p> : error ? <><p role="alert" className="text-danger">{error}</p><button onClick={() => setRetry((r) => r + 1)} style={S.ghost}>Riprova</button></>
        : !lessons.length ? <p className="text-fg-muted">Nessuna lezione con materiale testuale. Importa prima il corso.</p> : (
        <>
          <label className="block text-sm">Lezione
            <select aria-label="Lezione" value={selected} onChange={(e) => setSelected(Number(e.target.value))} style={{ ...S.select, width: "100%", marginTop: 6 }}>
              {lessons.map((l) => <option key={l.id} value={l.id}>{[l.course, l.module, l.title].filter(Boolean).join(" › ")}</option>)}
            </select>
          </label>
          {lesson && <LessonWork key={`${domainId}-${selected}-${mode}`} domainId={domainId} lesson={lesson} mode={mode} />}
        </>
      )}
    </section>
  );
}

function LessonWork({ domainId, lesson, mode }: { domainId: number; lesson: LessonView; mode: Mode }) {
  const router = useRouter();
  const [work, setWork] = useState<CornellView | null>(null);
  const [pretest, setPretest] = useState<PretestView | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [references, setReferences] = useState<{ answer: string; rationale: string }[] | null>(null);
  const [drafts, setDrafts] = useState<CardDraft[] | null>(null);
  const [busy, setBusy] = useState(mode === "cornell");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [material, setMaterial] = useState<{ text: string; partial: boolean } | null>(null);
  const [showMaterial, setShowMaterial] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = `studybuddy:lesson:${lesson.id}:${mode}`;

  function restore(r: CornellView) {
    setWork(r); setAnswers(r.answers); setSummary(r.summary); setDirty(false); setNotice("");
    const saved = stored(key) as { revision?: number; answers?: unknown; summary?: unknown } | null;
    if (saved?.revision === r.revision && Array.isArray(saved.answers) && saved.answers.length === r.questions.length &&
      saved.answers.every((a) => typeof a === "string" && a.length <= 900) && typeof saved.summary === "string" && saved.summary.length <= 2000) {
      setAnswers(saved.answers); setSummary(saved.summary); setDirty(true); setWork({ ...r, grade: null });
      setNotice("Bozza locale ripristinata. Salva per aggiornare la nota del corso.");
    } else if (saved && saved.revision !== r.revision) {
      setNotice("La bozza locale appartiene a una versione precedente. Sono mostrati gli appunti salvati più recenti.");
    }
  }
  useEffect(() => {
    if (mode !== "cornell") return;
    let cancelled = false;
    setBusy(true); setError("");
    api<{ work: CornellView | null }>("GET", `/api/lessons/cornell?domainId=${domainId}&documentId=${lesson.id}`)
      .then((r) => { if (!cancelled) { if (r.work) restore(r.work); else { setWork(null); setAnswers([]); setSummary(""); setDirty(false); setDrafts(null); } } })
      .catch((e) => { if (!cancelled) setError(messageOf(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
    // La chiave del componente cambia con corso, lezione e modalità.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainId, lesson.id, mode, retry]);

  async function start() {
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "cornell") restore((await post<{ work: CornellView }>("/api/lessons/cornell", { domainId, documentId: lesson.id, action: "start" })).work);
      else {
        const r = await post<PretestView>("/api/lessons/pretest", { domainId, documentId: lesson.id, action: "start" });
        setPretest(r);
        const saved = stored(key) as { revision?: number; answers?: unknown } | null;
        setAnswers(saved?.revision === r.revision && Array.isArray(saved.answers) && saved.answers.length === 3 && saved.answers.every((a) => typeof a === "string" && a.length <= 2000)
          ? saved.answers : r.questions.map(() => ""));
      }
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  function edit(nextAnswers: string[], nextSummary: string) {
    setAnswers(nextAnswers); setSummary(nextSummary); setDirty(true); setNotice(""); setDrafts(null); setReferences(null);
    if (work) setWork({ ...work, grade: null });
    stash(key, { revision: work?.revision ?? pretest?.revision, answers: nextAnswers, summary: nextSummary });
  }
  async function save(action: "save" | "check") {
    if (!work || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await post<{ work: CornellView }>("/api/lessons/cornell", { domainId, documentId: lesson.id, action, revision: work.revision, answers, summary });
      setWork(r.work); setDirty(false); stash(key, null);
      setNotice(action === "check" ? "Verifica salvata insieme agli appunti nella nota del corso." : "Appunti salvati nella nota del corso.");
      router.refresh();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  async function card(index: number) {
    if (!work || busy) return;
    setBusy(true); setError("");
    try {
      const r = await post<{ card: CardDraft }>("/api/lessons/cornell", { domainId, documentId: lesson.id, action: "card", revision: work.revision, index });
      setDrafts([r.card]);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  async function reveal() {
    if (!pretest || busy) return;
    setBusy(true); setError("");
    try {
      setReferences((await post<{ references: { answer: string; rationale: string }[] }>("/api/lessons/pretest", {
        domainId, documentId: lesson.id, action: "reveal", revision: pretest.revision, answers,
      })).references);
      setShowVideo(false);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  async function readMaterial() {
    if (showMaterial) { setShowMaterial(false); return; }
    if (material) { setShowMaterial(true); return; }
    setBusy(true); setError("");
    try {
      setMaterial(await api<{ text: string; partial: boolean }>("GET", `/api/lessons/material?domainId=${domainId}&documentId=${lesson.id}`));
      setShowMaterial(true);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  const questions = work?.questions ?? pretest?.questions;
  const tried = answers.length === 3 && answers.every((a) => a.trim());
  return (
    <div className="mt-4 flex flex-col gap-4">
      {error && <div role="alert" className="text-danger"><p>{error}</p>
        {mode === "cornell" && <button disabled={busy} style={buttonStyle(busy)} onClick={() => setRetry((n) => n + 1)}>Ricarica gli appunti salvati</button>}</div>}
      {notice && <p role="status" className="text-sm text-fg-muted">{notice}</p>}
      {busy && <p role="status"><span className="spin" /> {questions ? "Operazione in corso…" : "Preparo le domande…"}</p>}
      {!questions && !busy && <button style={S.ghost} onClick={start}>{mode === "cornell" ? "Prepara le domande guida" : "Prepara tre domande"}</button>}
      {(work?.partial || pretest?.partial) && <p className="text-sm text-fg-muted">Lezione lunga: le domande e la verifica usano una selezione di passaggi distribuiti lungo il materiale.</p>}
      {questions?.map((q, i) => (
        <div key={i} className="border-t border-border pt-3">
          <label className="block font-medium" htmlFor={`lesson-answer-${mode}-${i}`}>{i + 1}. {q}</label>
          <textarea id={`lesson-answer-${mode}-${i}`} aria-label={`${mode === "cornell" ? "Appunti" : "Tentativo"} ${i + 1}`} rows={3}
            maxLength={mode === "cornell" ? 900 : 2000} value={answers[i] ?? ""} disabled={busy}
            onChange={(e) => edit(answers.map((a, k) => k === i ? e.target.value : a), summary)}
            placeholder={mode === "cornell" ? "Scrivi i tuoi appunti…" : "Prova una risposta, oppure scrivi «non so»…"} style={{ ...S.textarea, marginTop: 8 }} />
          {work && <button style={buttonStyle(busy || dirty || !answers[i]?.trim())} disabled={busy || dirty || !answers[i]?.trim()} onClick={() => card(i)}>Crea carta da questa domanda</button>}
          {references?.[i] && <div className="mt-2 text-sm"><b>Risposta di riferimento:</b> {references[i].answer}
            {references[i].rationale && <p className="mt-1 text-fg-muted">{references[i].rationale}</p>}</div>}
        </div>
      ))}
      {work && <>
        <label className="block font-medium" htmlFor="cornell-summary">Riassunto finale · 3–5 frasi</label>
        <textarea id="cornell-summary" aria-label="Riassunto finale" maxLength={2000} rows={5} value={summary} disabled={busy}
          onChange={(e) => edit(answers, e.target.value)} style={S.textarea} placeholder="Collega i concetti principali con parole tue…" />
        <p className="text-sm text-fg-muted">{dirty ? "Bozza locale: salva per aggiornare la nota. Prima di creare carte, salva gli appunti." : "Puoi modificare gli appunti e salvare di nuovo la stessa nota."}</p>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} style={buttonStyle(busy)} onClick={() => save("save")}>Salva appunti</button>
          <button disabled={busy || !summary.trim()} style={buttonStyle(busy || !summary.trim())} onClick={() => save("check")}>Verifica riassunto</button>
        </div>
        {work.grade && <div aria-label="Verifica del riassunto" className="border-t border-border pt-3">
          <p>{work.grade.feedback}</p>
          {([["Punti coperti", work.grade.present], ["Punti mancanti", work.grade.missing], ["Errori da correggere", work.grade.errors]] as [string, string[]][]).map(([label, items]) =>
            items.length ? <div className="mt-3" key={label}><h3 className="font-medium">{label}</h3><ul className="list-disc pl-5">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div> : null)}
        </div>}
      </>}
      {pretest && <>
        <p className="text-sm text-fg-muted">Dopo il tentativo, guarda o leggi la lezione e cerca le risposte. Puoi confrontarle quando vuoi, senza voto.</p>
        <button disabled={busy || !tried} style={buttonStyle(busy || !tried)} onClick={reveal}>Confronta le risposte dopo il tentativo</button>
      </>}
      {lesson.video && (mode === "cornell" || tried) && <>
        <button style={S.ghost} onClick={() => setShowVideo((v) => !v)}>{showVideo ? "Chiudi video" : "Guarda la lezione"}</button>
        {showVideo && <video controls src={`/api/video?path=${encodeURIComponent(lesson.video)}`} className="w-full rounded-lg" aria-label={`Video: ${lesson.title}`} />}
      </>}
      {(mode === "cornell" || tried) && <>
        <button disabled={busy} style={buttonStyle(busy)} onClick={readMaterial}>{showMaterial ? "Chiudi materiale" : "Leggi il materiale della lezione"}</button>
        {showMaterial && material && <section aria-label="Materiale della lezione" className="border-t border-border pt-3">
          {material.partial && <p className="text-sm text-fg-muted mb-3">È mostrata la prima parte del materiale (100.000 caratteri). Per il documento completo, apri il file originale del corso.</p>}
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{material.text}</div>
        </section>}
      </>}
      {drafts && <CardPreview key={drafts[0].question} domainId={lesson.courseId} drafts={drafts} onDone={(message) => { setDrafts(null); setNotice(message); }} />}
    </div>
  );
}
