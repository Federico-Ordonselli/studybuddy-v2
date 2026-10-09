"use client";

import { useEffect, useState } from "react";
import type { Health } from "@/lib/health";

const RERANKER: Record<Health["reranker"], string> = {
  idle: "non ancora caricato", loading: "in caricamento…", cuda: "GPU (CUDA)", cpu: "CPU", error: "errore",
};

function Dot({ ok }: { ok: boolean }) {
  return <span className={ok ? "text-ok" : "text-danger"} aria-hidden>●</span>;
}

/** Stato di DB, Ollama, reranker e Whisper da /api/health; «Verifica GPU» carica il reranker (?warm=1). */
export default function HealthPanel() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(warm = false) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/health${warm ? "?warm=1" : ""}`);
      setH(await r.json());
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <h2 className="font-display text-2xl">Stato</h2>
        <button disabled={busy} onClick={() => load(true)} className="border border-border rounded-md px-3 py-1.5 text-sm hover:border-border-strong">
          {busy ? <span className="spin" /> : "Verifica GPU"}
        </button>
      </div>
      {err && <p className="text-danger text-sm">{err}</p>}
      {h && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm border border-border bg-surface rounded-lg p-4">
          <dt className="text-fg-dim">Database</dt>
          <dd><Dot ok={h.db.ok} /> {h.db.ok ? "ok" : h.db.error}</dd>
          <dt className="text-fg-dim">Ollama</dt>
          <dd><Dot ok={h.ollama.ok} /> {h.ollama.ok ? `${h.ollama.url} · ${h.ollama.models?.length ?? 0} modelli` : `${h.ollama.url}: ${h.ollama.error}`}</dd>
          <dt className="text-fg-dim">Reranker</dt>
          <dd><Dot ok={h.reranker !== "error"} /> {RERANKER[h.reranker]}</dd>
          <dt className="text-fg-dim">Whisper</dt>
          <dd><Dot ok={h.whisper.available} /> {h.whisper.available ? "disponibile" : "nessun backend installato"}</dd>
        </dl>
      )}
    </section>
  );
}
