"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import type { Library } from "@/lib/library";

/** Crea un macro a mano e ci mette dentro dei corsi sciolti. */
export default function NewMacroButton({ library }: { library: Library }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setErr(null);
    try {
      await api("POST", "/api/library", { name, courseIds: picked });
      setOpen(false); setName(""); setPicked([]); router.refresh();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="border border-border rounded-md px-3 py-1.5 text-sm hover:border-border-strong">Nuovo macro</button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 bg-surface border border-border rounded-lg p-3 shadow-xl flex flex-col gap-2 text-sm">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome del macro"
            className="bg-surface-2 border border-border rounded px-2 py-1" />
          {library.loose.length > 0 && <span className="text-[10px] uppercase tracking-[0.2em] text-fg-dim mt-1">Corsi da metterci dentro</span>}
          <div className="max-h-48 overflow-y-auto flex flex-col gap-1">
            {library.loose.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="checkbox" checked={picked.includes(c.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />
                {c.name}
              </label>
            ))}
          </div>
          <button disabled={!name.trim()} onClick={create} className="self-end bg-accent text-bg rounded px-3 py-1 font-medium">Crea</button>
          {err && <p className="text-danger text-xs">{err}</p>}
        </div>
      )}
    </div>
  );
}
