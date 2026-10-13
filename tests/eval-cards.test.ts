import test from "node:test";
import assert from "node:assert/strict";
import { cardMetrics, parseCardCases, reviewSample, reviewScore, type CardCaseOutcome } from "@/lib/evals/cards";

test("parse del set: default transcript, righe ignorate, errori con il numero di riga", () => {
  const cases = parseCardCases([
    "// commento",
    JSON.stringify({ id: "a-1", course: "A", content: "testo", chunkId: 7 }),
    "",
    JSON.stringify({ id: "b-1", course: "B", content: "altro", docKind: "html" }),
  ].join("\n"));
  assert.deepEqual(cases.map((c) => [c.id, c.docKind, c.chunkId]), [["a-1", "transcript", 7], ["b-1", "html", undefined]]);
  assert.throws(() => parseCardCases('{"id":"x","course":"A"}'), /riga 1: content/);
  assert.throws(() => parseCardCases(`${JSON.stringify({ id: "x", course: "A", content: "t" })}\n${JSON.stringify({ id: "x", course: "A", content: "t" })}`), /riga 2: id duplicato/);
});

const card = (q: string, ...codes: string[]) => ({ question: q, answer: "a", fact: "f", issues: codes.map((code) => ({ code })) }) as CardCaseOutcome["cards"][number];

test("metriche: quota che passa, problemi, casi vuoti ed errori, per corso", () => {
  const m = cardMetrics([
    { id: "1", course: "A", cards: [card("q1"), card("q2", "long"), card("q3", "long", "double")] },
    { id: "2", course: "B", cards: [card("q4")] },
    { id: "3", course: "B", cards: [] },
    { id: "4", course: "B", cards: [], error: "timeout" },
  ]);
  assert.equal(m.cards, 4);
  assert.equal(m.passed, 2);
  assert.equal(m.passRate, 0.5);
  assert.deepEqual(m.byIssue, { long: 2, double: 1 });
  assert.equal(m.emptyCases, 1);
  assert.equal(m.failures, 1);
  assert.deepEqual(m.byCourse, { A: { cards: 3, passRate: 1 / 3 }, B: { cards: 1, passRate: 1 } });
  assert.equal(cardMetrics([]).passRate, 0);
});

test("campione da rivedere: solo carte valide, distribuite, deterministico; punteggio della revisione", () => {
  const outcomes: CardCaseOutcome[] = Array.from({ length: 10 }, (_, i) => ({ id: String(i), course: "A", cards: [card(`v${i}a`), card(`v${i}b`), card(`x${i}`, "yesno")] }));
  const sample = reviewSample(outcomes, 5);
  assert.equal(sample.length, 5);
  assert.ok(sample.every((s) => s.question.startsWith("v") && s.keep === null));
  assert.deepEqual(sample.map((s) => s.caseId), ["0", "2", "4", "6", "8"]);
  assert.deepEqual(reviewSample(outcomes, 5), sample);
  assert.equal(reviewSample(outcomes.slice(0, 1), 5).length, 2);

  const filled = sample.map((s, i) => JSON.stringify({ ...s, keep: i < 3 ? true : i === 3 ? false : null })).join("\n");
  assert.deepEqual(reviewScore(filled), { reviewed: 4, kept: 3, pending: 1 });
});
