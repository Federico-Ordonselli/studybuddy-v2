import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import { withJudge } from "./helpers/judge";

const { sqlite } = await useTempDb();
const ex = await import("@/lib/mapExercise");
const { getMap } = await import("@/lib/mappe/store");

sqlite.prepare("INSERT INTO domains (id, name) VALUES (1, 'Corso')").run();
const chunk = (id: number, content: string) => ({ chunkId: id, documentId: 1, content, distance: 0, source: null, docKind: "text", docMeta: { fileHash: "h" } });
const FOUND = [chunk(10, "Lo state provoca il rendering."), chunk(11, "Le props arrivano dal genitore.")];
const MAP_REPLY = JSON.stringify({
  center: { title: "React", definition: "Libreria UI.", explanation: "Spiega React.", sources: [1] },
  concepts: [
    { title: "State", definition: "Dati locali.", explanation: "Lo state cambia.", examples: ["useState"], sources: [1], verb: "gestisce" },
    { title: "Props", definition: "Dati dal genitore.", explanation: "Le props scendono.", sources: [2], verb: "riceve" },
  ],
  relations: [{ from: "State", to: "Props", label: "differisce da" }],
  focus_question: "Come passano i dati in React?",
});

test("createExercise: mappa senza archi né spiegazioni, riga root con la soluzione completa", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React", FOUND));
  assert.equal(map.relations.length, 0);
  assert.ok((map.concepts as { explanation: string }[]).every((c) => c.explanation === ""));
  assert.ok(getMap(map.id));
  const levels = ex.exerciseLevels(map.id);
  assert.deepEqual(levels.map((l) => [l.levelKey, l.focusQuestion, l.lastCheck]), [["root", "Come passano i dati in React?", null]]);
  assert.ok(!("proposal" in levels[0]), "la soluzione non esce da exerciseLevels");
  const row = sqlite.prepare("SELECT proposal FROM map_exercises WHERE map_id = ?").get(map.id) as { proposal: string };
  const solution = JSON.parse(row.proposal);
  assert.ok(solution.relations.length >= 3);
  assert.deepEqual(solution.chunkIds, [10, 11], "chunk della generazione, in ordine");
  assert.equal(solution.concepts.find((c: { title: string }) => c.title === "State").explanation, "Lo state cambia.");
});

test("revealLevel e completeLevel: restituiscono la soluzione e segnano le date", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React2", FOUND));
  const { relations } = ex.revealLevel(map.id, map.rootSpaceId);
  assert.ok(relations.some((r) => r.from === "State" && r.to === "Props"));
  assert.ok(ex.exerciseLevels(map.id)[0].revealedAt);
  const full = ex.completeLevel(map.id, map.rootSpaceId);
  assert.ok(full.concepts.some((c) => c.explanation === "Lo state cambia."));
  assert.ok(ex.exerciseLevels(map.id)[0].completedAt);
});

test("livello senza esercizio, tela o mappa inesistenti: ExerciseError 404", async () => {
  assert.throws(() => ex.revealLevel("nessuna", "x"), (e: unknown) => e instanceof ex.ExerciseError && e.status === 404);
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React3", FOUND));
  assert.throws(() => ex.revealLevel(map.id, "tela-che-non-c-e"), (e: unknown) => e instanceof ex.ExerciseError && e.status === 404);
});

const EXPAND_REPLY = JSON.stringify({
  center: { title: "State", definition: "Dati locali.", explanation: "", sources: [1] },
  concepts: [
    { title: "useState", definition: "Hook dello state.", explanation: "Restituisce valore e setter.", sources: [1], verb: "usa" },
    { title: "Rendering", definition: "Aggiornamento UI.", explanation: "Si riesegue al cambio.", sources: [1], verb: "provoca" },
  ],
  relations: [{ from: "useState", to: "Rendering", label: "provoca" }],
  focus_question: "Come cambia lo state?",
});
const EXPAND_REPLY_2 = JSON.stringify({
  center: { title: "State", definition: "Dati locali.", explanation: "", sources: [1] },
  concepts: [
    { title: "useState", definition: "Hook dello state.", explanation: "Altro.", sources: [1], verb: "usa" },
    { title: "Immutabilità", definition: "Non si muta.", explanation: "Si copia.", sources: [2], verb: "richiede" },
  ],
  relations: [
    { from: "useState", to: "Rendering", label: "provoca" },
    { from: "useState", to: "Immutabilità", label: "richiede" },
  ],
});
const req = { concept: { title: "State", definition: "Dati locali." }, path: ["React"], existing: ["React", "State", "Props"], present: [] };

