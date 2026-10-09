import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTempDb } from "./helpers/db";
import { makeTree } from "./helpers/fs";

let P: typeof import("@/lib/ingestPlan");
let T: typeof import("@/lib/ingestPlanTypes");
let L: typeof import("@/lib/library");
let C: typeof import("@/lib/rag/sources/coursera");
let sqlite: import("better-sqlite3").Database;
let lib: string;

before(async () => {
  let dir: string;
  ({ sqlite, dir } = await useTempDb());
  process.env.STUDYBUDDY_FS_ROOT = dir; // sandbox (lib/fsRoot): le fixture stanno qui sotto
  P = await import("@/lib/ingestPlan");
  T = await import("@/lib/ingestPlanTypes");
  L = await import("@/lib/library");
  C = await import("@/lib/rag/sources/coursera");
  lib = path.join(dir, "libreria");
  makeTree(lib, {
    // specializzazione: corsi con nomi, più una cartella numerata senza materiale
    "Spec Alfa/Corso-uno/01_mod/01_lez/a.srt": "1\n00:00:01,000 --> 00:00:02,000\nciao\n",
    "Spec Alfa/Corso-due/01_mod/b.html": "<html><body><p>testo</p></body></html>",
    "Spec Alfa/0. Link utili/sito.url": "[InternetShortcut]",
    "Spec Alfa/Info.txt": "spazzatura del download",
    // corso singolo: moduli numerati
    "corso-singolo/01_intro/x.srt": "1\n00:00:01,000 --> 00:00:02,000\nx\n",
    "corso-singolo/02_altro/y.srt": "1\n00:00:01,000 --> 00:00:02,000\ny\n",
    "corso-singolo/02_altro/v.mp4": "finto video",
    // nome con spazi, apostrofo e accento
    "Corso dell'Arte è/01_m/z.srt": "1\n00:00:01,000 --> 00:00:02,000\nz\n",
    // niente materiale
    "vuota/link.url": "[InternetShortcut]",
  });
});

test("classifyFolder: nomi ⇒ macro, moduli numerati ⇒ corso, vuota ⇒ null", async () => {
  assert.equal(await P.classifyFolder(path.join(lib, "Spec Alfa")), "macro");
  assert.equal(await P.classifyFolder(path.join(lib, "corso-singolo")), "course");
  assert.equal(await P.classifyFolder(path.join(lib, "vuota")), null);
});

test("classifyFolder: parità numerati/non numerati ⇒ corso", async () => {
  const d = path.join(lib, "..", "parita");
  makeTree(d, { "01_a/a.srt": "1\n00:00:01,000 --> 00:00:02,000\na\n", "Risorse/r.html": "<p>r</p>" });
  assert.equal(await P.classifyFolder(d), "course");
});

test("analyzeLibrary: la cartella-libreria non è un macro; ogni elemento è classificato", async () => {
  const { items } = await P.analyzeLibrary(lib);
  const byName = new Map(items.map((i) => [i.name, i]));
  assert.equal(byName.get("Spec Alfa")?.kind, "macro");
  assert.deepEqual(byName.get("Spec Alfa")?.courses.map((c) => c.name).sort(), ["Corso-due", "Corso-uno"]);
  assert.equal(byName.get("corso-singolo")?.kind, "course");
  assert.ok(byName.has("Corso dell'Arte è"));
  assert.ok(!byName.has("vuota"));
});

test("analyzeFolder: conteggi, video senza sottotitoli, stato nuovo", async () => {
  const it = (await P.analyzeFolder(path.join(lib, "corso-singolo")))!;
  const c = it.courses[0];
  assert.equal(c.counts.transcript, 2);
  assert.equal(c.counts.video, 1);
  assert.equal(c.videosWithoutSubs, 1);
  assert.equal(c.status, "new");
  assert.equal(c.changedFiles, 2);
});

test("analyzeFolder con as: forza macro su un corso singolo", async () => {
  const it = (await P.analyzeFolder(path.join(lib, "corso-singolo"), { as: "macro" }))!;
  assert.equal(it.kind, "macro");
  assert.deepEqual(it.courses.map((c) => c.name).sort(), ["01_intro", "02_altro"]);
});

test("stato: aggiornato dopo la registrazione degli hash, poi modificato", async () => {
  const dir = path.join(lib, "Corso dell'Arte è");
  (await import("@/lib/areas")).createArea({ name: "Arte" });
  const id = L.createCourse("Arte", dir, null, ["arte"]);
  for (const w of C.selectWork(await C.walk(dir), false)) {
    sqlite.prepare("INSERT INTO ingested_files (domain_id, source, file_hash) VALUES (?, ?, ?)").run(id, w.file, C.fileHashOf(fs.readFileSync(w.file)));
  }
  let c = (await P.analyzeFolder(dir))!.courses[0];
  assert.equal(c.status, "upToDate");
  assert.equal(c.existingId, id);
  assert.equal(c.name, "Arte");            // nome dal DB, non dalla cartella
  assert.deepEqual(c.areas, ["arte"]);
  fs.writeFileSync(path.join(dir, "01_m/z.srt"), "1\n00:00:01,000 --> 00:00:02,000\nmodificato\n");
  c = (await P.analyzeFolder(dir))!.courses[0];
  assert.equal(c.status, "changed");
  assert.equal(c.changedFiles, 1);
});

