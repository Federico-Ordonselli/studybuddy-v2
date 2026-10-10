import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { whisperEnv } from "@/lib/transcribe";
import { parseSubtitles } from "@/lib/subtitles";
import { useTempDb } from "./helpers/db";

// NODE_ENV è obbligatoria nel tipo di Next: qui conta solo il contenuto
const asEnv = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

test("whisperEnv: le lib nvidia della .venv vanno in testa a LD_LIBRARY_PATH, il valore di prima resta", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-venv-"));
  const nv = path.join(root, ".venv/lib/python3.12/site-packages/nvidia");
  for (const p of ["cublas", "cudnn"]) fs.mkdirSync(path.join(nv, p, "lib"), { recursive: true });
  fs.mkdirSync(path.join(nv, "senza-lib"), { recursive: true }); // pacchetto senza lib/: ignorato
  const env = whisperEnv(root, asEnv({ LD_LIBRARY_PATH: "/usr/local/cuda/lib64", FOO: "bar" }));
  assert.equal(env.LD_LIBRARY_PATH, [path.join(nv, "cublas/lib"), path.join(nv, "cudnn/lib"), "/usr/local/cuda/lib64"].join(":"));
  assert.equal(env.FOO, "bar");
});

test("whisperEnv: senza LD_LIBRARY_PATH precedente niente ':' finale", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-venv-"));
  const lib = path.join(root, ".venv/lib/python3.11/site-packages/nvidia/cublas/lib");
  fs.mkdirSync(lib, { recursive: true });
  assert.equal(whisperEnv(root, asEnv({})).LD_LIBRARY_PATH, lib);
});

test("whisperEnv: senza .venv l'env resta quello di prima", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-novenv-"));
  const base = asEnv({ LD_LIBRARY_PATH: "/x", PATH: "/usr/bin" });
  assert.deepEqual(whisperEnv(root, base), base);
});

test("parseSubtitles: spostato in lib/subtitles, coursera lo ri-esporta", async () => {
  const srt = "1\n00:00:01,000 --> 00:00:02,500\nCiao <b>mondo</b>\n\n2\n00:00:03,000 --> 00:00:04,000\nsecondo\n";
  assert.deepEqual(parseSubtitles(srt), [{ startSec: 1, endSec: 2.5, text: "Ciao mondo" }, { startSec: 3, endSec: 4, text: "secondo" }]);
  // coursera.ts apre il DB all'import: prima un DB temporaneo, mai lo studybuddy.db della radice
  await useTempDb();
  const { parseSubtitles: fromCoursera } = await import("@/lib/rag/sources/coursera");
  assert.equal(fromCoursera, parseSubtitles);
});

test('transcribeToSrt salta il video con warning alla scadenza del lock', async () => {
  const { whisper } = await import('@/lib/config');
  const { transcribeToSrt } = await import('@/lib/transcribe');
  const { exclusive } = await import('@/lib/transcriptionLock');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ingest-lock-'));
  const previousLock = process.env.STUDYBUDDY_TRANSCRIBE_LOCK;
  const previous = { ...whisper };
  const warn = console.warn;
  const warnings: string[] = [];
  process.env.STUDYBUDDY_TRANSCRIBE_LOCK = path.join(root, 'gpu.lock');
  Object.assign(whisper, { backend: 'whisper.cpp', cppBinary: '/bin/true', cppModel: 'test', lockWaitMs: 0 });
  console.warn = message => warnings.push(String(message));
  try {
    await exclusive(async () => assert.equal(await transcribeToSrt('video.mp4'), null));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /video.mp4.*trascrizione in corso/);
  } finally {
    Object.assign(whisper, previous);
    console.warn = warn;
    if (previousLock === undefined) delete process.env.STUDYBUDDY_TRANSCRIBE_LOCK;
    else process.env.STUDYBUDDY_TRANSCRIBE_LOCK = previousLock;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
