"use client";

import { useEffect, useState } from "react";

interface Listing { path: string; parent: string | null; dirs: { name: string; path: string }[] }

/** Browser cartelle (sandbox lato server in /api/fs). */
export default function FolderBrowser({ onAnalyze, onCancel }: { onAnalyze: (path: string) => void; onCancel: () => void }) {
  const [cur, setCur] = useState<string | undefined>();
  const [list, setList] = useState<Listing | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/fs${cur ? `?path=${encodeURIComponent(cur)}` : ""}`).then((r) => r.json()).then((j) => {
      if (j.error) setErr(j.error); else { setErr(null); setList(j); }
    }).catch((e) => setErr(String(e)));
  }, [cur]);

  return (
    <div className="border border-border bg-surface rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <code className="text-fg-muted truncate">{list?.path}</code>
        <button onClick={onCancel} className="text-fg-dim hover:text-fg">Annulla</button>
      </div>
      <div className="max-h-80 overflow-y-auto flex flex-col">
        {list?.parent && <button onClick={() => setCur(list.parent!)} className="text-left px-2 py-1 rounded hover:bg-surface-2 text-fg-dim">↑ ..</button>}
        {list?.dirs.map((d) => (
          <button key={d.path} onClick={() => setCur(d.path)} className="text-left px-2 py-1 rounded hover:bg-surface-2">📁 {d.name}</button>
        ))}
      </div>
      {err && <p className="text-danger text-xs">{err}</p>}
      <button disabled={!list} onClick={() => list && onAnalyze(list.path)} className="self-end bg-accent text-bg rounded-md px-3 py-1.5 text-sm font-medium">
        Analizza questa cartella
      </button>
    </div>
  );
}
