import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMapDocument } from "@/lib/mappe/formato-mappa.js";
import { applyMapCommands } from "@/lib/mappe/comandi.js";
import { createRelation } from "@/lib/mappe/modello.js";
import {
  comparePairs, completionCommands, exerciseDocument, levelConcepts, levelKeyOf, levelPropositions,
  overlayDocument, pairKey, resolveSolution, stripProposal, type ExerciseDoc, type Solution,
} from "@/lib/mapExerciseCore";

const ref = (chunkId: string) => ({ documentId: "1", documentRevision: "h", chunkId });
const SOLUTION: Solution = {
  concepts: [
    { title: "Rendering", definition: "Disegno dell'interfaccia.", explanation: "React disegna.", examples: ["<App/>"], sourceRefs: [ref("10")] },
    { title: "State", definition: "Dati che cambiano.", explanation: "Lo state vive nel componente.", examples: ["useState"], sourceRefs: [ref("11")] },
    { title: "Props", definition: "Dati dal genitore.", explanation: "Le props scendono.", examples: [], sourceRefs: [ref("12")] },
    { title: "Virtual DOM", definition: "Copia in memoria.", explanation: "Confronto prima di aggiornare.", examples: [], sourceRefs: [] },
  ],
  relations: [
    { from: "State", to: "Rendering", label: "provoca" },
    { from: "Rendering", to: "Props", label: "riceve" },
    { from: "Rendering", to: "Virtual DOM", label: "usa" },
  ],
};

const idOf = (doc: ExerciseDoc, title: string) => doc.concepts.find((c) => c.title === title)!.id;
const withRelations = (doc: ExerciseDoc, rels: [string, string, string][]) =>
  applyMapCommands(doc, rels.map(([a, label, b]) => ({ type: "addRelation", relation: createRelation(idOf(doc, a), idOf(doc, b), label) }))) as ExerciseDoc;

test("stripProposal: solo definizione e fonti, niente spiegazioni, esempi né relazioni", () => {
  const s = stripProposal(SOLUTION);
  assert.equal(s.relations.length, 0);
  assert.deepEqual(s.concepts.map((c) => [c.title, c.definition, c.explanation, c.examples]), SOLUTION.concepts.map((c) => [c.title, c.definition, "", []]));
  assert.deepEqual(s.concepts[1].sourceRefs, [ref("11")]);
});

test("exerciseDocument: documento valido, nessun arco, bolle uguali in griglia senza sovrapposizioni, deterministico", () => {
  const doc = exerciseDocument("React", SOLUTION, { seed: "s1" });
  assertMapDocument(doc);
  assert.equal(doc.relations.length, 0);
  assert.equal(doc.concepts.length, 4);
  assert.ok(doc.concepts.every((c) => c.explanation === "" && c.examples.length === 0 && c.definition));
  const ps = doc.placements.filter((p) => p.spaceId === doc.rootSpaceId);
  assert.equal(ps.length, 4);
  assert.ok(ps.every((p) => p.width === 220 && p.height === 110));
  for (const a of ps) for (const b of ps) if (a !== b) assert.ok(Math.abs(a.x - b.x) >= 220 || Math.abs(a.y - b.y) >= 110, "sovrapposte");
  const again = exerciseDocument("React", SOLUTION, { seed: "s1" });
  const order = (d: ExerciseDoc) => d.placements.map((p) => [d.concepts.find((c) => c.id === p.conceptId)!.title, p.x, p.y]);
  assert.deepEqual(order(again), order(doc));
});

test("levelKeyOf: root per la tela iniziale, concetto proprietario per le altre", () => {
  const doc = exerciseDocument("React", SOLUTION, { seed: "s1" });
  assert.equal(levelKeyOf(doc, doc.rootSpaceId), "root");
  assert.throws(() => levelKeyOf(doc, "nessuna"), /Tela inesistente/);
});