test("newInLibrary: solo le cartelle con materiale non ancora importate", async () => {
  const fresh = (await P.newInLibrary(lib)).fresh.map((f) => f.name).sort();
  assert.ok(fresh.includes("Spec Alfa") && fresh.includes("corso-singolo"));
  assert.ok(!fresh.includes("Corso dell'Arte è")); // importata nel test precedente
  assert.ok(!fresh.includes("vuota"));
  assert.deepEqual(await P.newInLibrary(path.join(lib, "non-esiste")), { fresh: [], skipped: [] });
});

test("defaultPlan: corso esistente tiene il suo macro; nuovi sotto il macro della cartella", async () => {
  const altro = L.createMacro("Altro macro");
  const spec = path.join(lib, "Spec Alfa");
  L.createCourse("Uno spostato", path.join(spec, "Corso-uno"), altro);
  const plan = T.defaultPlan([(await P.analyzeFolder(spec))!]);
  const uno = plan.courses.find((c) => c.path.endsWith("Corso-uno"))!;
  const due = plan.courses.find((c) => c.path.endsWith("Corso-due"))!;
  assert.deepEqual(uno.parent, { existingId: altro });
  assert.equal(uno.name, "Uno spostato");
  assert.deepEqual(due.parent, { macroKey: spec });
  const grouped = T.groupIntoNewMacro(plan, [due.path], "Nuovo");
  const key = grouped.macros.at(-1)!.key;
  assert.deepEqual(grouped.courses.find((c) => c.path === due.path)!.parent, { macroKey: key });
});

test("analyzeFolder: una cartella già importata tiene il tipo del DB, non quello indovinato", async () => {
  const numerata = path.join(lib, "..", "girata-macro");
  makeTree(numerata, { "01_a/a.srt": "1\n00:00:01,000 --> 00:00:02,000\na\n", "02_b/b.srt": "1\n00:00:01,000 --> 00:00:02,000\nb\n" });
  L.createMacro("Girata a macro", [], [], numerata); // l'utente ha corretto l'euristica al primo import
  assert.equal((await P.analyzeFolder(numerata))?.kind, "macro");

  const nomi = path.join(lib, "..", "girata-corso");
  makeTree(nomi, { "Uno/a.srt": "1\n00:00:01,000 --> 00:00:02,000\na\n", "Due/b.srt": "1\n00:00:01,000 --> 00:00:02,000\nb\n" });
  L.createCourse("Girata a corso", nomi, null);
  assert.equal((await P.analyzeFolder(nomi))?.kind, "course");
});

test("analyzePath: la cartella-libreria scelta col browser si analizza come libreria, non come macro", async () => {
  const { items } = await P.analyzePath(lib, { libraryDir: lib });
  const names = items.map((i) => i.name);
  assert.ok(names.includes("Spec Alfa") && names.includes("corso-singolo"));
  assert.equal(items.find((i) => i.path === lib), undefined);
});

test("analyzePath: una cartella madre della libreria espande la libreria al suo posto", async () => {
  const parent = path.join(lib, "..");
  const { items } = await P.analyzePath(parent, { libraryDir: lib });
  assert.equal(items.find((i) => i.path === lib), undefined); // la libreria non diventa «un macro»
  assert.ok(items.some((i) => i.path === path.join(lib, "Spec Alfa") && i.kind === "macro"));
  assert.ok(items.some((i) => i.path === path.join(lib, "corso-singolo") && i.kind === "course"));
});

test("analyzePath: una cartella qualunque resta un elemento solo", async () => {
  const { items } = await P.analyzePath(path.join(lib, "Spec Alfa"), { libraryDir: lib });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "macro");
});

test("newInLibrary: una cartella-macro con tutti i corsi già importati altrove non è «nuova»", async () => {
  const l2 = path.join(lib, "..", "libreria-banner");
  makeTree(l2, {
    "Spec Gamma/Corso-A/01_m/a.srt": "1\n00:00:01,000 --> 00:00:02,000\na\n",
    "Spec Gamma/Corso-B/01_m/b.srt": "1\n00:00:01,000 --> 00:00:02,000\nb\n",
  });
  const names = async () => (await P.newInLibrary(l2)).fresh.map((f) => f.name);
  assert.deepEqual(await names(), ["Spec Gamma"]);
  // un corso importato sotto un altro macro: l'altro è ancora da importare
  L.createCourse("A", path.join(l2, "Spec Gamma", "Corso-A"), L.createMacro("Altrove"));
  assert.deepEqual(await names(), ["Spec Gamma"]);
  // anche il secondo, sciolto: niente più da segnalare
  L.createCourse("B", path.join(l2, "Spec Gamma", "Corso-B"), null);
  assert.deepEqual(await names(), []);
});