test("expandExercise: proposta spogliata, riga del livello con la soluzione, seconda chiamata fonde", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React4", FOUND));
  const stateId = (map.concepts as { id: string; title: string }[]).find((c) => c.title === "State")!.id;
  const p = await withJudge([EXPAND_REPLY], () => ex.expandExercise(map.id, 1, stateId, req, FOUND));
  assert.deepEqual(p.relations, []);
  assert.ok(p.concepts.length >= 2 && p.concepts.every((c) => c.explanation === ""));
  const row = () => JSON.parse((sqlite.prepare("SELECT proposal FROM map_exercises WHERE map_id = ? AND level_key = ?").get(map.id, stateId) as { proposal: string }).proposal);
  const first = row();
  assert.ok(first.concepts.some((c: { title: string; explanation: string }) => c.title === "useState" && c.explanation));
  assert.ok(first.relations.length >= 1);
  await withJudge([EXPAND_REPLY_2], () => ex.expandExercise(map.id, 1, stateId, req, FOUND));
  const merged = row();
  const titles = merged.concepts.map((c: { title: string }) => c.title);
  assert.equal(new Set(titles).size, titles.length, "concetti senza duplicati");
  assert.ok(titles.includes("Immutabilità"));
  const keys = merged.relations.map((r: { from: string; to: string; label: string }) => `${r.from}|${r.to}|${r.label}`);
  assert.equal(new Set(keys).size, keys.length, "relazioni senza duplicati");
  assert.ok(merged.relations.length > first.relations.length);
  assert.deepEqual(first.chunkIds, [10, 11]);
  assert.deepEqual(merged.chunkIds, [10, 11], "chunk fusi senza duplicati");
  assert.ok(ex.exerciseLevels(map.id).some((l) => l.levelKey === stateId));
});

test("expandExercise: mappa non-esercizio 409, concetto inesistente 404", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React5", FOUND));
  const id = (map.concepts as { id: string }[])[0].id;
  await assert.rejects(ex.expandExercise(map.id, 1, "nessuno", req, FOUND), (e: unknown) => e instanceof ex.ExerciseError && e.status === 404);
  sqlite.prepare("DELETE FROM map_exercises WHERE map_id = ?").run(map.id);
  await assert.rejects(ex.expandExercise(map.id, 1, id, req, FOUND), (e: unknown) => e instanceof ex.ExerciseError && e.status === 409 && /non è un esercizio/.test(e.message));
});

const { applyMapCommands } = await import("@/lib/mappe/comandi.js");
const { createConcept, createPlacement, createRelation } = await import("@/lib/mappe/modello.js");
const { saveMap } = await import("@/lib/mappe/store");

const judged = (items: unknown[]) => JSON.stringify({ items });

test("parseJudgements: id sconosciuti scartati, verdetti fuori enum rifiutati, fix svuotato sui valid", () => {
  const ids = ["P1", "P2"];
  assert.deepEqual(ex.parseJudgements(judged([
    { id: "P1", reason: "ok", verdict: "valid", fix: "inutile" },
    { id: "P9", reason: "x", verdict: "wrong", fix: "y" },
  ]), ids), [{ id: "P1", reason: "ok", verdict: "valid", fix: "" }]);
  assert.equal(ex.parseJudgements("non json", ids), null);
  assert.equal(ex.parseJudgements(JSON.stringify({ nope: [] }), ids), null);
  assert.deepEqual(ex.parseJudgements(judged([{ id: "P2", reason: "r", verdict: "forse", fix: "" }]), ids), []);
});

test("judgePropositions: oltre 15 lancia; un retry poi errore", async () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ id: `P${i + 1}`, from: "A", label: "x", to: "B" }));
  await assert.rejects(ex.judgePropositions({ focusQuestion: "D?", propositions: many, passages: [] }), /15/);
  const one = [{ id: "P1", from: "State", label: "provoca", to: "Rendering", reference: "State provoca Rendering" }];
  const bodies: Record<string, unknown>[] = [];
  const r = await withJudge(["rotto", judged([{ id: "P1", reason: "Il materiale lo dice.", verdict: "valid", fix: "" }])],
    () => ex.judgePropositions({ focusQuestion: "D?", propositions: one, passages: ["Lo state provoca il rendering."] }), bodies);
  assert.equal(r[0].verdict, "valid");
  assert.equal(bodies.length, 2);
  const prompt = JSON.stringify(bodies[0]);
  assert.match(prompt, /una possibile, non l'unica/);
  assert.match(prompt, /\[1\] Lo state provoca il rendering\./);
  await assert.rejects(withJudge(["rotto"], () => ex.judgePropositions({ focusQuestion: "D?", propositions: one, passages: [] })), /valutazione valida/);
});

