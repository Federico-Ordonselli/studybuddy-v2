import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { exactTokens, parseProofreadCases, proofreadMetrics, scoreCase, wordDistance } from "@/lib/evals/proofread";

test("exactTokens distingue accenti e apostrofi, non le maiuscole", () => {
  assert.deepEqual(exactTokens("E' l'unità, puo' Qual è"), ["e'", "l", "unità", "puo'", "qual", "è"]);
  assert.equal(wordDistance(exactTokens("e' un isstema"), exactTokens("È un sistema")), 2);
});

test("scoreCase: distanza recuperata, codice e frasi da non toccare", () => {
  const c = { id: "x", tags: [], input: "Il bit e' 0 o 2, vedi `arr.lenght`.", expected: "Il bit è 0 o 2, vedi `arr.lenght`.", keep: ["0 o 2"] };
  const good = scoreCase(c, c.expected, 0, 5);
  assert.deepEqual([good.baseline, good.residual, good.brokenProtected, good.brokenKeep], [1, 0, 0, 0]);
  const bad = scoreCase(c, "Il bit è 0 o 1, vedi `arr.length`.", 0, 5);
  assert.equal(bad.brokenProtected, 1);
  assert.equal(bad.brokenKeep, 1);
  const cut = { ...c, input: "la ROM e' non volat", expected: "la ROM è non volat", keep: ["non volat"] };
  assert.equal(scoreCase(cut, "La ROM è non volatile.", 0, 0).brokenKeep, 1, "parola completata");
  assert.equal(scoreCase(cut, "La ROM è non volat", 0, 0).brokenKeep, 0);
  const m = proofreadMetrics([good, bad]);
  assert.equal(m.exact, 1);
  assert.equal(m.worse, 1);
});

test("il set committato è valido e il riferimento non tocca codice né frasi da tenere", () => {
  const cases = parseProofreadCases(fs.readFileSync("evals/fixtures/proofread.json", "utf8"));
  assert.ok(cases.length >= 10);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  for (const c of cases) {
    const ref = scoreCase(c, c.expected, 0, 0);
    assert.equal(ref.residual, 0, c.id);
    assert.ok(ref.baseline > 0, `${c.id}: nessun refuso da correggere`);
    assert.equal(ref.brokenProtected, 0, `${c.id}: il riferimento altera codice o link`);
    assert.equal(ref.brokenKeep, 0, c.id);
    assert.equal(ref.deleted, 0, `${c.id}: il riferimento toglie parole vere`);
  }
});
