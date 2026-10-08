"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import type { Library } from "@/lib/library";
import AreaInput from "./AreaInput";

/** Menu "⋯" di una card: rinomina, aree, sposta in macro / rendi sciolto, elimina macro. */
export default function DomainMenu(p: {
  id: number; kind: "macro" | "course"; name: string; areas: string[]; parentId: number | null; library: Library;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(p.name);
  const [areas, setAreas] = useState(p.areas);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); setOpen(false); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  const patch = (body: Record<string, unknown>) => run(() => api("PATCH", "/api/library", { id: p.id, ...body }));
  const showAreas = p.kind === "macro" || p.parentId == null; // le aree valgono per macro e corsi sciolti

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="text-fg-dim hover:text-fg px-2 leading-none text-lg" aria-label="Azioni">⋯</button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 bg-surface border border-border rounded-lg p-3 shadow-xl flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-fg-dim">Nome</span>
            <div className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 bg-surface-2 border border-border rounded px-2 py-1" />
              <button disabled={busy || name.trim() === p.name} onClick={() => patch({ name })} className="text-accent">Salva</button>
            </div>
          </label>
          {showAreas && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.2em] text-fg-dim">Aree</span>
              <AreaInput value={areas} onChange={setAreas} suggestions={p.library.areas} />
              <button disabled={busy} onClick={() => patch({ areas })} className="self-end text-accent">Salva aree</button>
            </div>
          )}
          {p.kind === "course" && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.2em] text-fg-dim">Macro</span>
              <select value={p.parentId ?? ""} disabled={busy}
                onChange={(e) => patch({ parentId: e.target.value === "" ? null : Number(e.target.value) })}
                className="bg-surface-2 border border-border rounded px-2 py-1">
                <option value="">— nessuno (corso sciolto) —</option>
                {p.library.macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          )}
          {p.kind === "macro" && (
            <button disabled={busy} className="self-start text-danger"
              onClick={() => confirm(`Eliminare il macro "${p.name}"? I suoi corsi diventano sciolti; nessun materiale viene cancellato.`)
                && run(() => api("DELETE", "/api/library", { id: p.id }))}>
              Elimina macro
            </button>
          )}
          {err && <p className="text-danger text-xs">{err}</p>}
        </div>
      )}
    </div>
  );
}
