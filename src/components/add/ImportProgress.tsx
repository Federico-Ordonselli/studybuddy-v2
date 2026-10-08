"use client";

import Link from "next/link";
import type { IngestJob } from "@/lib/jobs";

export default function ImportProgress({ job, lost }: { job: IngestJob | null; lost: boolean }) {
  if (lost) {
    return (
      <div className="border border-danger rounded-lg p-4 text-sm">
        L’import si è interrotto (server riavviato?). Rilancialo: riparte dai file mancanti, quelli già fatti vengono saltati.
        <div className="mt-3"><Link href="/add" className="text-accent underline">Ricomincia</Link></div>
      </div>
    );
  }
  if (!job) return null;
  const done = job.status !== "running";
  const first = job.courses.find((c) => c.status === "done");
  return (
    <div className="flex flex-col gap-3">
      {job.courses.map((c, i) => {
        const pct = c.total ? Math.round((c.done / c.total) * 100) : c.status === "done" ? 100 : 0;
        return (
          <div key={i} className="border border-border bg-surface rounded-lg p-3">
            <div className="flex justify-between text-sm">
              <span>{c.macro ? <span className="text-fg-dim">{c.macro} › </span> : null}{c.name}</span>
              <span className={c.status === "error" ? "text-danger" : c.status === "done" ? "text-ok" : "text-fg-dim"}>
                {c.status === "pending" ? "in attesa" : c.status === "running" ? `${c.done}/${c.total} file` : c.status === "done" ? `${c.documents} documenti · ${c.chunks} chunk` : "errore"}
              </span>
            </div>
            <div className="h-1 bg-surface-2 rounded mt-2 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
            {c.error && <p className="text-danger text-xs mt-2 break-all">{c.error}</p>}
          </div>
        );
      })}
      {job.error && <p className="text-danger text-sm break-all">{job.error}</p>}
      {done && (
        <div className="flex gap-3 mt-2">
          {first && <Link href={`/study/${first.domainId}`} className="bg-accent text-bg rounded-md px-4 py-2 font-medium">Studia ora</Link>}
          <Link href="/" className={first ? "border border-border rounded-md px-4 py-2 hover:border-border-strong" : "bg-accent text-bg rounded-md px-4 py-2 font-medium"}>Vai alla libreria</Link>
        </div>
      )}
    </div>
  );
}
