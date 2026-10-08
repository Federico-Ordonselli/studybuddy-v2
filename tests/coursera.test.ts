import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { useTempDb } from "./helpers/db";
import { makeTree } from "./helpers/fs";

let C: typeof import("@/lib/rag/sources/coursera");
let L: typeof import("@/lib/library");
let sqlite: import("better-sqlite3").Database;
let dir: string;

before(async () => {
  ({ sqlite, dir } = await useTempDb());
  C = await import("@/lib/rag/sources/coursera");
  L = await import("@/lib/library");
});

test("selectWork: salta .txt gemelli, video coperti da srt, file spazzatura", () => {
  const files = ["/c/01_m/a.srt", "/c/01_m/a.txt", "/c/01_m/a.mp4", "/c/01_m/b.mp4", "/c/01_m/r.html", "/c/x.url", "/c/n.txt"];
  const noWhisper = C.selectWork(files, false).map((w) => path.basename(w.file));
  assert.deepEqual(noWhisper, ["a.srt", "r.html", "n.txt"]);
  const withWhisper = C.selectWork(files, true).map((w) => path.basename(w.file));
  assert.ok(withWhisper.includes("b.mp4") && !withWhisper.includes("a.mp4"));
});

test("selectWork: un video è coperto anche da sottotitoli con tag di lingua (x.en.srt)", () => {
  const files = ["/c/01_m/01_x.en.srt", "/c/01_m/01_x.en.txt", "/c/01_m/01_x.mp4", "/c/01_m/02_y.pt-BR.vtt", "/c/01_m/02_y.mp4", "/c/01_m/03_z.mp4"];
  const work = C.selectWork(files, true).map((w) => path.basename(w.file));
  assert.deepEqual(work.filter((f) => f.endsWith(".mp4")), ["03_z.mp4"]); // solo quello senza sottotitoli
  assert.ok(!work.includes("01_x.en.txt"));
});

test("fileHashOf include la versione del parser", () => {
  const buf = Buffer.from("ciao");
  assert.notEqual(C.fileHashOf(buf), createHash("sha1").update(buf).digest("hex"));
  assert.equal(C.fileHashOf(buf), C.fileHashOf(Buffer.from("ciao")));
});

test("ingestCourse registra anche i file che non producono documenti", async () => {
  const course = path.join(dir, "corso-vuoto");
  makeTree(course, { "01_m/vuoto.html": "<html><body></body></html>", "01_m/vuoto.srt": "" });
  const id = L.createCourse("Vuoto", course, null);
  const stats = await C.ingestCourse(course, id);
  assert.equal(stats.documents, 0);
  const n = (sqlite.prepare("SELECT count(*) AS n FROM ingested_files WHERE domain_id = ?").get(id) as { n: number }).n;
  assert.equal(n, 2);
});

test("ingestCourse: un file il cui embedding fallisce non risulta ingerito", async () => {
  const course = path.join(dir, "corso-embed-ko");
  makeTree(course, { "01_m/a.srt": "1\n00:00:01,000 --> 00:00:02,000\ntesto da indicizzare\n" });
  const id = L.createCourse("Embed KO", course, null);
  const prev = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9"; // nessun provider raggiungibile
  try {
    await assert.rejects(C.ingestCourse(course, id));
  } finally {
    if (prev === undefined) delete process.env.OLLAMA_BASE_URL; else process.env.OLLAMA_BASE_URL = prev;
  }
  const n = (sqlite.prepare("SELECT count(*) AS n FROM ingested_files WHERE domain_id = ?").get(id) as { n: number }).n;
  assert.equal(n, 0);
});
