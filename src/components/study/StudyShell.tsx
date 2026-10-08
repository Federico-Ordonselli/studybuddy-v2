"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Trail } from "@/lib/library";
import { MODES, type UrlMode } from "./modes";
import TutorView from "./TutorView";
import ReviewView from "./ReviewView";
import StudioView from "./StudioView";

export interface StudyTree {
  macros: { id: number; name: string; courses: { id: number; name: string }[] }[];
  loose: { id: number; name: string }[];
}

/** Barra dell'area studio (breadcrumb, cambio corso, modalità) + la vista della modalità. */
export default function StudyShell({ trail, tree, mode }: { trail: Trail; tree: StudyTree; mode: UrlMode }) {
  const router = useRouter();
  const [wide, setWide] = useState(false);   // la mappa concettuale usa tutta la larghezza
  const [draft, setDraft] = useState("");    // testo passato dallo Studio al tutor ("chiedi al tutor")
  // Il Tutor legge il draft solo al montaggio (stato iniziale): una volta mostrato si svuota,
  // altrimenti ricomparirebbe a ogni rimontaggio (cambio tab, key `${id}-${mode}`).
  useEffect(() => { if (mode === "tutor" && draft) setDraft(""); }, [mode, draft]);
  const go = (m: UrlMode) => router.push(`/study/${trail.id}?mode=${m}`, { scroll: false });
  const href = (id: number) => `/study/${id}?mode=${mode}`;

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full mx-auto px-4" style={{ maxWidth: mode === "studio" && wide ? 1600 : 900 }}>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-border">
        <nav className="flex items-center gap-2 text-sm min-w-0">
          <Link href="/" className="text-fg-dim hover:text-fg">Libreria</Link>
          {trail.macro && (<><span className="text-fg-dim">›</span>
            <Link href={href(trail.macro.id)} className="text-fg-muted hover:text-fg truncate">{trail.macro.name}</Link></>)}
          <span className="text-fg-dim">›</span>
          <span className="font-display text-lg truncate">{trail.name}</span>
          <details className="relative">
            <summary className="list-none cursor-pointer text-fg-dim hover:text-fg px-1" aria-label="Cambia corso">▾</summary>
            <div className="absolute z-20 mt-2 w-72 max-h-96 overflow-y-auto bg-surface border border-border rounded-lg p-2 shadow-xl">
              {tree.macros.map((m) => (
                <div key={m.id} className="mb-2">
                  <Link href={href(m.id)} className="block px-2 py-1 rounded text-sm font-medium hover:bg-surface-2">{m.name}</Link>
                  {m.courses.map((c) => (
                    <Link key={c.id} href={href(c.id)} className={`block pl-5 pr-2 py-1 rounded text-sm hover:bg-surface-2 ${c.id === trail.id ? "text-accent" : "text-fg-muted"}`}>{c.name}</Link>
                  ))}
                </div>
              ))}
              {tree.loose.map((c) => (
                <Link key={c.id} href={href(c.id)} className={`block px-2 py-1 rounded text-sm hover:bg-surface-2 ${c.id === trail.id ? "text-accent" : ""}`}>{c.name}</Link>
              ))}
            </div>
          </details>
        </nav>
        <div className="flex bg-surface-2 border border-border rounded-md overflow-hidden text-sm">
          {MODES.map((m) => (
            <button key={m.key} onClick={() => go(m.key)}
              className={`px-3.5 py-1.5 ${mode === m.key ? "bg-accent text-bg font-medium" : "text-fg-muted hover:text-fg"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {trail.kind === "macro" && (
        <div className="flex flex-wrap items-center gap-2 py-2 text-xs text-fg-dim">
          <span>Stai studiando tutti i {trail.courses.length} corsi:</span>
          {trail.courses.map((c) => (
            <Link key={c.id} href={href(c.id)} className="border border-border rounded-full px-2.5 py-0.5 hover:border-border-strong hover:text-fg">{c.name}</Link>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {mode === "studio" ? (
          <StudioView domainId={trail.id} onWide={setWide} onAskTutor={(text) => { setDraft(text); go("tutor"); }} />
        ) : mode === "review" ? (
          <ReviewView key={trail.id} domainId={trail.id} />
        ) : (
          <TutorView key={`${trail.id}-${mode}`} domainId={trail.id} mode={mode === "quiz" ? "quiz" : "socratic"} initialInput={mode === "tutor" ? draft : ""} />
        )}
      </div>
    </div>
  );
}
