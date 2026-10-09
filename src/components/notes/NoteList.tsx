"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { relativeTime } from "@/lib/format";
import type { NoteView } from "@/lib/notes";
import type { ShellArea } from "@/lib/home";

/** Elenco di note con eliminazione e, se `movable`, spostamento (inbox ↔ domini). */
export default function NoteList({ notes, areas, showWhere = true, movable = false, empty }: {
  notes: NoteView[]; areas: ShellArea[]; showWhere?: boolean; movable?: boolean; empty?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(id: number, fn: () => Promise<unknown>) {
    setBusy(id); setErr(null);
    try { await fn(); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  if (!notes.length) return empty ? <p className="text-sm text-fg-dim">{empty}</p> : null;
  return (
    <div className="flex flex-col gap-2">
      {err && <p role="alert" className="text-danger text-xs">{err}</p>}
      <ul className="flex flex-col gap-2">
        {notes.map((n) => (
          <li key={n.id} className={`group border border-border bg-surface rounded-lg px-4 py-3 ${busy === n.id ? "opacity-60" : ""}`}>
            <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap break-words">{n.content}</p>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[10.5px] text-fg-dim uppercase tracking-[0.18em]">
              {showWhere && <span>{n.where}</span>}
              <time dateTime={n.createdAt} suppressHydrationWarning className="normal-case tracking-normal tabular">{relativeTime(n.createdAt)}</time>
              <span className="flex-1" />
              {movable && (
                <select value="" disabled={busy !== null} aria-label="Sposta nota"
                  onChange={(e) => {
                    const v = e.target.value;
                    run(n.id, () => api("PATCH", "/api/notes", { id: n.id, domain: v === "inbox" ? null : v }));
                  }}
                  className="bg-surface-2 border border-border rounded px-1.5 py-0.5 normal-case tracking-normal text-xs">
                  <option value="" disabled>Sposta in…</option>
                  {n.domain !== null || n.courseId !== null ? <option value="inbox">◌ Inbox</option> : null}
                  {areas.filter((a) => a.slug !== n.domain).map((a) => <option key={a.slug} value={a.slug}>{a.symbol} {a.name}</option>)}
                </select>
              )}
              <button type="button" disabled={busy !== null} aria-label="Elimina nota" title="Elimina"
                onClick={() => confirm("Eliminare la nota?") && run(n.id, () => api("DELETE", "/api/notes", { id: n.id }))}
                className="text-fg-dim hover:text-danger px-1 normal-case">✕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
