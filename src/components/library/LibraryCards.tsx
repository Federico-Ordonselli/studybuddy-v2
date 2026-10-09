"use client";

import Link from "next/link";
import type { CourseNode, Library, MacroNode } from "@/lib/library";
import DomainMenu from "./DomainMenu";

function Due({ n }: { n: number }) {
  return n > 0 ? <span className="text-accent tabular">{n} {n === 1 ? "carta" : "carte"} da ripassare</span> : null;
}

export function MacroCard({ m, library }: { m: MacroNode; library: Library }) {
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

export function CourseCard({ c, library }: { c: CourseNode; library: Library }) {
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
