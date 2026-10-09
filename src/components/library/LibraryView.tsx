"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CourseNode, Library, MacroNode } from "@/lib/library";
import { CourseCard, MacroCard } from "./LibraryCards";
import NewMacroButton from "./NewMacroButton";

type Entry = { type: "macro"; m: MacroNode } | { type: "course"; c: CourseNode };
const NONE = ""; // chiave della sezione «Senza dominio» (nessuno slug è vuoto)

export default function LibraryView({ library, fresh, skipped, libraryDirName }: {
  library: Library; fresh: { path: string; name: string }[]; skipped: number; libraryDirName: string;
}) {
  const [q, setQ] = useState("");
  const empty = !library.macros.length && !library.loose.length;

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    const entries: Entry[] = [
      ...library.macros.filter((m) => match(m.name) || m.courses.some((c) => match(c.name))).map((m) => ({ type: "macro" as const, m })),
      ...library.loose.filter((c) => match(c.name)).map((c) => ({ type: "course" as const, c })),
    ];
    const by = new Map<string, Entry[]>();
    for (const e of entries) {
      const areas = e.type === "macro" ? e.m.areas : e.c.areas;
      for (const a of areas.length ? areas : [NONE]) by.set(a, [...(by.get(a) ?? []), e]);
    }
    const area = new Map(library.areas.map((a) => [a.slug, a]));
    const rank = (slug: string) => (slug === NONE ? Infinity : area.get(slug)?.position ?? Number.MAX_SAFE_INTEGER);
    return [...by.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([slug, list]) => {
        const a = area.get(slug);
        return { key: slug || "none", title: slug === NONE ? "Senza dominio" : a ? `${a.symbol} ${a.name}` : slug, tagline: a?.tagline ?? "", entries: list };
      });
  }, [library, q]);

  return (
    <div className="max-w-5xl w-full mx-auto px-4 md:px-8 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8 fade-up">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-fg-dim mb-2">Libreria</div>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight leading-none">I tuoi corsi</h1>
        </div>
        {!empty && (
          <div className="flex flex-wrap gap-2 items-center">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtra…"
              className="bg-surface-2 border border-border rounded-md px-3 py-1.5 text-sm w-44" />
            <NewMacroButton library={library} />
            <Link href="/settings" className="border border-border rounded-md px-3 py-1.5 text-sm hover:border-border-strong">Domini</Link>
            <Link href="/corsi/add" className="bg-accent text-bg rounded-md px-3 py-1.5 text-sm font-medium">+ Aggiungi corso</Link>
          </div>
        )}
      </header>

      {(fresh.length > 0 || skipped > 0) && (
        <Link href="/corsi/add" className="block mb-8 border border-accent-soft bg-surface rounded-lg px-4 py-3 text-sm hover:border-accent transition-colors">
          {fresh.length > 0 && <>
            <b className="text-accent">{fresh.length} {fresh.length === 1 ? "nuovo corso trovato" : "nuovi corsi trovati"}</b>{" "}
            in {libraryDirName}/: {fresh.map((f) => f.name).join(", ")}
          </>}
          {skipped > 0 && (
            <span className="text-fg-dim">
              {fresh.length > 0 ? " · " : `In ${libraryDirName}/: `}
              ⚠ {skipped} {skipped === 1 ? "link ignorato" : "link ignorati"} (rotti o fuori dalla cartella consentita)
            </span>
          )}
          {" — "}<span className="underline">{fresh.length > 0 ? "Importa" : "Dettagli"}</span>
        </Link>
      )}

      {empty ? (
        <div className="border border-dashed border-border rounded-lg px-8 py-14 text-center">
          <p className="text-fg-muted mb-4">Nessun corso ancora. Copia un corso scaricato in <code>{libraryDirName}/</code> oppure scegli una cartella.</p>
          <Link href="/corsi/add" className="bg-accent text-bg rounded-md px-4 py-2 font-medium">+ Aggiungi corso</Link>
        </div>
      ) : sections.length === 0 ? (
        <p className="text-fg-dim">Nessun risultato per “{q}”.</p>
      ) : (
        sections.map((s) => (
          <section key={s.key} className="mb-10">
            <h2 className="text-xs uppercase tracking-[0.3em] text-fg-dim mb-1">{s.title}</h2>
            {s.tagline && <p className="text-xs text-fg-dim mb-3">{s.tagline}</p>}
            <div className={`grid gap-3 sm:grid-cols-2 ${s.tagline ? "" : "mt-2"}`}>
              {s.entries.map((e) => e.type === "macro"
                ? <MacroCard key={`m${e.m.id}`} m={e.m} library={library} />
                : <CourseCard key={`c${e.c.id}`} c={e.c} library={library} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
