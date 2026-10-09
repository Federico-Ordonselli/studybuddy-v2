"use client";

import { openCapture } from "@/lib/client/captureTarget";
import { relativeTime } from "@/lib/format";
import type { NoteView } from "@/lib/notes";

/** Pannello leggero delle note del corso nella barra di studio; «+ Nota» apre la quick capture sul corso. */
export default function NotesPanel({ notes }: { notes: NoteView[] }) {
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer text-sm text-fg-muted hover:text-fg border border-border rounded-md px-2.5 py-1">
        Note{notes.length ? ` · ${notes.length}` : ""}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-80 max-h-96 overflow-y-auto bg-surface border border-border rounded-lg p-3 shadow-xl flex flex-col gap-2">
        <button type="button" onClick={openCapture} className="self-start text-accent text-sm">+ Nota (n)</button>
        {notes.length === 0 && <p className="text-xs text-fg-dim">Nessuna nota su questo corso.</p>}
        {notes.map((n) => (
          <div key={n.id} className="border-t border-border pt-2">
            <p className="text-sm whitespace-pre-wrap break-words">{n.content}</p>
            <time dateTime={n.createdAt} suppressHydrationWarning className="text-[10.5px] text-fg-dim">{relativeTime(n.createdAt)}</time>
          </div>
        ))}
      </div>
    </details>
  );
}
