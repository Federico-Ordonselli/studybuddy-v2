import { test } from "node:test";
import assert from "node:assert/strict";
import { mapMetrics, parseMapCases, referenceFor, referenceLabelFor } from "@/lib/evals/maps";

const CASE = {
  id: "m1", course: "C", topic: "React", focusQuestion: "D?",
  concepts: [{ title: "State", definition: "d" }, { title: "Rendering", definition: "d" }],
  solution: [{ from: "State", label: "provoca", to: "Rendering" }],
  passages: [{ n: 1, chunkId: 10, text: "Lo state provoca il rendering." }],
  propositions: [
    { id: "p1", from: "Rendering", label: "dipende da", to: "state", gold: "valid", kind: "same" },
    { id: "p2", from: "State", label: "riguarda", to: "Rendering", gold: "imprecise", kind: "vague" },
  ],
};

test("parseMapCases: valida i campi e rifiuta kind/gold sconosciuti e id duplicati", () => {
  assert.equal(parseMapCases(JSON.stringify(CASE)).length, 1);
  assert.throws(() => parseMapCases(JSON.stringify({ ...CASE, propositions: [{ ...CASE.propositions[0], gold: "forse" }] })), /gold/);
  assert.throws(() => parseMapCases(JSON.stringify({ ...CASE, propositions: [{ ...CASE.propositions[0], kind: "boh" }] })), /kind/);
  assert.throws(() => parseMapCases([JSON.stringify(CASE), JSON.stringify(CASE)].join("\n")), /duplicato/);
  assert.equal(parseMapCases(JSON.stringify({ ...CASE, propositions: [] }), { requirePropositions: false }).length, 1);
  assert.throws(() => parseMapCases(JSON.stringify({ ...CASE, propositions: [] })), /propositions/);
});

test("referenceFor: coppia non ordinata, titoli normalizzati", () => {
  const c = parseMapCases(JSON.stringify(CASE))[0];
  assert.equal(referenceFor(c, c.propositions[0]), "State provoca Rendering");
  assert.equal(referenceLabelFor(c, c.propositions[0]), "provoca");
});

test("mapMetrics: accordo, confusione, per kind e absent-valid bocciate", () => {
  const m = mapMetrics([
    { caseId: "m1", propId: "p1", kind: "same", gold: "valid", got: "valid" },
    { caseId: "m1", propId: "p2", kind: "vague", gold: "imprecise", got: "valid" },
    { caseId: "m1", propId: "p3", kind: "absent-valid", gold: "valid", got: "wrong" },
    { caseId: "m1", propId: "p4", kind: "absent-valid", gold: "valid", got: "valid" },
  ]);
  assert.equal(m.total, 4);
  assert.equal(m.agreement, 0.5);
  assert.equal(m.confusion.imprecise.valid, 1);
  assert.deepEqual(m.byKind["absent-valid"], { n: 2, agree: 1 });
  assert.equal(m.absentValidRejected, 1);
  assert.equal(m.absentValid, 2);
});
