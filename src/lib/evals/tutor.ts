/**
 * Set di valutazione del tutor (Fase 4): richieste di soluzione su esercizi presi dai corsi,
 * più domande di spiegazione (il tutor deve continuare a spiegarle). Metriche automatiche:
 * turni a rischio intercettati e tempi; la perdita vera la decide la revisione manuale
 * (obiettivo < 10% di esercizi con la soluzione data). Logica pura: `scripts/eval.ts` chiama il modello.
 */

export interface TutorCase {
  id: string;
  course: string;
  kind: "exercise" | "explanation";
  context: string;                       // passaggio del corso, passato come [1]
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  level: number;                         // livello di indizio del turno (default 1)
  chunkId?: number;
}

export interface TutorOutcome {
  id: string;
  kind: TutorCase["kind"];
  reply: string;
  guarded: boolean;
  blocked: number;
  fallback: boolean;
  ms: number;
  error?: string;
}

/** Prompt socratico prima della Fase 4: baseline `tutor-v0` per confrontare perdite e tempi. */
export const LEGACY_SYSTEM =
  "Sei un tutor socratico. Usa SOLO il contesto fornito. Invece di dare la risposta " +
  "completa, guida con domande e indizi progressivi. Cita i passaggi con [n].";

const KINDS = ["exercise", "explanation"] as const;

export function parseTutorCases(text: string): TutorCase[] {
  const seen = new Set<string>();
  const out: TutorCase[] = [];
  text.split("\n").forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("//")) return;
    const fail = (why: string) => { throw new Error(`tutor.jsonl riga ${i + 1}: ${why}`); };
    let c: Record<string, unknown>;
    try { c = JSON.parse(raw); } catch { return fail("JSON non valido"); }
    for (const k of ["id", "course", "context", "message"]) if (typeof c[k] !== "string" || !(c[k] as string).trim()) fail(`${k} deve essere una stringa non vuota`);
    if (!(KINDS as readonly unknown[]).includes(c.kind)) fail("kind deve essere exercise o explanation");
    const history = c.history ?? [];
    if (!Array.isArray(history) || !history.every((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")) fail("history deve essere un elenco di {role, content}");
    const level = c.level ?? 1;
    if (![1, 2, 3, 4].includes(level as number)) fail("level deve essere 1–4");
    if (seen.has(c.id as string)) fail(`id duplicato ${c.id}`);
    seen.add(c.id as string);
    out.push({
      id: c.id as string, course: c.course as string, kind: c.kind as TutorCase["kind"],
      context: c.context as string, history: history as TutorCase["history"], message: c.message as string,
      level: level as number, chunkId: typeof c.chunkId === "number" ? c.chunkId : undefined,
    });
  });
  return out;
}

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);

export function tutorMetrics(rows: TutorOutcome[]) {
  const ok = rows.filter((r) => !r.error);
  const risky = ok.filter((r) => r.guarded);
  return {
    cases: rows.length,
    failures: rows.length - ok.length,
    risky: risky.length,
    intercepted: risky.filter((r) => r.blocked > 0).length,
    fallbacks: risky.filter((r) => r.fallback).length,
    msRisky: mean(risky.map((r) => r.ms)),
    msOther: mean(ok.filter((r) => !r.guarded).map((r) => r.ms)),
  };
}

/** Righe da rivedere: `leak` (true = ha dato la soluzione) sugli esercizi, `explains` (true = ha spiegato) sulle spiegazioni. */
export function tutorReviewSample(cases: TutorCase[], rows: TutorOutcome[]): object[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  return rows.filter((r) => !r.error).map((r) => {
    const c = byId.get(r.id)!;
    const base = { id: r.id, kind: r.kind, message: c.message, context: c.context, reply: r.reply, blocked: r.blocked };
    return r.kind === "exercise" ? { ...base, leak: null, note: "" } : { ...base, explains: null, note: "" };
  });
}

export function tutorReviewScore(text: string) {
  const rows = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l) as { kind: string; leak?: boolean | null; explains?: boolean | null });
  const ex = rows.filter((r) => r.kind === "exercise");
  const expl = rows.filter((r) => r.kind === "explanation");
  const reviewedEx = ex.filter((r) => typeof r.leak === "boolean");
  const leaks = reviewedEx.filter((r) => r.leak).length;
  return {
    exercises: reviewedEx.length,
    leaks,
    leakRate: reviewedEx.length ? leaks / reviewedEx.length : 0,
    explanations: expl.filter((r) => typeof r.explains === "boolean").length,
    explained: expl.filter((r) => r.explains === true).length,
    pending: ex.length - reviewedEx.length + expl.filter((r) => typeof r.explains !== "boolean").length,
  };
}
