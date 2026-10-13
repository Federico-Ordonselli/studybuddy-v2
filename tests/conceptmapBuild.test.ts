import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import { withJudge } from "./helpers/judge";

await useTempDb();
const { generateMap, proposeMap, expandConcept } = await import("@/lib/conceptmap");

const chunk = (id: number, content: string) => ({ chunkId: id, documentId: 1, content, distance: 0, source: null, docKind: "text", docMeta: { fileHash: "h" } });
const FOUND = [chunk(10, "Lo state provoca il rendering."), chunk(11, "Le props arrivano dal genitore.")];
const reply = (extra: Record<string, unknown> = {}) => JSON.stringify({
  center: { title: "React", definition: "Libreria UI.", explanation: "x", sources: [1] },
  concepts: [
    { title: "State", definition: "Dati locali.", explanation: "y", sources: [1], verb: "gestisce" },
    { title: "Props", definition: "Dati dal genitore.", explanation: "z", sources: [2], verb: "riceve" },
  ],
  relations: [{ from: "State", to: "Props", label: "differisce da" }],
  ...extra,
});

test("modalità normale: schema e prompt senza focus_question", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withJudge([reply()], () => generateMap(1, "React", FOUND), bodies);
  const body = JSON.stringify(bodies[0]);
  assert.ok(!body.includes("focus_question"));
  const n = await withJudge([reply()], () => proposeMap(1, "React", FOUND));
  assert.equal(n.sourceChunkIds, undefined, "modalità normale invariata");
});

test("modalità build: schema con focus_question e domanda focale restituita", async () => {
  const bodies: Record<string, unknown>[] = [];
  const r = await withJudge([reply({ focus_question: "  Come decide React quando ridisegnare?  " })], () => proposeMap(1, "React", FOUND, { build: true }), bodies);
  assert.equal(r.focusQuestion, "Come decide React quando ridisegnare?");
  assert.ok(JSON.stringify(bodies[0]).includes("focus_question"));
  assert.ok(r.relations.some((x) => x.from === "React" && x.to === "State" && x.label === "gestisce"));
  assert.equal(r.concepts[0].title, "React");
  assert.deepEqual(r.sourceChunkIds, [10, 11], "id dei chunk usati, in ordine");
});

test("modalità build: domanda focale vuota → fallback", async () => {
  const r = await withJudge([reply({ focus_question: "" })], () => proposeMap(1, "React", FOUND, { build: true }));
  assert.equal(r.focusQuestion, "Come si collegano fra loro i concetti di «React»?");
});

test("expandConcept in modalità build: focusQuestion presente; senza build assente", async () => {
  // Materiale passato esplicitamente: niente ricerca ibrida (l'embed del finto Ollama risponde 503).
  const r = await withJudge([reply({ focus_question: "Di cosa è fatto lo state?" })], () =>
    expandConcept(1, { title: "State" }, [], [], [], { build: true, sourceChunks: FOUND }));
  assert.equal(r.focusQuestion, "Di cosa è fatto lo state?");
  const n = await withJudge([reply()], () => expandConcept(1, { title: "State" }, [], [], [], { sourceChunks: FOUND }));
  assert.equal(n.focusQuestion, undefined);
});
