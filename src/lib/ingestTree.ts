import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { domains } from "@/lib/db/schema";
import { ingestCourse, subdirs, hasIngestibleContent } from "@/lib/rag/sources/coursera";

/**
 * Ingestione di una o più cartelle scelte, con split automatico macro→micro:
 * la cartella selezionata diventa un dominio `macro`, e ogni sua sottocartella con
 * materiale diventa un dominio `course` (micro). Se non ha sottocartelle-corso,
 * la cartella stessa è un corso singolo. I file spazzatura (.url, ecc.) sono ignorati.
 */
export interface CourseProgress {
  name: string;
  macro?: string;
  total: number;
  done: number;
  documents: number;
  chunks: number;
  status: "pending" | "running" | "done" | "error";
  error?: string;
}

/** Trova un dominio per cartella sorgente, o lo crea (idempotente per `path`). */
function upsertDomain(name: string, o: { kind: string; path: string; parentId?: number }) {
  const existing = db.select().from(domains).where(eq(domains.path, o.path)).get();
  if (existing) {
    if (existing.kind !== o.kind || existing.parentId !== (o.parentId ?? null)) {
      db.update(domains).set({ kind: o.kind, parentId: o.parentId ?? null }).where(eq(domains.id, existing.id)).run();
    }
    return existing;
  }
  return db.insert(domains).values({ name, kind: o.kind, parentId: o.parentId ?? null, path: o.path }).returning().get();
}

export async function ingestSelection(
  paths: string[],
  opts: { whisper?: boolean; report?: (courses: CourseProgress[]) => void } = {}
): Promise<CourseProgress[]> {
  const whisper = !!opts.whisper;

  // 1) pianifica: per ogni cartella, macro+micro oppure corso singolo
  const plans: Array<{ dir: string; domainId: number; name: string; macro?: string }> = [];
  for (const p of paths) {
    const base = path.basename(p);
    const micros: string[] = [];
    for (const s of await subdirs(p)) if (await hasIngestibleContent(s, whisper)) micros.push(s);

    if (micros.length > 0) {
      const macro = upsertDomain(base, { kind: "macro", path: p });
      for (const s of micros) {
        const micro = upsertDomain(path.basename(s), { kind: "course", parentId: macro.id, path: s });
        plans.push({ dir: s, domainId: micro.id, name: path.basename(s), macro: base });
      }
    } else if (await hasIngestibleContent(p, whisper)) {
      const d = upsertDomain(base, { kind: "course", path: p });
      plans.push({ dir: p, domainId: d.id, name: base });
    }
  }

  const courses: CourseProgress[] = plans.map((pl) => ({
    name: pl.name, macro: pl.macro, total: 0, done: 0, documents: 0, chunks: 0, status: "pending",
  }));
  opts.report?.(courses);

  // 2) ingesta un micro-corso alla volta, aggiornando il progresso
  for (let i = 0; i < plans.length; i++) {
    courses[i].status = "running";
    opts.report?.(courses);
    try {
      const stats = await ingestCourse(plans[i].dir, plans[i].domainId, {
        whisper,
        onProgress: (done, total) => {
          courses[i].done = done; courses[i].total = total; opts.report?.(courses);
        },
      });
      courses[i].documents = stats.documents;
      courses[i].chunks = stats.chunks;
      courses[i].status = "done";
    } catch (e) {
      courses[i].status = "error";
      courses[i].error = String(e);
    }
    opts.report?.(courses);
  }
  return courses;
}
