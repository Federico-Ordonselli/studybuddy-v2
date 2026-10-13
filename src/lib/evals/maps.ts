/**
 * Set di valutazione delle mappe-esercizio (Fase 5): proposizioni scritte su mappe generate dai
 * corsi, con il verdetto di riferimento deciso sui passaggi. Misura quanto il valutatore
 * (`judgePropositions`, prompt maps-vN) coincide: obiettivo ≥ 80% di accordo esatto.
 * Logica pura: `scripts/eval.ts` chiama il modello.
 */
import { titleKey } from "@/lib/mappe/proposte.js";
import type { Verdict } from "@/lib/mapExercise";

export const KINDS = ["same", "absent-valid", "vague", "inverted", "wrong"] as const;
const VERDICTS = ["valid", "imprecise", "wrong"] as const;

export interface MapCaseProposition { id: string; from: string; label: string; to: string; gold: Verdict; kind: (typeof KINDS)[number] }
export interface MapCase {
  id: string; course: string; topic: string; focusQuestion: string;
  concepts: { title: string; definition: string }[];
  solution: { from: string; label: string; to: string }[];
  passages: { n: number; chunkId: number; text: string }[];
  propositions: MapCaseProposition[];
}
export interface MapOutcome { caseId: string; propId: string; kind: string; gold: Verdict; got: Verdict | "unrated" | "error" }

export function parseMapCases(text: string, { requirePropositions = true } = {}): MapCase[] {
  const seen = new Set<string>();
  const out: MapCase[] = [];
  text.split("\n").forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("//")) return;
    const fail = (why: string): never => { throw new Error(`maps.jsonl riga ${i + 1}: ${why}`); };
    let c: Record<string, unknown>;
    try { c = JSON.parse(raw); } catch { return fail("JSON non valido"); }
    for (const k of ["id", "course", "topic", "focusQuestion"]) if (typeof c[k] !== "string" || !(c[k] as string).trim()) fail(`${k} deve essere una stringa non vuota`);
    if (!Array.isArray(c.concepts) || !Array.isArray(c.solution) || !Array.isArray(c.passages)) fail("concepts, solution e passages devono essere elenchi");
    const props = (c.propositions ?? []) as Record<string, unknown>[];
    if (!Array.isArray(props) || (requirePropositions && !props.length)) fail("propositions deve essere un elenco non vuoto");
    const ids = new Set<string>();
    for (const p of props) {
      for (const k of ["id", "from", "label", "to"]) if (typeof p[k] !== "string" || !(p[k] as string).trim()) fail(`proposizione: ${k} mancante`);
      if (!(VERDICTS as readonly unknown[]).includes(p.gold)) fail(`proposizione ${p.id}: gold deve essere valid, imprecise o wrong`);
      if (!(KINDS as readonly unknown[]).includes(p.kind)) fail(`proposizione ${p.id}: kind sconosciuto`);
      if (ids.has(p.id as string)) fail(`proposizione ${p.id} duplicata`);
      ids.add(p.id as string);
    }
    if (seen.has(c.id as string)) fail(`id duplicato ${c.id}`);
    seen.add(c.id as string);
    out.push(c as unknown as MapCase);
  });
  return out;
}

/** La relazione della soluzione per la stessa coppia (direzione ignorata), se c'è. */
function solutionFor(c: MapCase, p: MapCaseProposition) {
  const key = (a: string, b: string) => [titleKey(a), titleKey(b)].sort().join("|");
  return c.solution.find((s) => key(s.from, s.to) === key(p.from, p.to));
}

/** La formulazione di riferimento della soluzione per la stessa coppia (direzione ignorata), se c'è. */
export function referenceFor(c: MapCase, p: MapCaseProposition): string | undefined {
  const r = solutionFor(c, p);
  return r ? `${r.from} ${r.label} ${r.to}` : undefined;
}

/** Il solo verbo del riferimento (per `referenceLabel` di `judgePropositions`), se c'è. */
export function referenceLabelFor(c: MapCase, p: MapCaseProposition): string | undefined {
  return solutionFor(c, p)?.label;
}

export function mapMetrics(rows: MapOutcome[]) {
  const confusion: Record<string, Record<string, number>> = {};
  const byKind: Record<string, { n: number; agree: number }> = {};
  let agree = 0, absentValid = 0, absentValidRejected = 0;
  for (const r of rows) {
    const ok = r.got === r.gold;
    if (ok) agree++;
    (confusion[r.gold] ??= {})[r.got] = (confusion[r.gold][r.got] ?? 0) + 1;
    const k = (byKind[r.kind] ??= { n: 0, agree: 0 });
    k.n++; if (ok) k.agree++;
    if (r.kind === "absent-valid") { absentValid++; if (r.got === "wrong") absentValidRejected++; }
  }
  return { total: rows.length, agreement: rows.length ? agree / rows.length : 0, confusion, byKind, absentValidRejected, absentValid };
}
