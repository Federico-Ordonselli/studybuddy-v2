import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTempDb } from "./helpers/db";
import { makeTree } from "./helpers/fs";

let P: typeof import("@/lib/ingestPlan");
let C: typeof import("@/lib/rag/sources/coursera");
let I: typeof import("@/lib/ingestTree");
let L: typeof import("@/lib/library");
let lib: string;
let fuori: string;

const SRT = "1\n00:00:01,000 --> 00:00:02,000\nciao\n";

before(async () => {
  const { dir } = await useTempDb();
  process.env.STUDYBUDDY_FS_ROOT = dir; // sandbox = la cartella temporanea del test
  P = await import("@/lib/ingestPlan");
  C = await import("@/lib/rag/sources/coursera");
  I = await import("@/lib/ingestTree");
  L = await import("@/lib/library");
  lib = path.join(dir, "libreria");
  fuori = fs.mkdtempSync(path.join(os.tmpdir(), "sb-fuori-")); // fuori dalla sandbox
  makeTree(dir, {
    "libreria/normale/01_m/a.srt": SRT,
    "altrove/corso-linkato/01_m/b.srt": SRT,
    "altrove/segreto.srt": SRT,
  });
  makeTree(fuori, { "corso-esterno/01_m/c.srt": SRT, "esterno.srt": SRT });
  fs.symlinkSync(path.join(dir, "altrove", "corso-linkato"), path.join(lib, "dentro"));
  fs.symlinkSync(path.join(fuori, "corso-esterno"), path.join(lib, "esterno"));
  fs.symlinkSync(path.join(dir, "non-esiste"), path.join(lib, "rotto"));
  // file-link dentro un corso: uno verso la sandbox, uno fuori
  fs.symlinkSync(path.join(dir, "altrove", "segreto.srt"), path.join(lib, "normale", "01_m", "dentro.srt"));
  fs.symlinkSync(path.join(fuori, "esterno.srt"), path.join(lib, "normale", "01_m", "fuori.srt"));
});

test("analyzeLibrary: segue i link a cartelle dentro la sandbox, segnala gli altri", async () => {
  const { items, skipped } = await P.analyzeLibrary(lib);
  assert.deepEqual(items.map((i) => i.name).sort(), ["dentro", "normale"]);
  assert.deepEqual(skipped.map((s) => s.name).sort(), ["esterno", "rotto"]);
  assert.ok(skipped.every((s) => s.reason));
});

test("newInLibrary: i link fuori sandbox non compaiono nel banner", async () => {
  const names = (await P.newInLibrary(lib)).map((f) => f.name).sort();
  assert.deepEqual(names, ["dentro", "normale"]);
});

test("walk: i file-link fuori sandbox vengono ignorati, quelli dentro tenuti", async () => {
  const files = (await C.walk(path.join(lib, "normale"))).map((f) => path.basename(f)).sort();
  assert.deepEqual(files, ["a.srt", "dentro.srt"]);
});

test("parsePlan: un percorso che è un link verso fuori sandbox ⇒ 403", () => {
  const course = (p: string) => ({ path: p, name: "x", areas: [], parent: null, include: true });
  assert.throws(
    () => I.parsePlan({ macros: [], courses: [course(path.join(lib, "esterno"))], whisper: false }),
    (e: unknown) => e instanceof L.LibraryError && e.status === 403
  );
  assert.doesNotThrow(() => I.parsePlan({ macros: [], courses: [course(path.join(lib, "dentro"))], whisper: false }));
});

test("cartella-libreria che è un link verso fuori sandbox: niente elementi importabili, tutto segnalato", async () => {
  const libLink = path.join(lib, "..", "libreria-link");
  fs.symlinkSync(fuori, libLink);
  const { items, skipped } = await P.analyzeLibrary(libLink);
  assert.deepEqual(items, []); // altrimenti l'anteprima li proporrebbe e l'import darebbe 403
  assert.ok(skipped.some((s) => s.name === "corso-esterno"));
});
