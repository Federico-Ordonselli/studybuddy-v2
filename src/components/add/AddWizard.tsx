"use client";

import { useEffect, useRef, useState } from "react";
import { api, post } from "@/lib/client/api";
import type { IngestJob } from "@/lib/jobs";
import { defaultPlan, type IngestPlan, type ItemAnalysis } from "@/lib/ingestPlanTypes";
import type { Library } from "@/lib/library";
import FolderBrowser from "./FolderBrowser";
import ImportProgress from "./ImportProgress";
import PlanEditor from "./PlanEditor";

type Phase = "loading" | "edit" | "browse" | "importing";

function importTitle(job: IngestJob | null, lost: boolean) {
  if (lost) return "Import interrotto";
  if (!job || job.status === "running") return "Import in corso";
  const failed = job.status === "error" || job.courses.some((c) => c.status === "error");
  return failed ? "Import completato con errori" : "Import completato";
}

/** Aggiungi corso: analisi della cartella-libreria → anteprima modificabile → import con progresso. */
export default function AddWizard({ libraryDirName }: { libraryDirName: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [source, setSource] = useState<string | null>(null); // null = cartella-libreria
  const [items, setItems] = useState<ItemAnalysis[]>([]);
  const [plan, setPlan] = useState<IngestPlan | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [job, setJob] = useState<IngestJob | null>(null);
  const [lost, setLost] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function analyze(path: string | null) {
    setPhase("loading"); setErr(null); setSource(path);
    try {
      const r = await post<{ items: ItemAnalysis[] }>("/api/ingest-folder/analyze", path ? { path } : {});
      setItems(r.items); setPlan(defaultPlan(r.items)); setPhase("edit");
    } catch (e) { setErr((e as Error).message); setItems([]); setPlan(null); setPhase("edit"); }
  }

  function poll(id: string) {
    setPhase("importing");
    timer.current = setInterval(async () => {
      const r = await fetch(`/api/ingest-folder?job=${id}`);
      if (r.status === 404) { setLost(true); clearInterval(timer.current!); return; }
      const j: IngestJob = await r.json();
      setJob(j);
      if (j.status !== "running") clearInterval(timer.current!);
    }, 1000);
  }

  useEffect(() => {
    // Un import alla volta: se ce n'è uno in corso si mostra quello.
    fetch("/api/ingest-folder?active=1").then((r) => r.json()).then((r) => {
      if (r.job) { setJob(r.job); poll(r.job.id); } else void analyze(null);
    }).catch(() => void analyze(null));
    api<Library>("GET", "/api/library").then(setLibrary).catch(() => {});
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleKind(itemPath: string, as: "macro" | "course") {
    try {
      const r = await post<{ items: ItemAnalysis[] }>("/api/ingest-folder/analyze", { path: itemPath, as });
      const next = items.map((it) => (it.path === itemPath ? r.items[0] : it));
      setItems(next); setPlan(defaultPlan(next)); // le modifiche fatte all'anteprima si azzerano
    } catch (e) { setErr((e as Error).message); }
  }

  async function startImport() {
    if (!plan) return;
    setBusy(true); setErr(null);
    try { const r = await post<{ jobId: string }>("/api/ingest-folder", { plan }); poll(r.jobId); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-4xl w-full mx-auto px-4 md:px-8 py-10 flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-fg-dim mb-2">Aggiungi corso</div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight leading-none">
            {phase === "importing" ? importTitle(job, lost) : source ? source.split("/").pop() : `Cartella ${libraryDirName}/`}
          </h1>
          {phase === "edit" && !source && (
            <p className="text-sm text-fg-muted mt-2">Copia i corsi scaricati in <code>{libraryDirName}/</code>: compaiono qui. Scegliere un’altra cartella serve solo se il corso sta altrove.</p>
          )}
        </div>
        {phase === "edit" && (
          <div className="flex gap-3 text-sm">
            {source && <button onClick={() => analyze(null)} className="text-fg-dim hover:text-fg">← {libraryDirName}/</button>}
            <button onClick={() => analyze(source)} className="text-fg-dim hover:text-fg">Controlla aggiornamenti</button>
            <button onClick={() => setPhase("browse")} className="text-fg-dim hover:text-fg">Scegli un’altra cartella…</button>
          </div>
        )}
      </header>

      {err && <p className="text-danger text-sm">{err}</p>}
      {phase === "loading" && <p className="text-fg-dim"><span className="spin" /> analizzo la cartella…</p>}
      {phase === "browse" && <FolderBrowser onAnalyze={(p) => analyze(p)} onCancel={() => setPhase("edit")} />}
      {phase === "edit" && plan && (items.length ? (
        <PlanEditor items={items} plan={plan} setPlan={setPlan} busy={busy}
          existingMacros={(library?.macros ?? []).map(({ id, name }) => ({ id, name }))}
          areaSuggestions={library?.areas ?? []} onToggleKind={toggleKind} onImport={startImport} />
      ) : (
        <p className="text-fg-dim">Nessun corso trovato{source ? " in questa cartella" : ` in ${libraryDirName}/`}.</p>
      ))}
      {phase === "importing" && <ImportProgress job={job} lost={lost} />}
    </div>
  );
}
