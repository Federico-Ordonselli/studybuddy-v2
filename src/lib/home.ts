import { sqlite } from "@/lib/db";
import { listAreas } from "@/lib/areas";
import { countInbox } from "@/lib/notes";
import { resolveScope } from "@/lib/rag/store";

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
     WHERE c.suspended = 0 AND c.due_at <= ? GROUP BY d.id ORDER BY due DESC, d.name COLLATE NOCASE`
  ).all(nowSec()) as DueItem[];
}

export function dueTotal(): number {
  return (sqlite.prepare("SELECT count(*) AS n FROM cards WHERE suspended = 0 AND due_at <= ?").get(nowSec()) as { n: number }).n;
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

export interface CalibrationLevel { confidence: 1 | 2 | 3; total: number; correct: number; pct: number | null }
export interface Calibration { days: number; levels: CalibrationLevel[]; overconfident: boolean }

/** Sotto questa precisione su «Sicuro», con almeno `CALIBRATION_MIN_SURE` review, la home lo fa notare (piano 6.3). */
export const CALIBRATION_SURE_PCT = 70;
export const CALIBRATION_MIN_SURE = 20;

/**
 * Calibrazione della fiducia (Fase 6) da `review_logs`: per ogni livello, la quota di risposte corrette
 * (rating Good o Easy, cioè verdetto correct) negli ultimi `days` giorni. Le review corrette a mano contano
 * con il voto corretto (l'originale ha `overridden = 1`). Senza `domainId` tutti i corsi; un macro include i figli.
 */
export function calibration(domainId?: number, days = 30): Calibration {
  const scope = resolveScope(domainId);
  const where = scope ? `AND c.domain_id IN (${scope.map(() => "?").join(",")})` : "";
  const rows = sqlite.prepare(
    `SELECT l.confidence AS confidence, count(*) AS total, sum(l.rating >= 3) AS correct
     FROM review_logs l JOIN cards c ON c.id = l.card_id
     WHERE l.overridden = 0 AND l.confidence IS NOT NULL AND l.reviewed_at >= ? ${where}
     GROUP BY l.confidence`
  ).all(nowSec() - days * 86400, ...(scope ?? [])) as { confidence: number; total: number; correct: number }[];
  const levels = ([1, 2, 3] as const).map((confidence) => {
    const r = rows.find((x) => x.confidence === confidence);
    const total = r?.total ?? 0, correct = r?.correct ?? 0;
    return { confidence, total, correct, pct: total ? Math.round((correct / total) * 100) : null };
  });
  const sure = levels[2];
  return { days, levels, overconfident: sure.total >= CALIBRATION_MIN_SURE && sure.pct! < CALIBRATION_SURE_PCT };
}

export function getShellData(): ShellData {
  return {
    areas: listAreas().map(({ slug, name, symbol, module }) => ({ slug, name, symbol, module })),
    courses: sqlite.prepare("SELECT id, name FROM domains ORDER BY name COLLATE NOCASE").all() as { id: number; name: string }[],
    dueTotal: dueTotal(),
    inboxCount: countInbox(),
  };
}
