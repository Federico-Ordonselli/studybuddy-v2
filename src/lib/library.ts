import { sqlite } from "@/lib/db";

/**
 * Libreria: lettura dei domini per la UI e organizzazione manuale (rinomina, aree,
 * sposta in macro). Gerarchia a 2 livelli: macro → corsi. Le aree sono solo layout.
 * Ogni mutazione valida gli invarianti e lancia `LibraryError` (status HTTP incluso).
 */
export class LibraryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface CourseNode { id: number; name: string; path: string | null; areas: string[]; docs: number; due: number }
export interface MacroNode { id: number; name: string; path: string | null; areas: string[]; docs: number; due: number; courses: CourseNode[] }
export interface Library { macros: MacroNode[]; loose: CourseNode[]; areas: string[] }
export interface Trail {
  id: number;
  name: string;
  kind: "macro" | "course";
  macro: { id: number; name: string } | null;
  courses: { id: number; name: string }[];
}

interface Row { id: number; name: string; kind: string; parentId: number | null; path: string | null; areas: string | null; docs: number; due: number }

const nowSec = () => Math.floor(Date.now() / 1000);

function parseAreas(raw: string | null): string[] {
  try {
    const a = JSON.parse(raw ?? "[]");
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rows(): Row[] {
  return sqlite.prepare(
    `SELECT d.id, d.name, d.kind, d.parent_id AS parentId, d.path, d.areas,
            (SELECT count(*) FROM documents x WHERE x.domain_id = d.id) AS docs,
            (SELECT count(*) FROM cards c WHERE c.domain_id = d.id AND c.due_at <= ?) AS due
     FROM domains d ORDER BY d.name COLLATE NOCASE`
  ).all(nowSec()) as Row[];
}

export function getLibrary(): Library {
  const all = rows();
  const course = (r: Row): CourseNode => ({ id: r.id, name: r.name, path: r.path, areas: parseAreas(r.areas), docs: r.docs, due: r.due });
  const macros: MacroNode[] = all.filter((r) => r.kind === "macro").map((m) => {
    const courses = all.filter((r) => r.kind !== "macro" && r.parentId === m.id).map(course);
    return {
      id: m.id, name: m.name, path: m.path, areas: parseAreas(m.areas),
      docs: courses.reduce((n, c) => n + c.docs, 0),
      due: m.due + courses.reduce((n, c) => n + c.due, 0), // il ripasso del macro include i figli
      courses,
    };
  });
  const macroIds = new Set(macros.map((m) => m.id));
  // genitore sparito o non-macro: il corso si mostra sciolto invece di sparire
  const loose = all.filter((r) => r.kind !== "macro" && (r.parentId == null || !macroIds.has(r.parentId))).map(course);
  const areas = [...new Set([...macros, ...loose].flatMap((x) => x.areas))].sort((a, b) => a.localeCompare(b));
  return { macros, loose, areas };
}

export function getTrail(id: number): Trail | null {
  const lib = getLibrary();
  for (const m of lib.macros) {
    if (m.id === id) return { id, name: m.name, kind: "macro", macro: null, courses: m.courses.map(({ id, name }) => ({ id, name })) };
    const c = m.courses.find((x) => x.id === id);
    if (c) return { id, name: c.name, kind: "course", macro: { id: m.id, name: m.name }, courses: [] };
  }
  const c = lib.loose.find((x) => x.id === id);
  return c ? { id, name: c.name, kind: "course", macro: null, courses: [] } : null;
}

// --- validazione ---------------------------------------------------------------

export function cleanName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) throw new LibraryError("il nome non può essere vuoto");
  const n = name.trim().replace(/\s+/g, " ");
  if (n.length > 120) throw new LibraryError("nome troppo lungo (max 120 caratteri)");
  return n;
}

/** Stringhe non vuote, max 40 caratteri, dedup case-insensitive, max 10 aree. */
export function normalizeAreas(areas: unknown): string[] {
  if (!Array.isArray(areas)) throw new LibraryError("aree non valide");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of areas) {
    if (typeof a !== "string") continue;
    const t = a.trim().replace(/\s+/g, " ");
    if (!t || t.length > 40 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 10);
}