test("levelPropositions e levelConcepts: solo ciò che sta nella tela", () => {
  const doc = withRelations(exerciseDocument("React", SOLUTION, { seed: "s1" }), [["State", "causa", "Rendering"]]);
  assert.equal(levelConcepts(doc, doc.rootSpaceId).length, 4);
  assert.deepEqual(levelPropositions(doc, doc.rootSpaceId).map((r) => r.label), ["causa"]);
});

test("comparePairs: direzione ignorata, comuni, solo tue, mancanti senza etichetta per la UI", () => {
  const doc = withRelations(exerciseDocument("React", SOLUTION, { seed: "s1" }), [
    ["Rendering", "dipende da", "State"],   // coppia della soluzione, direzione opposta
    ["State", "contiene", "Props"],          // solo dello studente
  ]);
  const r = comparePairs(doc, doc.rootSpaceId, SOLUTION);
  assert.deepEqual(r.common, [pairKey(idOf(doc, "State"), idOf(doc, "Rendering"))]);
  assert.deepEqual(r.extra, [pairKey(idOf(doc, "State"), idOf(doc, "Props"))]);
  assert.deepEqual(r.missing.map((m) => [m.sourceId, m.targetId].sort()).sort(), [
    [idOf(doc, "Rendering"), idOf(doc, "Props")].sort(), [idOf(doc, "Rendering"), idOf(doc, "Virtual DOM")].sort(),
  ].sort());
});

test("resolveSolution/comparePairs: un titolo rinominato non si risolve e viene ignorato", () => {
  const base = exerciseDocument("React", SOLUTION, { seed: "s1" });
  const renamed = applyMapCommands(base, [{ type: "updateConcept", id: idOf(base, "Props"), changes: { title: "Proprietà" } }]) as ExerciseDoc;
  assert.equal(resolveSolution(renamed, renamed.rootSpaceId, SOLUTION).length, 2);
  assert.equal(comparePairs(renamed, renamed.rootSpaceId, SOLUTION).missing.length, 2);
});

test("titoli confrontati con titleKey: maiuscole e accenti non contano", () => {
  const doc = exerciseDocument("React", SOLUTION, { seed: "s1" });
  const sol: Solution = { concepts: [], relations: [{ from: "state", to: "RENDERING", label: "provoca" }] };
  assert.equal(resolveSolution(doc, doc.rootSpaceId, sol).length, 1);
});

test("overlayDocument: aggiunge solo le coppie mancanti, non direzionali, documento valido", () => {
  const doc = withRelations(exerciseDocument("React", SOLUTION, { seed: "s1" }), [["State", "causa", "Rendering"]]);
  const view = overlayDocument(doc, doc.rootSpaceId, SOLUTION);
  assertMapDocument(view);
  const added = view.relations.filter((r) => !doc.relations.some((d) => d.id === r.id));
  assert.equal(added.length, 2);
  assert.ok(added.every((r) => r.directed === false));
  assert.equal(doc.relations.length, 1, "l'originale non cambia");
});

test("completionCommands: archi mancanti direzionali + spiegazioni ed esempi solo dove vuoti", () => {
  const doc = withRelations(exerciseDocument("React", SOLUTION, { seed: "s1" }), [["State", "causa", "Rendering"]]);
  const edited = applyMapCommands(doc, [{ type: "updateConcept", id: idOf(doc, "Props"), changes: { explanation: "Mia nota." } }]) as ExerciseDoc;
  const done = applyMapCommands(edited, completionCommands(edited, edited.rootSpaceId, SOLUTION)) as ExerciseDoc;
  assert.equal(done.relations.length, 3);
  assert.ok(done.relations.every((r) => r.directed));
  const c = (t: string) => done.concepts.find((x) => x.title === t)!;
  assert.equal(c("State").explanation, "Lo state vive nel componente.");
  assert.deepEqual(c("State").examples, ["useState"]);
  assert.equal(c("Props").explanation, "Mia nota.");
});
