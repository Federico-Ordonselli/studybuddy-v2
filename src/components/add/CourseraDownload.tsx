"use client";

import { useEffect, useState } from "react";
import { api, post } from "@/lib/client/api";
import type { CourseraDownloadJob } from "@/lib/courseraDownload";

export default function CourseraDownload({ onReady }: { onReady: (path: string) => void }) {
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<"firefox" | "manual">("firefox");
  const [cauth, setCauth] = useState("");
  const [job, setJob] = useState<CourseraDownloadJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await api<{ job: CourseraDownloadJob | null }>("GET", "/api/coursera");
        if (!disposed) { setJob(r.job); setPollError(""); }
      } catch { if (!disposed) setPollError("Impossibile leggere lo stato del download."); }
      if (!disposed) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  const running = busy || job?.status === "running";
  return <section className="border border-border rounded-lg p-4 flex flex-col gap-3">
    <h2 className="font-display text-xl">Scarica da Coursera</h2>
    <p className="text-sm text-fg-muted">Incolla il link di un corso a cui hai accesso. Scarichiamo video, sottotitoli e letture organizzati per modulo, poi puoi analizzarli e importarli.</p>
    <form className="flex flex-col gap-3" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        const r = await post<{ job: CourseraDownloadJob }>("/api/coursera", { url, auth, ...(auth === "manual" ? { cauth } : {}) });
        setJob(r.job); setCauth("");
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>
      <label className="text-sm">Link del corso
        <input className="w-full mt-1 border border-border rounded p-2 bg-surface" type="url" required value={url} disabled={running}
          placeholder="https://www.coursera.org/learn/nome-corso" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="text-sm">Accesso a Coursera
        <select className="w-full mt-1 border border-border rounded p-2 bg-surface" value={auth} disabled={running}
          onChange={(e) => { setAuth(e.target.value as "firefox" | "manual"); setCauth(""); }}>
          <option value="firefox">Usa la sessione Firefox</option>
          <option value="manual">Inserisci CAUTH manualmente</option>
        </select>
      </label>
      {auth === "firefox" && <p className="text-sm text-fg-muted">Accedi a Coursera in Firefox su questo computer: leggiamo solo il cookie CAUTH, senza salvarlo. Se StudyBuddy gira in Docker, deve avere accesso in sola lettura alla cartella dei profili Firefox.</p>}
      {auth === "manual" && <>
      <label className="text-sm">Cookie CAUTH
        <input className="w-full mt-1 border border-border rounded p-2 bg-surface" type="password" autoComplete="off" required value={cauth} disabled={running}
          onChange={(e) => setCauth(e.target.value)} />
      </label>
      <details className="text-sm text-fg-muted"><summary>Come trovare CAUTH</summary>
        Accedi a Coursera nel browser, apri gli strumenti sviluppatore → Applicazione/Archiviazione → Cookie → coursera.org e copia il valore di CAUTH. Viene usato solo per questo download e non viene salvato.
      </details>
      </>}
      <button className="self-start border border-border rounded px-4 py-2 text-sm disabled:text-fg-dim" disabled={running}>
        {running ? "Download in corso…" : "Scarica corso"}
      </button>
    </form>
    <div aria-live="polite" className="text-sm">
      {job?.status === "running" && <p>Scarico {job.slug}. Puoi lasciare la pagina aperta o tornare più tardi. Il riavvio del server interrompe il download.</p>}
      {job?.status === "error" && <p className="text-danger">{job.error}</p>}
      {job?.status === "done" && job.warning && <p>{job.warning}</p>}
      {job?.status === "done" && job.path && <button className="text-accent" onClick={() => onReady(job.path!)}>Download completato: analizza e importa {job.slug} →</button>}
      {pollError && <p role="alert" className="text-danger">{pollError}</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  </section>;
}
