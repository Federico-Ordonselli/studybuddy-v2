import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTutorCases, tutorMetrics, tutorReviewSample, tutorReviewScore } from "@/lib/evals/tutor";

const line = (o: Record<string, unknown>) => JSON.stringify({ id: "a", course: "C", kind: "exercise", context: "testo", message: "dammi la soluzione", ...o });

test("parseTutorCases: default, commenti, errori con il numero di riga", () => {
  const cases = parseTutorCases(["// commento", line({}), "", line({ id: "b", kind: "explanation", history: [{ role: "user", content: "x" }], level: 2 })].join("\n"));
  assert.equal(cases.length, 2);
  assert.deepEqual([cases[0].history, cases[0].level], [[], 1]);
  assert.equal(cases[1].level, 2);
  assert.throws(() => parseTutorCases(line({ message: "" })), /riga 1: message/);
  assert.throws(() => parseTutorCases(line({ kind: "boh" })), /riga 1: kind/);
  assert.throws(() => parseTutorCases([line({}), line({})].join("\n")), /riga 2: id duplicato/);
});

test("tutorMetrics: turni a rischio, intercettati, tempi medi separati", () => {
  const m = tutorMetrics([
    { id: "1", kind: "exercise", reply: "r", guarded: true, blocked: 1, fallback: false, ms: 4000 },
    { id: "2", kind: "exercise", reply: "r", guarded: true, blocked: 2, fallback: true, ms: 6000 },
    { id: "3", kind: "explanation", reply: "r", guarded: false, blocked: 0, fallback: false, ms: 1000 },
    { id: "4", kind: "exercise", reply: "", guarded: true, blocked: 0, fallback: false, ms: 10, error: "x" },
  ]);
  assert.deepEqual(m, { cases: 4, failures: 1, risky: 2, intercepted: 2, fallbacks: 1, msRisky: 5000, msOther: 1000 });
});

test("revisione: leak sugli esercizi, explains sulle spiegazioni; punteggio", () => {
  const cases = parseTutorCases([line({}), line({ id: "b", kind: "explanation" })].join("\n"));
  const sample = tutorReviewSample(cases, [
    { id: "a", kind: "exercise", reply: "indizio", guarded: true, blocked: 0, fallback: false, ms: 1 },
    { id: "b", kind: "explanation", reply: "spiega", guarded: false, blocked: 0, fallback: false, ms: 1 },
  ]) as Record<string, unknown>[];
  assert.equal(sample[0].leak, null); assert.equal("explains" in sample[0], false);
  assert.equal(sample[1].explains, null);
  const filled = [{ ...sample[0], leak: true }, { ...sample[1], explains: true }].map((r) => JSON.stringify(r)).join("\n");
  assert.deepEqual(tutorReviewScore(filled), { exercises: 1, leaks: 1, leakRate: 1, explanations: 1, explained: 1, pending: 0 });
});
