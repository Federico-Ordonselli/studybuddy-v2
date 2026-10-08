import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let B: typeof import("@/lib/fsBrowse");
let root: string;
let fuori: string;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-fs-"));
  fuori = fs.mkdtempSync(path.join(os.tmpdir(), "sb-fuori-"));
  process.env.STUDYBUDDY_FS_ROOT = root; // FS_ROOT si legge all'import
  B = await import("@/lib/fsBrowse");
  for (const d of ["corsi/vero", "altrove/linkato/dentro", ".nascosta"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.mkdirSync(path.join(fuori, "esterno"));
  fs.writeFileSync(path.join(root, "corsi", "file.txt"), "");
  fs.symlinkSync(path.join(root, "altrove", "linkato"), path.join(root, "corsi", "link-dentro"));
  fs.symlinkSync(path.join(fuori, "esterno"), path.join(root, "corsi", "link-fuori"));
  fs.symlinkSync(path.join(root, "non-esiste"), path.join(root, "corsi", "link-rotto"));
  fs.symlinkSync(path.join(root, "corsi", "file.txt"), path.join(root, "corsi", "link-file"));
});

test("listDirs: cartelle vere e link a cartelle dentro la sandbox; niente link fuori, rotti o a file", async () => {
  const r = await B.listDirs(path.join(root, "corsi"));
  assert.ok(r);
  assert.deepEqual(r.dirs.map((d) => d.name), ["link-dentro", "vero"]);
  assert.equal(r.dirs[0].path, path.join(root, "corsi", "link-dentro"));
  assert.equal(r.parent, root);
});

test("listDirs: si entra in un link dentro la sandbox, il genitore resta quello del percorso", async () => {
  const r = await B.listDirs(path.join(root, "corsi", "link-dentro"));
  assert.ok(r);
  assert.deepEqual(r.dirs.map((d) => d.name), ["dentro"]);
  assert.equal(r.parent, path.join(root, "corsi"));
});

test("listDirs: un link che porta fuori dalla sandbox non si apre", async () => {
  assert.equal(await B.listDirs(path.join(root, "corsi", "link-fuori")), null);
  assert.equal(await B.listDirs(fuori), null);
});

test("listDirs: la root non ha genitore e nasconde le cartelle che iniziano col punto", async () => {
  const r = await B.listDirs(root);
  assert.ok(r);
  assert.equal(r.parent, null);
  assert.deepEqual(r.dirs.map((d) => d.name), ["altrove", "corsi"]);
});
