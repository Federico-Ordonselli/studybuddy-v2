"use client";

import { useCallback, useEffect, useState } from "react";
import { api, post } from "@/lib/client/api";
import type { ProofreadJob, VaultInfo } from "@/lib/proofread/job";

interface State {
  vaults: VaultInfo[];
  job: ProofreadJob | null;
  root: string;
}

const STATUS: Record<ProofreadJob["status"], string> = {
  running: "In corso",
  done: "Completata",
  error: "Interrotta da un errore",
  cancelled: "Interrotta",
};

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function when(iso?: string) {
  return iso ? new Date(iso).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) : "mai";
}

/**
 * Correzione degli appunti Obsidian (lib/proofread): un bottone per vault avvia una passata
 * che scrive la copia `<vault>-pulito`. Avanzamento in polling da /api/proofread.
 */
export default function ProofreadPanel() {
  const [s, setS] = useState<State | null>(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setS(await api<State>("GET", "/api/proofread"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const running = s?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [running, load]);

  async function start(vault: string) {
    setBusy(true); setError("");
    try {
      await post("/api/proofread", { vault, force });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function cancel() {
    setBusy(true); setError("");
    try { await api("DELETE", "/api/proofread"); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const job = s?.job;
  const pct = job && job.total ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-2xl">Appunti Obsidian</h2>
      <p className="text-sm text-fg-muted">
        Crea una copia corretta di un vault (refusi, accenti, punteggiatura e formattazione) nella cartella
        <span className="font-mono"> nome-pulito</span> accanto al vault. Gli appunti originali non vengono toccati; le note già
        corrette e non modificate vengono saltate. Dove la correzione cambierebbe il contenuto, il testo resta com’era ed è
        segnalato qui sotto.
      </p>

      {s && !s.vaults.length && (
        <p className="text-sm border border-border bg-surface rounded-lg p-4">
          Nessun vault in <span className="font-mono break-all">{s.root}</span>. Metti lì la cartella del vault oppure
          imposta <span className="font-mono">STUDYBUDDY_OBSIDIAN_DIR</span>.
        </p>
      )}

      {!!s?.vaults.length && (
        <ul className="flex flex-col gap-2">
          {s.vaults.map((v) => {
            const mine = job?.vault === v.name;
            return (
              <li key={v.name} className="border border-border bg-surface rounded-lg p-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-fg-dim">
                      {n(v.notes, "nota", "note")} · ultima correzione: {when(v.lastRun)} · copia in{" "}
                      <span className="font-mono">{v.copy}</span>
                    </div>
                  </div>
                  {mine && running ? (
                    <button onClick={cancel} disabled={busy}
                      className="border border-border rounded-md px-3 py-1.5 text-sm hover:border-border-strong disabled:text-fg-subtle disabled:bg-surface-2">
                      Interrompi
                    </button>
                  ) : (
                    <button onClick={() => start(v.name)} disabled={busy || running}
                      className="bg-accent text-on-accent hover:bg-accent-hover rounded-md px-3 py-1.5 text-sm disabled:bg-surface-2 disabled:text-fg-subtle">
                      Correggi appunti
                    </button>
                  )}
                </div>

                {mine && job && (
                  <div className="flex flex-col gap-2 text-sm" aria-live="polite">
                    <div className="flex justify-between gap-2">
                      <span>{STATUS[job.status]}{running && job.current ? ` · ${job.current}` : ""}</span>
                      <span className="text-fg-dim tabular-nums">{job.processed}/{job.total || "…"}</span>
                    </div>
                    {running && (
                      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden" role="progressbar"
                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Avanzamento della correzione">
                        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {!running && (
                      <p className="text-fg-muted">
                        {n(job.counts.corrected, "nota corretta", "note corrette")} · {n(job.counts.unchanged, "già a posto", "già a posto")}
                        {" · "}{n(job.counts.skipped, "invariata", "invariate")}
                        {job.counts.copied ? ` · ${n(job.counts.copied, "file copiato", "file copiati")}` : ""}
                        {job.counts.removed ? ` · ${n(job.counts.removed, "file tolto", "file tolti")} dalla copia` : ""}
                        {job.counts.error ? ` · ${n(job.counts.error, "nota", "note")} con errori` : ""}
                      </p>
                    )}
                    {job.error && <p role="alert" className="text-danger">{job.error}</p>}
                    {job.errors.map((e) => (
                      <p key={e.file} className="text-danger">⚠ {e.file}: {e.error}</p>
                    ))}
                  </div>
                )}

                {!!v.review.length && !(mine && running) && (
                  <details className="text-sm">
                    <summary className="cursor-pointer">
                      Da rivedere: {v.review.length} {v.review.length === 1 ? "parte lasciata" : "parti lasciate"} com’era
                    </summary>
                    <ul className="mt-2 flex flex-col gap-2">
                      {v.review.map((r, i) => (
                        <li key={`${r.file}-${i}`} className="border-l-2 border-border-strong pl-3">
                          <div className="font-mono text-xs">{r.file}</div>
                          <div className="text-fg-muted">«{r.excerpt}»</div>
                          <div className="text-xs text-fg-dim">{r.reason}</div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!!s?.vaults.length && (
        <label className="text-sm flex items-center gap-2 self-start">
          <input type="checkbox" checked={force} disabled={running} onChange={(e) => setForce(e.target.checked)} />
          Ricorreggi anche le note già fatte
        </label>
      )}
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
    </section>
  );
}
