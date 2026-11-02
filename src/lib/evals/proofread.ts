/**
 * Metriche dell'eval di `proofread`: quanto della distanza fra l'appunto con i refusi e la
 * versione di riferimento la correzione recupera, e se tocca ciò che non deve (parole
 * tolte, contenuto cambiato, codice/link alterati). Puro: niente provider.
 *
 * Qui il confronto è sensibile ad accenti e apostrofi ("e'" ≠ "è"), a differenza del
 * controllo di produzione in `proofread/guard.ts`, che li ignora apposta.
 */
import { protect } from "@/lib/proofread/protect";
import { compareWords } from "@/lib/proofread/guard";

export interface ProofreadCase {
  id: string;
  tags: string[];
  input: string;
  expected: string;
  /** frasi che devono restare identiche (es. un errore di contenuto da non "correggere") */
  keep?: string[];
}

export interface ProofreadOutcome {
  id: string;
  tags: string[];
  /** distanza in parole input → riferimento (i refusi da correggere) */
  baseline: number;
  /** distanza in parole uscita → riferimento (ciò che resta da sistemare o è stato rovinato) */
  residual: number;
  /** parole vere tolte dall'input (controllo di produzione) */
  deleted: number;
  /** codice, link, formule dell'input non più presenti identici */
  brokenProtected: number;
  /** frasi `keep` alterate */
  brokenKeep: number;
  rejected: number;
  ms: number;
  output: string;
}

export function parseProofreadCases(json: string): ProofreadCase[] {
  const cases = JSON.parse(json) as ProofreadCase[];
  if (!Array.isArray(cases)) throw new Error("proofread.json: attesa una lista di casi");
  for (const c of cases) {
    if (!c.id || typeof c.input !== "string" || typeof c.expected !== "string") throw new Error(`caso non valido: ${JSON.stringify(c).slice(0, 80)}`);
    c.tags ??= [];
  }
  return cases;
}

/** Parole con accenti e apostrofi, minuscole: la maiuscola a inizio frase non pesa. */
export function exactTokens(text: string): string[] {
  return text.normalize("NFC").toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}]+(?:'(?![\p{L}]))?/gu) ?? [];
}

/** Levenshtein su sequenze di parole. */
export function wordDistance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** La frase c'è identica e non è l'inizio di una parola più lunga ("non volat" ≠ "non volatile"). */
function keeps(output: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?![\\p{L}\\p{N}])`, "u").test(output);
}

export function scoreCase(c: ProofreadCase, output: string, rejected: number, ms: number): ProofreadOutcome {
  const exp = exactTokens(c.expected);
  const slots = protect(c.input).slots;
  return {
    id: c.id,
    tags: c.tags,
    baseline: wordDistance(exactTokens(c.input), exp),
    residual: wordDistance(exactTokens(output), exp),
    deleted: compareWords(c.input, output).deleted,
    brokenProtected: slots.filter((s) => !output.includes(s)).length,
    brokenKeep: (c.keep ?? []).filter((k) => !keeps(output, k)).length,
    rejected,
    ms,
    output,
  };
}

export function proofreadMetrics(rows: ProofreadOutcome[]) {
  const baseline = rows.reduce((s, r) => s + r.baseline, 0);
  const residual = rows.reduce((s, r) => s + r.residual, 0);
  return {
    cases: rows.length,
    /** quota della distanza recuperata (1 = uscita identica al riferimento, <0 = peggiorata) */
    recovered: baseline ? (baseline - residual) / baseline : 1,
    exact: rows.filter((r) => r.residual === 0).length,
    /** casi peggiorati rispetto all'input */
    worse: rows.filter((r) => r.residual > r.baseline).length,
    deletedWords: rows.reduce((s, r) => s + r.deleted, 0),
    brokenProtected: rows.reduce((s, r) => s + r.brokenProtected, 0),
    brokenKeep: rows.reduce((s, r) => s + r.brokenKeep, 0),
    rejectedSections: rows.reduce((s, r) => s + r.rejected, 0),
    avgMs: rows.length ? Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length) : 0,
  };
}
