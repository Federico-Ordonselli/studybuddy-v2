import { sqlite } from "@/lib/db";
import { insideRoot } from "@/lib/fsRoot";
import {
  LibraryError, cleanName, normalizeAreas, findByPath, updateDomain, createMacro, createCourse,
} from "@/lib/library";
import { ingestCourse } from "@/lib/rag/sources/coursera";
import type { IngestPlan, PlanCourse, PlanMacro, PlanParent } from "@/lib/ingestPlanTypes";

/**
 * Esecuzione di un piano di import esplicito (costruito dall'anteprima in /add):
 * 1) `applyPlan` crea/aggiorna i domini come dice il piano, in una transazione;
 * 2) `runPlan` ingesta un corso alla volta riportando il progresso.
 * Il piano è l'unico punto, oltre alla Libreria, che cambia nome/macro/aree di un
 * dominio esistente: nessuna deduzione automatica dalle cartelle.
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

export interface IngestStep { dir: string; domainId: number; name: string; macro?: string }

function safePath(p: unknown): string {
  if (typeof p !== "string" || !p) throw new LibraryError("percorso mancante");
  const s = insideRoot(p);
  if (!s) throw new LibraryError("percorso fuori dalla root consentita", 403);
  return s;
}

function parseParent(p: unknown): PlanParent {
  if (p == null) return null;
  if (typeof p === "object" && "macroKey" in p && typeof p.macroKey === "string") return { macroKey: p.macroKey };
  if (typeof p === "object" && "existingId" in p && Number.isInteger(p.existingId)) return { existingId: Number(p.existingId) };
  throw new LibraryError("parent non valido");
}

/** Valida la forma del piano e la sandbox dei percorsi. Non tocca il DB. */
export function parsePlan(body: unknown): IngestPlan {
  const b = body as Partial<IngestPlan> | null;
  if (!b || !Array.isArray(b.macros) || !Array.isArray(b.courses)) throw new LibraryError("piano non valido");
  const macros: PlanMacro[] = b.macros.map((m) => ({
    key: String(m.key),
    existingId: Number.isInteger(m.existingId) ? m.existingId : undefined,
    name: cleanName(m.name),
    path: m.path == null ? null : safePath(m.path),
    areas: normalizeAreas(m.areas ?? []),
  }));
  const courses: PlanCourse[] = b.courses.map((c) => ({
    ...c,
    path: safePath(c.path),
    name: cleanName(c.name),
    areas: normalizeAreas(c.areas ?? []),
    parent: parseParent(c.parent),
    include: c.include === true,
  }));
  return { macros, courses, whisper: b.whisper === true };
}

export function applyPlan(plan: IngestPlan): IngestStep[] {
  return sqlite.transaction(() => {
    const included = plan.courses.filter((c) => c.include);
    const used = new Set(included.flatMap((c) => (c.parent && "macroKey" in c.parent ? [c.parent.macroKey] : [])));
    const byKey = new Map<string, { id: number; name: string }>();

    for (const m of plan.macros) {
      if (m.existingId != null) {
        updateDomain(m.existingId, { name: m.name, areas: m.areas });
        byKey.set(m.key, { id: m.existingId, name: m.name });
        continue;
      }
      if (!used.has(m.key)) continue; // niente macro vuoti
      const prev = m.path ? findByPath(m.path) : undefined;
      if (prev && prev.kind !== "macro") throw new LibraryError(`"${m.name}" è già importato come corso`);
      const id = prev ? (updateDomain(prev.id, { name: m.name, areas: m.areas }), prev.id) : createMacro(m.name, m.areas, [], m.path);
      byKey.set(m.key, { id, name: m.name });
    }

    const macroName = (id: number | null) =>
      id == null ? undefined : (sqlite.prepare("SELECT name FROM domains WHERE id = ?").get(id) as { name: string } | undefined)?.name;

    return included.map((c) => {
      let parentId: number | null = null;
      if (c.parent && "macroKey" in c.parent) {
        const m = byKey.get(c.parent.macroKey);
        if (!m) throw new LibraryError(`macro sconosciuto nel piano: ${c.parent.macroKey}`);
        parentId = m.id;
      } else if (c.parent) parentId = c.parent.existingId;

      const prev = findByPath(c.path);
      if (prev && prev.kind === "macro") throw new LibraryError(`"${c.name}" è già importato come macro`);
      const domainId = prev
        ? (updateDomain(prev.id, { name: c.name, areas: c.areas, parentId }), prev.id)
        : createCourse(c.name, c.path, parentId, c.areas);
      return { dir: c.path, domainId, name: c.name, macro: macroName(parentId) };
    });
  })();
}

export async function runPlan(
  steps: IngestStep[],
  opts: { whisper?: boolean; report?: (courses: CourseProgress[]) => void } = {}
): Promise<CourseProgress[]> {
  const courses: CourseProgress[] = steps.map((s) => ({
    name: s.name, macro: s.macro, total: 0, done: 0, documents: 0, chunks: 0, status: "pending",
  }));
  opts.report?.(courses);
  for (let i = 0; i < steps.length; i++) {
    courses[i].status = "running";
    opts.report?.(courses);
    try {
      const stats = await ingestCourse(steps[i].dir, steps[i].domainId, {
        whisper: !!opts.whisper,
        onProgress: (done, total) => { courses[i].done = done; courses[i].total = total; opts.report?.(courses); },
      });
      courses[i].documents = stats.documents;
      courses[i].chunks = stats.chunks;
      courses[i].status = "done";
    } catch (e) {
      courses[i].status = "error"; // un corso in errore non ferma gli altri
      courses[i].error = String(e);
    }
    opts.report?.(courses);
  }
  return courses;
}
