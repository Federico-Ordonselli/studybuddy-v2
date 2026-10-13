import type { IssueCode } from "@/lib/tutor/cardQuality";

/**
 * Set di valutazione del generatore di flashcard (Fase 3): passaggi di trascrizione fissi da
 * cui generare carte. Metriche: quota di carte che passano `checkCard` (obiettivo ≥ 85%) e
 * revisione manuale di 20 carte (obiettivo ≥ 17 da tenere senza modifiche).
 * Logica pura: lo script `scripts/eval.ts` legge i file e chiama il modello.
 */

export interface CardCase {
  id: string;
  course: string;
  content: string;
  docKind: string;          // di solito "transcript"
  chunkId?: number;
}

export interface CardCaseOutcome {
  id: string;
  course: string;
  cards: { question: string; answer: string; fact: string; issues: { code: IssueCode }[] }[];
  error?: string;
}

/** JSONL del set: una riga per passaggio; righe vuote e `//` ignorate. Errori con il numero di riga. */
export function parseCardCases(text: string): CardCase[] {
  const seen = new Set<string>();
  const out: CardCase[] = [];
  text.split("\n").forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("//")) return;
    const fail = (why: string) => { throw new Error(`cards.jsonl riga ${i + 1}: ${why}`); };
    let c: Record<string, unknown>;
    try { c = JSON.parse(raw); } catch { return fail("JSON non valido"); }
    for (const k of ["id", "course", "content"]) if (typeof c[k] !== "string" || !(c[k] as string).trim()) fail(`${k} deve essere una stringa non vuota`);
    if (seen.has(c.id as string)) fail(`id duplicato ${c.id}`);
    seen.add(c.id as string);
    out.push({
      id: c.id as string,
      course: c.course as string,
      content: c.content as string,
      docKind: typeof c.docKind === "string" ? c.docKind : "transcript",
      chunkId: typeof c.chunkId === "number" ? c.chunkId : undefined,
    });
  });
  return out;
}

export interface CardMetrics {
  cases: number;
  failures: number;                     // il modello ha lanciato
  emptyCases: number;                   // nessuna carta dal passaggio
  cards: number;
  passed: number;                       // carte senza problemi
  passRate: number;                     // passed / cards (0–1)
  byIssue: Partial<Record<IssueCode, number>>;
  byCourse: Record<string, { cards: number; passRate: number }>;
}

export function cardMetrics(outcomes: CardCaseOutcome[]): CardMetrics {
  const all = outcomes.flatMap((o) => o.cards);
  const passed = all.filter((c) => !c.issues.length).length;
  const byIssue: Partial<Record<IssueCode, number>> = {};
  for (const c of all) for (const i of c.issues) byIssue[i.code] = (byIssue[i.code] ?? 0) + 1;
  const courses = [...new Set(outcomes.map((o) => o.course))].sort();
  return {
    cases: outcomes.length,
    failures: outcomes.filter((o) => o.error).length,
    emptyCases: outcomes.filter((o) => !o.error && !o.cards.length).length,
    cards: all.length,
    passed,
    passRate: all.length ? passed / all.length : 0,
    byIssue,
    byCourse: Object.fromEntries(courses.map((course) => {
      const cs = outcomes.filter((o) => o.course === course).flatMap((o) => o.cards);
      return [course, { cards: cs.length, passRate: cs.length ? cs.filter((c) => !c.issues.length).length / cs.length : 0 }];
    })),
  };
}

export interface ReviewItem {
  caseId: string;
  question: string;
  answer: string;
  fact: string;
  keep: boolean | null;     // da compilare a mano: true = da tenere senza modifiche
}

/** `k` carte valide distribuite su tutto il set (deterministico: stesso risultato a ogni run). */
export function reviewSample(outcomes: CardCaseOutcome[], k = 20): ReviewItem[] {
  const valid = outcomes.flatMap((o) => o.cards.filter((c) => !c.issues.length).map((c) => ({ caseId: o.id, question: c.question, answer: c.answer, fact: c.fact, keep: null })));
  if (valid.length <= k) return valid;
  return Array.from({ length: k }, (_, i) => valid[Math.floor((i * valid.length) / k)]);
}

/** Esito della revisione manuale (JSONL di `ReviewItem` con `keep` compilato). */
export function reviewScore(text: string): { reviewed: number; kept: number; pending: number } {
  const items = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map((l) => JSON.parse(l) as ReviewItem);
  return {
    reviewed: items.filter((i) => typeof i.keep === "boolean").length,
    kept: items.filter((i) => i.keep === true).length,
    pending: items.filter((i) => typeof i.keep !== "boolean").length,
  };
}