interface DomainRow { id: number; kind: string; parentId: number | null }

function find(id: number): DomainRow {
  const r = sqlite.prepare("SELECT id, kind, parent_id AS parentId FROM domains WHERE id = ?").get(id) as DomainRow | undefined;
  if (!r) throw new LibraryError("dominio non trovato", 404);
  return r;
}

/** Un corso può stare solo dentro un macro; un macro non può stare dentro niente. */
function checkParent(childKind: string, parentId: number | null) {
  if (parentId == null) return;
  if (childKind === "macro") throw new LibraryError("un macro non può stare dentro un altro macro");
  if (find(parentId).kind !== "macro") throw new LibraryError("un corso si può mettere solo dentro un macro");
}

export function findByPath(p: string) {
  const r = sqlite.prepare("SELECT id, kind, parent_id AS parentId, name, areas FROM domains WHERE path = ?").get(p) as
    | (DomainRow & { name: string; areas: string | null })
    | undefined;
  return r ? { ...r, areas: parseAreas(r.areas) } : undefined;
}

// --- mutazioni -----------------------------------------------------------------

export function updateDomain(id: number, patch: { name?: unknown; areas?: unknown; parentId?: unknown }) {
  const d = find(id);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) { sets.push("name = ?"); vals.push(cleanName(patch.name)); }
  if (patch.areas !== undefined) { sets.push("areas = ?"); vals.push(JSON.stringify(normalizeAreas(patch.areas))); }
  if (patch.parentId !== undefined) {
    const pid = patch.parentId === null ? null : Number(patch.parentId);
    if (pid !== null && !Number.isInteger(pid)) throw new LibraryError("parentId non valido");
    checkParent(d.kind, pid);
    sets.push("parent_id = ?");
    vals.push(pid);
  }
  if (!sets.length) return;
  sqlite.prepare(`UPDATE domains SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function createMacro(name: unknown, areas: unknown = [], courseIds: unknown = [], path: string | null = null): number {
  const n = cleanName(name);
  const a = normalizeAreas(areas);
  if (!Array.isArray(courseIds)) throw new LibraryError("courseIds non valido");
  return sqlite.transaction(() => {
    const id = Number(
      sqlite.prepare("INSERT INTO domains (name, kind, parent_id, path, areas, created_at) VALUES (?, 'macro', NULL, ?, ?, ?)")
        .run(n, path, JSON.stringify(a), nowSec()).lastInsertRowid
    );
    for (const c of courseIds) {
      const cd = find(Number(c));
      checkParent(cd.kind, id);
      sqlite.prepare("UPDATE domains SET parent_id = ? WHERE id = ?").run(id, cd.id);
    }
    return id;
  })();
}

export function createCourse(name: unknown, path: string, parentId: number | null, areas: unknown = []): number {
  checkParent("course", parentId);
  return Number(
    sqlite.prepare("INSERT INTO domains (name, kind, parent_id, path, areas, created_at) VALUES (?, 'course', ?, ?, ?, ?)")
      .run(cleanName(name), parentId, path, JSON.stringify(normalizeAreas(areas)), nowSec()).lastInsertRowid
  );
}

/** Elimina un macro; i corsi diventano sciolti. Bloccato se il macro ha dati di studio propri. */
export function deleteMacro(id: number) {
  const d = find(id);
  if (d.kind !== "macro") throw new LibraryError("si possono eliminare solo i macro");
  const own = sqlite.prepare(
    `SELECT (SELECT count(*) FROM cards WHERE domain_id = ?)
          + (SELECT count(*) FROM concept_maps WHERE domain_id = ?)
          + (SELECT count(*) FROM sessions WHERE domain_id = ?) AS n`
  ).get(id, id, id) as { n: number };
  if (own.n > 0) throw new LibraryError("questo macro ha carte, mappe o sessioni di studio proprie: non lo elimino", 409);
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE domains SET parent_id = NULL WHERE parent_id = ?").run(id);
    sqlite.prepare("DELETE FROM domains WHERE id = ?").run(id);
  })();
}