test("levelPassages: chunk dei concetti del livello, deduplicati, tagliati a 1500 l'uno, con il tetto totale", () => {
  sqlite.prepare("INSERT INTO documents (id, domain_id, title, kind) VALUES (1, 1, 'Doc', 'text')").run();
  sqlite.prepare("INSERT INTO chunks (id, document_id, ordinal, content) VALUES (10, 1, 0, ?)").run("a".repeat(2000));
  sqlite.prepare("INSERT INTO chunks (id, document_id, ordinal, content) VALUES (11, 1, 1, 'Le props arrivano dal genitore.')").run();
  const ref = (chunkId: string) => ({ documentId: "1", documentRevision: "h", chunkId });
  const sol = { concepts: [
    { title: "State", sourceRefs: [ref("10"), ref("11")] },
    { title: "Props", sourceRefs: [ref("11")] },
    { title: "Altro", sourceRefs: [ref("99")] },
  ], relations: [] };
  const ps = ex.levelPassages(sol, ["State", "props"]);
  assert.deepEqual(ps.map((p) => p.length), [1500, "Le props arrivano dal genitore.".length]);
});

test("levelPassages: con chunkIds usa i chunk della generazione, in ordine, non i sourceRefs", () => {
  const ref = (chunkId: string) => ({ documentId: "1", documentRevision: "h", chunkId });
  const sol = { concepts: [{ title: "State", sourceRefs: [ref("10")] }], relations: [], chunkIds: [11, 10, 11, 99] };
  const ps = ex.levelPassages(sol, ["State"]);
  assert.deepEqual(ps.map((p) => p.length), ["Le props arrivano dal genitore.".length, 1500]);
});

test("capPassages: ogni passaggio ≤ 1500, ≤ 21000 in tutto (i 14 chunk della generazione), un passaggio troppo lungo si salta ma i corti dopo entrano", () => {
  assert.deepEqual(ex.capPassages(["x".repeat(2000)]).map((p) => p.length), [1500]);
  assert.equal(ex.capPassages(Array(14).fill("a".repeat(1500))).length, 14);
  const ps = ex.capPassages([...Array(13).fill("a".repeat(1500)), "b".repeat(1200), "c".repeat(900)]);
  // 13 × 1500 = 19500; 1200 sforerebbe (20700 ok) → entra; poi 900 sforerebbe (21600) e si salta.
  assert.deepEqual(ps.map((p) => p.length), [...Array(13).fill(1500), 1200]);
  const qs = ex.capPassages([...Array(13).fill("a".repeat(1500)), "b".repeat(1600), "c".repeat(900)]);
  // il 14° (tagliato a 1500) porterebbe a 21000: entra; il 15° no.
  assert.equal(qs.join("").length, 21000);
  assert.ok(ps.join("").length <= 21000);
});

test("evaluateLevel: legge il documento salvato, voci mancanti unrated, coppie mancanti per nome, last_check salvato", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React", FOUND));
  const id = (t: string) => (map.concepts as { id: string; title: string }[]).find((c) => c.title === t)!.id;
  const withRels = applyMapCommands(map, [
    { type: "addRelation", relation: createRelation(id("State"), id("React"), "è gestito da") },
    { type: "addRelation", relation: createRelation(id("Props"), id("State"), "diventano") },
  ]);
  saveMap(1, withRels, map.revision);
  const r = await withJudge([judged([{ id: "P1", reason: "Giusta.", verdict: "valid", fix: "" }])], () => ex.evaluateLevel(map.id, map.rootSpaceId));
  assert.deepEqual(r.verdicts.map((v) => [v.label, v.verdict, v.inSolution]), [["è gestito da", "valid", true], ["diventano", "unrated", true]]);
  assert.deepEqual(r.missing.map((m) => [m.a, m.b].sort()), [["Props", "React"]]);
  assert.equal(ex.exerciseLevels(map.id)[0].lastCheck?.verdicts.length, 2);
});

test("evaluateLevel: senza proposizioni → ExerciseError 400", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React-vuota", FOUND));
  await assert.rejects(ex.evaluateLevel(map.id, map.rootSpaceId), (e: unknown) => e instanceof ex.ExerciseError && e.status === 400);
});

