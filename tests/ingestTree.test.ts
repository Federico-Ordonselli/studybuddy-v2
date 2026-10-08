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
    "Solo/01_m/s.srt": "1\n00:00:01,000 --> 00:00:02,000\ns\n",
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

const course = (p: string, parent: unknown = null, include = true) =>
  ({ path: p, name: path.basename(p), areas: [], parent, include, status: "new", changedFiles: 0, videosWithoutSubs: 0, counts: {} });

test("applyPlan: piano senza corsi inclusi ⇒ rifiutato senza scrivere nel DB", () => {
  const m = L.createMacro("Intatto", ["A"]);
  const solo = path.join(lib, "Solo");
  const plan = {
    macros: [{ key: "x", existingId: m, name: "Cambiato", path: null, areas: ["B"] }, { key: "n", name: "Nuovo", path: null, areas: [] }],
    courses: [course(solo, { macroKey: "n" }, false)],
    whisper: false,
  };
  assert.throws(() => I.applyPlan(I.parsePlan(plan)), (e: unknown) => e instanceof L.LibraryError && e.status === 400);
  const d = L.getLibrary().macros.find((x) => x.id === m)!;
  assert.equal(d.name, "Intatto");
  assert.deepEqual(d.areas, ["A"]);
  assert.equal(L.getLibrary().macros.some((x) => x.name === "Nuovo"), false);
  assert.equal(L.findByPath(solo), undefined);
});

test("applyPlan: un macro esistente che nessun corso incluso usa non viene sovrascritto", () => {
  const m = L.createMacro("Vecchio nome", ["Area vecchia"]);
  const solo = path.join(lib, "Solo");
  const plan = {
    macros: [{ key: "x", existingId: m, name: "Scheda vecchia", path: null, areas: ["Altra"] }],
    courses: [course(solo)],
    whisper: false,
  };
  const steps = I.applyPlan(I.parsePlan(plan));
  assert.equal(steps.length, 1);
  const d = L.getLibrary().macros.find((x) => x.id === m)!;
  assert.equal(d.name, "Vecchio nome");
  assert.deepEqual(d.areas, ["Area vecchia"]);

  // usato da un corso incluso ⇒ il piano vale
  const used = { ...plan, courses: [course(solo, { existingId: m })] };
  I.applyPlan(I.parsePlan(used));
  assert.equal(L.getLibrary().macros.find((x) => x.id === m)!.name, "Scheda vecchia");
});

test("applyPlan: existingId di un macro che non è un macro ⇒ errore, niente modifiche", () => {
  const a = L.findByPath(path.join(lib, "Spec Beta", "Corso-a"))!;
  const solo = path.join(lib, "Solo");
  const plan = {
    macros: [{ key: "x", existingId: a.id, name: "Finto macro", path: null, areas: [] }],
    courses: [course(solo)], // anche se nessun corso lo usa: oggi rinominerebbe il corso
    whisper: false,
  };
  assert.throws(() => I.applyPlan(I.parsePlan(plan)), L.LibraryError);
  assert.equal(L.findByPath(path.join(lib, "Spec Beta", "Corso-a"))!.name, a.name);
});

test("activeJob: c'è un solo job attivo alla volta", () => {
  assert.equal(J.activeJob(), undefined);
  const j = J.createJob();
  assert.equal(J.activeJob()?.id, j.id);
  j.status = "done";
  assert.equal(J.activeJob(), undefined);
});
