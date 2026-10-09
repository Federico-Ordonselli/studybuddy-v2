"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import type { AreaInfo } from "@/lib/areas";
import { MODULES } from "@/lib/modules";

const input = "bg-surface-2 border border-border rounded px-2 py-1 text-sm";

function Row({ a, first, last, onMove, run }: {
  a: AreaInfo; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void; run: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState(a.name);
  const [symbol, setSymbol] = useState(a.symbol);
  const [tagline, setTagline] = useState(a.tagline);
  const [module, setModule] = useState(a.module ?? "");
  const dirty = name !== a.name || symbol !== a.symbol || tagline !== a.tagline || module !== (a.module ?? "");
  const modules = Object.entries(MODULES);

  return (
    <li className="border border-border bg-surface rounded-lg p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Simbolo" className={`${input} w-12 text-center`} />
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome" className={`${input} flex-1 min-w-40 font-display`} />
        <span className="text-xs text-fg-dim tabular">{a.courses} {a.courses === 1 ? "corso" : "corsi"}</span>
        <button disabled={first} onClick={() => onMove(-1)} className="text-fg-dim hover:text-fg px-1" aria-label={`Sposta su ${a.name}`}>↑</button>
        <button disabled={last} onClick={() => onMove(1)} className="text-fg-dim hover:text-fg px-1" aria-label={`Sposta giù ${a.name}`}>↓</button>
      </div>
      <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Tagline (facoltativa)" aria-label="Tagline" className={input} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-xs text-fg-dim font-mono">/{a.slug}</span>
        <div className="flex items-center gap-3">
          {modules.length > 0 && (
            <select value={module} onChange={(e) => setModule(e.target.value)} aria-label="Modulo" className={input}>
              <option value="">nessun modulo</option>
              {modules.map(([k, m]) => <option key={k} value={k}>{m.title}</option>)}
            </select>
          )}
          <button disabled={!dirty} className="text-accent"
            onClick={() => run(() => api("PATCH", "/api/areas", { slug: a.slug, name, symbol, tagline, module: module || null }))}>
            Salva
          </button>
          <button className="text-danger"
            onClick={() => confirm(`Eliminare il dominio "${a.name}"? Nessun corso viene toccato.`) && run(() => api("DELETE", "/api/areas", { slug: a.slug }))}>
            Elimina
          </button>
        </div>
      </div>
    </li>
  );
}

/** Domini: crea, rinomina, simbolo, tagline, modulo, ordine, elimina (via /api/areas). */
export default function AreasManager({ areas }: { areas: AreaInfo[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); router.refresh(); return true; }
    catch (e) { setErr((e as Error).message); return false; }
    finally { setBusy(false); }
  }

  function move(i: number, dir: -1 | 1) {
    const order = areas.map((a) => a.slug);
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    run(() => api("PATCH", "/api/areas", { order }));
  }

  async function create() {
    if (await run(() => api("POST", "/api/areas", { name, symbol }))) { setName(""); setSymbol(""); }
  }

  return (
    <section className="flex flex-col gap-4" aria-busy={busy}>
      <div>
        <h2 className="font-display text-2xl">Domini</h2>
        <p className="text-sm text-fg-dim">Raggruppano i corsi nella Libreria. Lo slug (l&apos;indirizzo) resta fisso anche se rinomini.</p>
      </div>
      {areas.length === 0 && <p className="text-fg-muted text-sm">Nessun dominio ancora.</p>}
      <ul className="flex flex-col gap-2">
        {areas.map((a, i) => (
          // key con i campi: dopo router.refresh() la riga riparte dai valori salvati
          <Row key={`${a.slug}:${a.name}:${a.symbol}:${a.tagline}:${a.module}`} a={a} first={i === 0} last={i === areas.length - 1}
            onMove={(dir) => move(i, dir)} run={run} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="✦" aria-label="Simbolo del nuovo dominio" className={`${input} w-12 text-center`} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuovo dominio" aria-label="Nome del nuovo dominio"
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) create(); }} className={`${input} flex-1 min-w-40`} />
        <button disabled={busy || !name.trim()} onClick={create} className="bg-accent text-bg rounded-md px-3 py-1.5 text-sm font-medium">Crea</button>
      </div>
      {err && <p className="text-danger text-sm">{err}</p>}
    </section>
  );
}