test("relationCardDraft: risposta dalla soluzione per la coppia, chunk dei due concetti", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React", FOUND));
  const id = (t: string) => (map.concepts as { id: string; title: string }[]).find((c) => c.title === t)!.id;
  const inSol = createRelation(id("State"), id("Props"), "è uguale a");
  const reversed = createRelation(id("Props"), id("React"), "ignora");
  const saved = saveMap(1, applyMapCommands(map, [{ type: "addRelation", relation: inSol }, { type: "addRelation", relation: reversed }]), map.revision);
  await withJudge([judged([
    { id: "P1", reason: "No.", verdict: "wrong", fix: "Lo state differisce dalle props." },
    { id: "P2", reason: "No.", verdict: "wrong", fix: "React riceve le props." },
  ])], () => ex.evaluateLevel(saved.id, saved.rootSpaceId));
  const a = ex.relationCardDraft(saved.id, saved.rootSpaceId, inSol.id);
  assert.equal(a.question, "Che relazione c'è tra «State» e «Props»?");
  assert.equal(a.answer, "State differisce da Props");
  assert.equal(a.sourceChunkId, 10);
  assert.deepEqual(a.issues, []);
  const b = ex.relationCardDraft(saved.id, saved.rootSpaceId, reversed.id);
  assert.equal(b.answer, "React riceve Props");
});

test("relationCardDraft: coppia fuori soluzione → ExerciseError 409, niente carta dal fix", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React-fix", FOUND));
  const id = (t: string) => (map.concepts as { id: string; title: string }[]).find((c) => c.title === t)!.id;
  const extra = createConcept("Redux");
  const rel = createRelation(id("State"), extra.id, "sostituisce");
  const saved = saveMap(1, applyMapCommands(map, [
    { type: "addConcept", concept: extra, placement: createPlacement(map.rootSpaceId, extra.id) },
    { type: "addRelation", relation: rel },
  ]), map.revision);
  await withJudge([judged([{ id: "P1", reason: "No.", verdict: "wrong", fix: "Redux gestisce lo state globale." }])], () => ex.evaluateLevel(saved.id, saved.rootSpaceId));
  assert.throws(() => ex.relationCardDraft(saved.id, saved.rootSpaceId, rel.id),
    (e: unknown) => e instanceof ex.ExerciseError && e.status === 409 && /non è nella soluzione/.test(e.message));
});

test("judgePropositions: verbo generico → imprecise (coppia in soluzione) o valid declassato (fuori soluzione)", async () => {
  const props = [
    { id: "P1", from: "State", label: "è collegato a", to: "Rendering", reference: "State provoca Rendering" },
    { id: "P2", from: "State", label: "riguarda", to: "Props" },
    { id: "P3", from: "Props", label: "Ha a che fare con", to: "Rendering" },
    { id: "P4", from: "State", label: "provoca", to: "Rendering", reference: "State provoca Rendering" },
  ];
  const r = await withJudge([judged([
    { id: "P1", reason: "r", verdict: "wrong", fix: "" },
    { id: "P2", reason: "r", verdict: "valid", fix: "" },
    { id: "P3", reason: "r", verdict: "wrong", fix: "Non sono legati." },
    { id: "P4", reason: "r", verdict: "valid", fix: "" },
  ])], () => ex.judgePropositions({ focusQuestion: "D?", propositions: props, passages: [] }));
  assert.deepEqual(r.map((j) => j.verdict), ["imprecise", "imprecise", "wrong", "valid"]);
  assert.equal(r[0].fix, "State provoca Rendering");
  assert.match(r[1].fix, /verbo/);
  assert.equal(r[2].fix, "Non sono legati.");
});

test("judgePropositions: verbo generico con riferimento anch'esso generico → consiglio generale, non il riferimento", async () => {
  const props = [{ id: "P1", from: "State", label: "riguarda", to: "Rendering", reference: "State è collegato a Rendering", referenceLabel: "è collegato a" }];
  const r = await withJudge([judged([{ id: "P1", reason: "r", verdict: "valid", fix: "" }])],
    () => ex.judgePropositions({ focusQuestion: "D?", propositions: props, passages: [] }));
  assert.equal(r[0].verdict, "imprecise");
  assert.match(r[0].fix, /verbo/);
  assert.notEqual(r[0].fix, "State è collegato a Rendering");
});

test("judgePropositions: concetti e definizioni nel prompt", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withJudge([judged([{ id: "P1", reason: "r", verdict: "valid", fix: "" }])], () => ex.judgePropositions({
    focusQuestion: "D?", passages: [], concepts: [{ title: "State", definition: "Dati locali." }],
    propositions: [{ id: "P1", from: "State", label: "provoca", to: "Rendering" }],
  }), bodies);
  assert.match(JSON.stringify(bodies[0]), /«State»: Dati locali\./);
});
