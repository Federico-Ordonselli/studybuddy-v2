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
  assert.ok(ex.exerciseLevels(map.id).some((l) => l.levelKey === stateId));
});

test("expandExercise: mappa non-esercizio 409, concetto inesistente 404", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React5", FOUND));
  const id = (map.concepts as { id: string }[])[0].id;
  await assert.rejects(ex.expandExercise(map.id, 1, "nessuno", req, FOUND), (e: unknown) => e instanceof ex.ExerciseError && e.status === 404);
  sqlite.prepare("DELETE FROM map_exercises WHERE map_id = ?").run(map.id);
  await assert.rejects(ex.expandExercise(map.id, 1, id, req, FOUND), (e: unknown) => e instanceof ex.ExerciseError && e.status === 409 && /non è un esercizio/.test(e.message));
});
