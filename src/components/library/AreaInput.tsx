"use client";

import { useId, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { Area, AreaInfo } from "@/lib/areas";

/**
 * Chip dei domini di un corso/macro. `value` sono slug; si mostrano simbolo e nome.
 * Invio o virgola: un nome esistente (a meno delle maiuscole) aggiunge quel dominio,
 * un nome nuovo lo crea (POST /api/areas). L'uscita dal campo aggiunge solo domini esistenti.
 */
export default function AreaInput({ value, onChange, areas, onCreated }: { value: string[]; onChange: (v: string[]) => void; areas: Area[]; onCreated?: (a: Area) => void }) {
  const [text, setText] = useState("");
  const [created, setCreated] = useState<Area[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const listId = useId(); // un datalist per istanza: con id condivisi vinceva il primo nel DOM
  const all = [...areas, ...created.filter((c) => !areas.some((a) => a.slug === c.slug))];
  const find = (t: string) => all.find((a) => a.name.toLowerCase() === t.toLowerCase());
  const label = (slug: string) => { const a = all.find((x) => x.slug === slug); return a ? `${a.symbol} ${a.name}` : slug; };

  async function add(raw: string, allowCreate: boolean) {
    const t = raw.trim().replace(/\s+/g, " ");
    setErr(null);
    if (!t) return;
    let a = find(t);
    if (!a && !allowCreate) return;
    setText("");
    if (!a) {
      try {
        a = (await api<{ area: Area }>("POST", "/api/areas", { name: t })).area;
        setCreated((c) => [...c, a!]);
        onCreated?.(a);
      } catch (e) {
        // creato altrove (un'altra riga, un'altra scheda): lo si ritrova per nome
        const existing = e instanceof ApiError && e.status === 409
          ? (await api<AreaInfo[]>("GET", "/api/areas").catch(() => [])).find((x) => x.name.toLowerCase() === t.toLowerCase())
          : undefined;
        if (!existing) { setErr((e as Error).message); return; }
        a = existing;
        setCreated((c) => [...c, a!]);
        onCreated?.(a);
      }
    }
    if (!value.includes(a.slug)) onChange([...value, a.slug]);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 bg-surface-2 border border-border rounded-full pl-2.5 pr-1 py-0.5 text-xs">
            {label(s)}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== s))} className="text-fg-dim hover:text-fg px-1" aria-label={`Rimuovi ${label(s)}`}>×</button>
          </span>
        ))}
        <input value={text} list={listId} placeholder="+ dominio"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text, true); } }}
          onBlur={() => text && add(text, false)}
          className="bg-transparent border-b border-border focus:border-accent outline-none text-xs py-0.5 w-24" />
        <datalist id={listId}>{all.filter((a) => !value.includes(a.slug)).map((a) => <option key={a.slug} value={a.name} />)}</datalist>
      </div>
      {err && <p className="text-danger text-xs">{err}</p>}
    </div>
  );
}
