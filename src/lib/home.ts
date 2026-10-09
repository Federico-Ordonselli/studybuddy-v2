import { sqlite } from "@/lib/db";
import { listAreas } from "@/lib/areas";
import { countInbox } from "@/lib/notes";

/** Dati della home («Oggi») e della shell (sidebar, quick capture). Solo letture. */
const nowSec = () => Math.floor(Date.now() / 1000);

export interface DueItem { id: number; name: string; kind: string; due: number }
export interface RecentItem { id: number; name: string; kind: string; lastAt: string }
export interface ShellArea { slug: string; name: string; symbol: string; module: string | null }
export interface ShellData { areas: ShellArea[]; courses: { id: number; name: string }[]; dueTotal: number; inboxCount: number }

/** Domini (corsi o macro) con carte in scadenza adesso, dal più carico. */
export function dueByDomain(): DueItem[] {
  return sqlite.prepare(
    `SELECT d.id, d.name, d.kind, count(*) AS due
     FROM cards c JOIN domains d ON d.id = c.domain_id
     WHERE c.due_at <= ? GROUP BY d.id ORDER BY due DESC, d.name COLLATE NOCASE`
  ).all(nowSec()) as DueItem[];
}

export function dueTotal(): number {
  return (sqlite.prepare("SELECT count(*) AS n FROM cards WHERE due_at <= ?").get(nowSec()) as { n: number }).n;
}

/** Ultimi corsi studiati: per dominio l'ultima sessione (`updated_at`, o `created_at` sulle righe vecchie). */
export function recentCourses(limit = 4): RecentItem[] {
  const rows = sqlite.prepare(
    `SELECT d.id, d.name, d.kind, max(coalesce(s.updated_at, s.created_at)) AS last
     FROM sessions s JOIN domains d ON d.id = s.domain_id
     GROUP BY d.id ORDER BY last DESC LIMIT ?`
  ).all(limit) as { id: number; name: string; kind: string; last: number }[];
  return rows.map(({ last, ...r }) => ({ ...r, lastAt: new Date(last * 1000).toISOString() }));
}

export function getShellData(): ShellData {
  return {
    areas: listAreas().map(({ slug, name, symbol, module }) => ({ slug, name, symbol, module })),
    courses: sqlite.prepare("SELECT id, name FROM domains ORDER BY name COLLATE NOCASE").all() as { id: number; name: string }[],
    dueTotal: dueTotal(),
    inboxCount: countInbox(),
  };
}
