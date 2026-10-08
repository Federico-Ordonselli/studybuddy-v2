/**
 * Tipi dell'analisi e del piano di import, condivisi tra server (lib/ingestPlan.ts,
 * lib/ingestTree.ts) e client (/add). Niente import Node qui.
 */
export type FileCounts = { transcript: number; html: number; pdf: number; text: number; video: number };
export type CourseStatus = "new" | "upToDate" | "changed";

export interface CourseAnalysis {
  path: string;
  name: string;
  existingId?: number;
  parentId?: number | null;   // organizzazione attuale nel DB (se il corso esiste già)
  areas: string[];
  counts: FileCounts;
  videosWithoutSubs: number;
  status: CourseStatus;
  changedFiles: number;       // file nuovi o modificati rispetto all'ultimo import
}

export interface ItemAnalysis {
  kind: "macro" | "course";
  path: string;
  name: string;
  existingId?: number;
  areas: string[];
  courses: CourseAnalysis[];  // per kind "course": un solo elemento, la cartella stessa
}

export interface PlanMacro { key: string; existingId?: number; name: string; path: string | null; areas: string[] }
export type PlanParent = { macroKey: string } | { existingId: number } | null;

export interface PlanCourse {
  path: string;
  name: string;
  areas: string[];
  parent: PlanParent;
  include: boolean;
  status: CourseStatus;
  changedFiles: number;
  videosWithoutSubs: number;
  counts: FileCounts;
}

export interface IngestPlan { macros: PlanMacro[]; courses: PlanCourse[]; whisper: boolean }

/**
 * Piano proposto dall'analisi. Un corso già nel DB tiene la sua organizzazione
 * attuale (macro, nome, aree): re-importare non disfa mai gli spostamenti manuali.
 * Preselezionati solo i corsi con qualcosa da fare.
 */
export function defaultPlan(items: ItemAnalysis[]): IngestPlan {
  const macros: PlanMacro[] = [];
  const courses: PlanCourse[] = [];
  for (const it of items) {
    if (it.kind === "macro") macros.push({ key: it.path, existingId: it.existingId, name: it.name, path: it.path, areas: it.areas });
    for (const c of it.courses) {
      const parent: PlanParent = c.existingId != null
        ? (c.parentId != null ? { existingId: c.parentId } : null)
        : it.kind === "macro"
          ? (it.existingId != null ? { existingId: it.existingId } : { macroKey: it.path })
          : null;
      courses.push({
        path: c.path, name: c.name, areas: c.areas, parent,
        include: c.status !== "upToDate",
        status: c.status, changedFiles: c.changedFiles, videosWithoutSubs: c.videosWithoutSubs, counts: c.counts,
      });
    }
  }
  return { macros, courses, whisper: false };
}

/** Mette i corsi indicati sotto un nuovo macro (senza cartella su disco). */
export function groupIntoNewMacro(plan: IngestPlan, coursePaths: string[], name: string): IngestPlan {
  const key = `new:${Date.now()}`;
  const wanted = new Set(coursePaths);
  return {
    ...plan,
    macros: [...plan.macros, { key, name, path: null, areas: [] }],
    courses: plan.courses.map((c) => (wanted.has(c.path) ? { ...c, parent: { macroKey: key } } : c)),
  };
}
