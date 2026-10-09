"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { noteBody, type CaptureTarget } from "@/lib/client/captureTarget";
import type { ShellArea } from "@/lib/home";

const same = (a: CaptureTarget, b: CaptureTarget) =>
  a.kind === b.kind && (a.kind !== "area" || a.slug === (b as typeof a).slug) && (a.kind !== "course" || a.id === (b as typeof a).id);

function Chip({ active, onClick, symbol, label }: { active: boolean; onClick: () => void; symbol: string; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-colors ${active
        ? "bg-surface-2 text-fg ring-1 ring-border-strong" : "text-fg-muted hover:text-fg hover:bg-surface-2"}`}>
      <span className={`text-sm leading-none ${active ? "text-accent" : ""}`}>{symbol}</span>
      <span className="max-w-40 truncate">{label}</span>
    </button>
  );
}

/**
 * Scrittura di un appunto: testo + destinazione (inbox, il corso aperto, un dominio).
 * ⌘/Ctrl+Invio salva, Esc chiude (`onDone`). Dopo il salvataggio aggiorna la pagina.
 */
export default function NoteComposer({ areas, courses, initial, autoFocus, onDone }: {
  areas: ShellArea[]; courses: { id: number; name: string }[]; initial: CaptureTarget; autoFocus?: boolean; onDone?: () => void;
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [target, setTarget] = useState<CaptureTarget>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const course = initial.kind === "course" ? courses.find((c) => c.id === initial.id) : undefined;

  async function save() {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true); setErr(null);
    try {
      await api("POST", "/api/notes", noteBody(text, target));
      setContent("");
      router.refresh();
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border bg-surface rounded-lg overflow-hidden focus-within:border-border-strong transition-colors shadow-xl">
      <textarea value={content} onChange={(e) => setContent(e.target.value)} autoFocus={autoFocus} rows={3}
        aria-label="Testo dell'appunto" placeholder="Un pensiero, un link, una domanda per dopo…"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); }
          else if (e.key === "Escape" && onDone) { e.preventDefault(); onDone(); }
        }}
        className="w-full bg-transparent px-5 py-4 text-[15px] leading-relaxed outline-none resize-none placeholder:text-fg-dim" />
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-border bg-bg/40">
        <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Destinazione">
          <Chip active={target.kind === "inbox"} onClick={() => setTarget({ kind: "inbox" })} symbol="◌" label="Inbox" />
          {initial.kind === "course" && (
            <Chip active={same(target, initial)} onClick={() => setTarget(initial)} symbol="▸" label={course?.name ?? "Questo corso"} />
          )}
          {areas.map((a) => (
            <Chip key={a.slug} active={target.kind === "area" && target.slug === a.slug}
              onClick={() => setTarget({ kind: "area", slug: a.slug })} symbol={a.symbol} label={a.name} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-fg-dim font-mono">⌘⏎</span>
          <button type="button" onClick={save} disabled={!content.trim() || busy}
            className="px-4 py-1.5 rounded-md text-xs uppercase tracking-[0.18em] font-medium bg-accent text-bg">
            {busy ? <span className="spin" /> : "Salva"}
          </button>
        </div>
      </div>
      {err && <p role="alert" className="text-danger text-xs px-5 pb-3">{err}</p>}
    </div>
  );
}
