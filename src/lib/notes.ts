import { sqlite } from "@/lib/db";
import { LibraryError } from "@/lib/errors";
import { SAFE_AREAS, VISIBLE } from "@/lib/areas";

/**
 * Note dell'hub (quick capture). Una nota sta in un dominio (`domain` = slug di
 * `areas`), su un corso (`course_id` = `domains.id`, anche un macro) o nell'inbox
 * (nessuno dei due), mai in entrambi: una nota su un corso compare nei domini del corso.
 * Ogni mutazione valida e lancia `LibraryError` con lo status HTTP.
 */
export interface NoteView {
  id: number;
  content: string;
  domain: string | null;
  courseId: number | null;
  createdAt: string; // ISO
  where: string;     // "Inbox", "<simbolo> <dominio>" o il nome del corso
}

const MAX_LENGTH = 10000;
const nowSec = () => Math.floor(Date.now() / 1000);

interface Row {
  id: number; content: string; domain: string | null; courseId: number | null; createdAt: number;
  areaName: string | null; areaSymbol: string | null; courseName: string | null;
}

const SELECT = `SELECT n.id, n.content, n.domain, n.course_id AS courseId, n.created_at AS createdAt,
                       a.name AS areaName, a.symbol AS areaSymbol, c.name AS courseName
                FROM notes n LEFT JOIN areas a ON a.slug = n.domain LEFT JOIN domains c ON c.id = n.course_id`;
const ORDER = " ORDER BY n.created_at DESC, n.id DESC";

const view = (r: Row): NoteView => ({
  id: r.id,
  content: r.content,
  domain: r.domain,
  courseId: r.courseId,
  createdAt: new Date(r.createdAt * 1000).toISOString(),
  where: r.areaName ? `${r.areaSymbol} ${r.areaName}` : r.courseName ?? "Inbox",
});

function get(id: number): NoteView {
  const r = sqlite.prepare(`${SELECT} WHERE n.id = ?`).get(id) as Row | undefined;
  if (!r) throw new LibraryError("nota non trovata", 404);
  return view(r);
}

function cleanContent(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new LibraryError("la nota è vuota");
  const t = v.trim();
  if (t.length > MAX_LENGTH) throw new LibraryError(`nota troppo lunga (max ${MAX_LENGTH} caratteri)`);
  return t;
}

/** Destinazione: al più uno tra dominio e corso; entrambi assenti (o vuoti) = inbox. */
function target(input: { domain?: unknown; courseId?: unknown }): { domain: string | null; courseId: number | null } {
  const domain = input.domain == null || input.domain === "" ? null : input.domain;
  const courseId = input.courseId == null || input.courseId === "" ? null : input.courseId;
  if (domain !== null && courseId !== null) throw new LibraryError("una nota va in un dominio o su un corso, non in entrambi");
  if (domain !== null) {
    if (typeof domain !== "string" || !sqlite.prepare("SELECT 1 FROM areas WHERE slug = ?").get(domain)) {
      throw new LibraryError(`dominio sconosciuto: ${String(domain)}`);
    }
    return { domain, courseId: null };
  }
  if (courseId !== null) {
    const id = Number(courseId);
    if (!Number.isInteger(id) || !sqlite.prepare("SELECT 1 FROM domains WHERE id = ?").get(id)) {
      throw new LibraryError("corso sconosciuto");
    }
    return { domain: null, courseId: id };
  }
  return { domain: null, courseId: null };
}

// --- mutazioni -----------------------------------------------------------------

export function createNote(input: { content?: unknown; domain?: unknown; courseId?: unknown }): NoteView {
  const content = cleanContent(input.content);
  const t = target(input);
  const id = Number(
    sqlite.prepare("INSERT INTO notes (content, domain, course_id, created_at) VALUES (?, ?, ?, ?)")
      .run(content, t.domain, t.courseId, nowSec()).lastInsertRowid
  );
  return get(id);
}

export function moveNote(id: number, to: { domain?: unknown; courseId?: unknown }): NoteView {
  get(id);
  const t = target(to);
  sqlite.prepare("UPDATE notes SET domain = ?, course_id = ? WHERE id = ?").run(t.domain, t.courseId, id);
  return get(id);
}

export function deleteNote(id: number) {
  get(id);
  sqlite.prepare("DELETE FROM notes WHERE id = ?").run(id);
}

// --- letture -------------------------------------------------------------------

/** Tutta l'inbox; con `limit` solo le prime (SQLite: LIMIT -1 = nessun limite). */
export function listInbox(limit?: number): NoteView[] {
  return (sqlite.prepare(`${SELECT} WHERE n.domain IS NULL AND n.course_id IS NULL${ORDER} LIMIT ?`).all(limit ?? -1) as Row[]).map(view);
}

export function countInbox(): number {
  return (sqlite.prepare("SELECT count(*) AS n FROM notes WHERE domain IS NULL AND course_id IS NULL").get() as { n: number }).n;
}

/** Note di un corso; per un macro anche quelle dei suoi corsi. */
export function listForCourse(id: number): NoteView[] {
  return (sqlite.prepare(
    `${SELECT} WHERE n.course_id = ? OR n.course_id IN (SELECT id FROM domains WHERE parent_id = ?)${ORDER}`
  ).all(id, id) as Row[]).map(view);
}

/** Note del dominio + note sui suoi corsi: righe visibili con lo slug e figli dei macro con lo slug. */
export function listForArea(slug: string): NoteView[] {
  return (sqlite.prepare(
    `WITH tagged AS (SELECT d.id FROM domains d, json_each(${SAFE_AREAS}) j WHERE ${VISIBLE} AND j.value = ?)
     ${SELECT}
     WHERE n.domain = ?
        OR n.course_id IN (SELECT id FROM tagged)
        OR n.course_id IN (SELECT id FROM domains WHERE parent_id IN (SELECT id FROM tagged))${ORDER}`
  ).all(slug, slug) as Row[]).map(view);
}
