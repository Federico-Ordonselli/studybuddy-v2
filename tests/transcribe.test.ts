import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { whisperEnv } from "@/lib/transcribe";

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
