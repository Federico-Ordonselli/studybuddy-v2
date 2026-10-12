import { VERDICTS, type Grade, type Verdict } from "@/lib/tutor/grade";
export { VERDICTS, type Verdict };

/**
 * Set di valutazione del giudice (Fase 0 del piano): casi fissi domanda / attesa /
 * risposta con il verdetto umano, da rigirare a ogni modifica del prompt.
 * Logica pura: lo script `scripts/eval.ts` legge i file e chiama il modello.
 */

export interface GradingCase {
  id: string;
  question: string;
  expected: string;
  answer: string;
  verdict: Verdict;         // il verdetto di chi studia: è la verità del set
  tags: string[];           // es. perfect, partial, long-wrong, empty, it-en, synonym
  source?: string;          // passaggio sorgente: lo riceve il giudice
  cardId?: number;
  confirmed: boolean;       // false = verdetto proposto, ancora da rivedere a mano
}

export interface GradingOutcome {
  id: string;
  human: Verdict;
  model: Verdict | null;    // null = il giudice non ha prodotto un voto valido
  tags: string[];
}

const isVerdict = (v: unknown): v is Verdict => typeof v === "string" && (VERDICTS as readonly string[]).includes(v);

/** JSONL del set: una riga per caso; righe vuote e `//` ignorate. Errori con il numero di riga. */
export function parseGradingCases(text: string): GradingCase[] {
  const seen = new Set<string>();
  const out: GradingCase[] = [];
  text.split("\n").forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("//")) return;
    const fail = (why: string) => { throw new Error(`grading.jsonl riga ${i + 1}: ${why}`); };
    let c: Record<string, unknown>;
    try { c = JSON.parse(raw); } catch { return fail("JSON non valido"); }
    for (const k of ["id", "question", "expected", "answer"]) if (typeof c[k] !== "string") fail(`${k} deve essere una stringa`);
    if (!isVerdict(c.verdict)) fail(`verdict deve essere ${VERDICTS.join(" | ")}`);
    if (seen.has(c.id as string)) fail(`id duplicato ${c.id}`);
    seen.add(c.id as string);
    out.push({
      id: c.id as string,
      question: c.question as string,
      expected: c.expected as string,
      answer: c.answer as string,
      verdict: c.verdict as Verdict,
      tags: Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === "string") : [],
      source: typeof c.source === "string" ? c.source : undefined,
      cardId: typeof c.cardId === "number" ? c.cardId : undefined,
      confirmed: c.confirmed === true,
    });
  });
  return out;
}

/** Il giudice dà già il verdetto a 3 livelli (grade-v2). */
export function verdictFromGrade(g: Grade): Verdict {
  return g.verdict;
}

export interface GradingMetrics {
  total: number;
  judged: number;                 // casi con un voto valido del modello
  failures: number;               // il giudice ha lanciato (anche dopo il retry)
  exact: number;                  // accordo esatto sui judged (0–1)
  withinOne: number;              // accordo a distanza ≤ 1 sulla scala wrong < partial < correct
  confusion: Record<Verdict, Record<Verdict, number>>; // [umano][modello]
  longWrongAsCorrect: number;     // casi "long-wrong" promossi a correct: devono essere 0
  byTag: Record<string, { n: number; exact: number }>; // accordo esatto per tag (sui judged)
}

export function gradingMetrics(outcomes: GradingOutcome[]): GradingMetrics {
  const rank = (v: Verdict) => VERDICTS.indexOf(v);
  const confusion = Object.fromEntries(VERDICTS.map((h) => [h, Object.fromEntries(VERDICTS.map((m) => [m, 0]))])) as GradingMetrics["confusion"];
  const judged = outcomes.filter((o): o is GradingOutcome & { model: Verdict } => o.model !== null);
  for (const o of judged) confusion[o.human][o.model]++;
  const share = (n: number) => (judged.length ? n / judged.length : 0);
  return {
    total: outcomes.length,
    judged: judged.length,
    failures: outcomes.length - judged.length,
    exact: share(judged.filter((o) => o.human === o.model).length),
    withinOne: share(judged.filter((o) => Math.abs(rank(o.human) - rank(o.model)) <= 1).length),
    confusion,
    longWrongAsCorrect: judged.filter((o) => o.tags.includes("long-wrong") && o.model === "correct").length,
    byTag: Object.fromEntries([...new Set(judged.flatMap((o) => o.tags))].sort().map((tag) => {
      const group = judged.filter((o) => o.tags.includes(tag));
      return [tag, { n: group.length, exact: group.filter((o) => o.human === o.model).length / group.length }];
    })),
  };
}
