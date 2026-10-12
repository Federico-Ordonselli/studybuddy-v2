import { test } from "node:test";
import assert from "node:assert/strict";
import { gradingMetrics, parseGradingCases, verdictFromGrade, type GradingOutcome } from "@/lib/evals/grading";

test("grade-v1 → verdetto: 4–5 correct, 3 partial, 0–2 wrong", () => {
  const v = (quality: number) => verdictFromGrade({ quality, correct: quality >= 3, feedback: "" });
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(v), ["wrong", "wrong", "wrong", "partial", "correct", "correct"]);
});

test("parseGradingCases: righe valide, commenti e righe vuote saltati, errori con il numero di riga", () => {
  const ok = parseGradingCases([
    '{"id":"a","question":"D?","expected":"R","answer":"r","verdict":"correct","tags":["synonym"],"confirmed":true}',
    "",
    "// commento",
    '{"id":"b","question":"D?","expected":"R","answer":"","verdict":"wrong"}',
  ].join("\n"));
  assert.equal(ok.length, 2);
  assert.deepEqual(ok[1].tags, []);
  assert.equal(ok[1].confirmed, false);
  assert.throws(() => parseGradingCases('{"id":"c","question":"D","expected":"R","answer":"x","verdict":"forse"}'), /riga 1.*verdict/);
  assert.throws(() => parseGradingCases('{"id":"a","question":"D","expected":"R","answer":"","verdict":"wrong"}\n{"id":"a","question":"D","expected":"R","answer":"","verdict":"wrong"}'), /riga 2.*duplicato/);
});

test("metriche: accordo esatto, entro 1, matrice, lunghe-sbagliate promosse ed errori del modello", () => {
  const o = (human: GradingOutcome["human"], model: GradingOutcome["model"], tags: string[] = []): GradingOutcome => ({ id: human + model, human, model, tags });
  const m = gradingMetrics([
    o("correct", "correct"), o("partial", "correct"), o("wrong", "correct", ["long-wrong"]),
    o("wrong", "wrong"), o("partial", null),
  ]);
  assert.equal(m.total, 5);
  assert.equal(m.judged, 4);
  assert.equal(m.failures, 1);
  assert.equal(m.exact, 2 / 4);
  assert.equal(m.withinOne, 3 / 4);
  assert.equal(m.confusion.wrong.correct, 1);
  assert.equal(m.confusion.partial.correct, 1);
  assert.equal(m.longWrongAsCorrect, 1);
  assert.deepEqual(m.byTag, { "long-wrong": { n: 1, exact: 0 } });
  assert.deepEqual(gradingMetrics([]).exact, 0);
});
