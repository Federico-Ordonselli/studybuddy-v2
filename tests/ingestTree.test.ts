import { test, before } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { useTempDb } from "./helpers/db";
import { makeTree } from "./helpers/fs";

let I: typeof import("@/lib/ingestTree");
let P: typeof import("@/lib/ingestPlan");
let T: typeof import("@/lib/ingestPlanTypes");
let L: typeof import("@/lib/library");
let J: typeof import("@/lib/jobs");
let lib: string;

before(async () => {
  const { dir } = await useTempDb();
  // la sandbox (lib/fsRoot) è la home: le fixture devono stare lì sotto
  process.env.STUDYBUDDY_FS_ROOT = dir;
  I = await import("@/lib/ingestTree");
  P = await import("@/lib/ingestPlan");
  T = await import("@/lib/ingestPlanTypes");
  L = await import("@/lib/library");
  J = await import("@/lib/jobs");
  lib = path.join(dir, "libreria");
  makeTree(lib, {
    "Spec Beta/Corso-a/01_m/a.srt": "1\n00:00:01,000 --> 00:00:02,000\na\n",
    "Spec Beta/Corso-b/01_m/b.srt": "1\n00:00:01,000 --> 00:00:02,000\nb\n",
  });
});

test("parsePlan: rifiuta forma non valida e percorsi fuori sandbox", () => {
  assert.throws(() => I.parsePlan({}), L.LibraryError);
  const bad = { macros: [], courses: [{ path: "/etc", name: "x", areas: [], parent: null, include: true }], whisper: false };
  assert.throws(() => I.parsePlan(bad), (e: unknown) => e instanceof L.LibraryError && e.status === 403);
  const sneaky = { ...bad, courses: [{ ...bad.courses[0], path: path.join(os.tmpdir(), "..", "etc") }] };
  assert.throws(() => I.parsePlan(sneaky), (e: unknown) => e instanceof L.LibraryError && e.status === 403);
});

test("applyPlan: crea macro + corsi; re-import dopo spostamento manuale non disfa niente", async () => {
  const spec = path.join(lib, "Spec Beta");
  const plan = T.defaultPlan([(await P.analyzeFolder(spec))!]);
  const steps = I.applyPlan(I.parsePlan(plan));
  assert.equal(steps.length, 2);
  const a = L.findByPath(path.join(spec, "Corso-a"))!;
  const macro = L.findByPath(spec)!;
  assert.equal(macro.kind, "macro");
  assert.equal(a.parentId, macro.id);

  // organizzazione manuale
  const altro = L.createMacro("Altro");
  L.updateDomain(a.id, { parentId: altro, name: "Rinominato", areas: ["Web"] });

  // re-analisi + piano proposto + applicazione
  const again = T.defaultPlan([(await P.analyzeFolder(spec))!]);
  again.courses.forEach((c) => (c.include = true));
  I.applyPlan(I.parsePlan(again));
  const a2 = L.findByPath(path.join(spec, "Corso-a"))!;
  assert.equal(a2.parentId, altro);
  assert.equal(a2.name, "Rinominato");
  assert.deepEqual(a2.areas, ["Web"]);
});

test("applyPlan: macroKey sconosciuta ⇒ errore e nessuna modifica", () => {
  const p = path.join(lib, "Spec Beta", "Corso-b");
  const before = L.findByPath(p);
  const plan = { macros: [], courses: [{ path: p, name: "B", areas: [], parent: { macroKey: "boh" }, include: true }], whisper: false };
  assert.throws(() => I.applyPlan(I.parsePlan(plan)), L.LibraryError);
  assert.deepEqual(L.findByPath(p), before);
});

test("applyPlan: un path che è già un macro non diventa un corso", () => {
  const spec = path.join(lib, "Spec Beta");
  const plan = { macros: [], courses: [{ path: spec, name: "x", areas: [], parent: null, include: true }], whisper: false };
  assert.throws(() => I.applyPlan(I.parsePlan(plan)), L.LibraryError);
});

test("activeJob: c'è un solo job attivo alla volta", () => {
  assert.equal(J.activeJob(), undefined);
  const j = J.createJob();
  assert.equal(J.activeJob()?.id, j.id);
  j.status = "done";
  assert.equal(J.activeJob(), undefined);
});
