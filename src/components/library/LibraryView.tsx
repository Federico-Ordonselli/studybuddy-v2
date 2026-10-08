"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CourseNode, Library, MacroNode } from "@/lib/library";
import DomainMenu from "./DomainMenu";
import NewMacroButton from "./NewMacroButton";

type Entry = { type: "macro"; m: MacroNode } | { type: "course"; c: CourseNode };
const NONE = "Senza area";

function Due({ n }: { n: number }) {
  return n > 0 ? <span className="text-accent tabular">{n} {n === 1 ? "carta" : "carte"} da ripassare</span> : null;
}

function MacroCard({ m, library }: { m: MacroNode; library: Library }) {
  return (
    <div className="border border-border bg-surface rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/study/${m.id}`} className="group min-w-0">
          <div className="text-[10px] uppercase tracking-[0.25em] text-fg-dim">Macro</div>
          <div className="font-display text-xl leading-tight group-hover:text-accent transition-colors">{m.name}</div>
          <div className="text-xs text-fg-dim mt-1 flex gap-3">
            <span className="tabular">{m.courses.length} {m.courses.length === 1 ? "corso" : "corsi"}</span><Due n={m.due} />
          </div>
        </Link>
        <DomainMenu id={m.id} kind="macro" name={m.name} areas={m.areas} parentId={null} library={library} />
      </div>
      {m.courses.length > 0 && (
        <ul className="flex flex-col border-t border-border pt-2">
          {m.courses.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <Link href={`/study/${c.id}`} className="py-1 text-sm text-fg-muted hover:text-fg truncate">▸ {c.name}</Link>
              <DomainMenu id={c.id} kind="course" name={c.name} areas={c.areas} parentId={m.id} library={library} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CourseCard({ c, library }: { c: CourseNode; library: Library }) {
  return (
    <div className="border border-border bg-surface rounded-lg p-4 flex items-start justify-between gap-2">
      <Link href={`/study/${c.id}`} className="group min-w-0">
        <div className="text-[10px] uppercase tracking-[0.25em] text-fg-dim">Corso</div>
        <div className="font-display text-xl leading-tight group-hover:text-accent transition-colors">{c.name}</div>
        <div className="text-xs text-fg-dim mt-1 flex gap-3"><span className="tabular">{c.docs} documenti</span><Due n={c.due} /></div>
      </Link>
      <DomainMenu id={c.id} kind="course" name={c.name} areas={c.areas} parentId={null} library={library} />
    </div>
  );
}

export default function LibraryView({ library, fresh, libraryDirName }: {
  library: Library; fresh: { path: string; name: string }[]; libraryDirName: string;
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
    return [...by.entries()].sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)));
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
            <Link href="/add" className="bg-accent text-bg rounded-md px-3 py-1.5 text-sm font-medium">+ Aggiungi corso</Link>
          </div>
        )}
      </header>

      {fresh.length > 0 && (
        <Link href="/add" className="block mb-8 border border-accent-soft bg-surface rounded-lg px-4 py-3 text-sm hover:border-accent transition-colors">
          <b className="text-accent">{fresh.length} {fresh.length === 1 ? "nuovo corso trovato" : "nuovi corsi trovati"}</b>{" "}
          in {libraryDirName}/: {fresh.map((f) => f.name).join(", ")} — <span className="underline">Importa</span>
        </Link>
      )}

      {empty ? (
        <div className="border border-dashed border-border rounded-lg px-8 py-14 text-center">
          <p className="text-fg-muted mb-4">Nessun corso ancora. Copia un corso scaricato in <code>{libraryDirName}/</code> oppure scegli una cartella.</p>
          <Link href="/add" className="bg-accent text-bg rounded-md px-4 py-2 font-medium">+ Aggiungi corso</Link>
        </div>
      ) : sections.length === 0 ? (
        <p className="text-fg-dim">Nessun risultato per “{q}”.</p>
      ) : (
        sections.map(([area, entries]) => (
          <section key={area} className="mb-10">
            <h2 className="text-xs uppercase tracking-[0.3em] text-fg-dim mb-3">{area}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {entries.map((e) => e.type === "macro"
                ? <MacroCard key={`m${e.m.id}`} m={e.m} library={library} />
                : <CourseCard key={`c${e.c.id}`} c={e.c} library={library} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
