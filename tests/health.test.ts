import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { useTempDb } from "./helpers/db";

let H: typeof import("@/lib/health");
let server: http.Server;
let base: string;

before(async () => {
  await useTempDb();
  H = await import("@/lib/health");
  server = http.createServer((req, res) => {
    if (req.url === "/api/tags") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ models: [{ name: "gemma4:12b" }, { name: "qwen3-embedding:0.6b" }] })); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test("health: DB ok, Ollama raggiungibile con i suoi modelli, reranker non ancora caricato", async () => {
  process.env.OLLAMA_BASE_URL = base;
  const h = await H.getHealth();
  assert.equal(h.db.ok, true);
  assert.equal(h.ollama.ok, true);
  assert.deepEqual(h.ollama.models, ["gemma4:12b", "qwen3-embedding:0.6b"]);
  assert.equal(h.reranker, "idle");
  assert.equal(typeof h.whisper.available, "boolean");
  assert.equal(h.ok, true);
});

test("health: Ollama spento ⇒ ok:false con errore leggibile, in fretta", async () => {
  // porta appena liberata: connessione rifiutata
  const tmp = http.createServer();
  await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", r));
  const port = (tmp.address() as AddressInfo).port;
  await new Promise<void>((r) => tmp.close(() => r()));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  const h = await H.getHealth();
  assert.ok(Date.now() - t0 < 4000, "non deve bloccare"); // margine: whisperAvailable() avvia Python
  assert.equal(h.ollama.ok, false);
  assert.ok(h.ollama.error && h.ollama.error.length > 0);
  assert.equal(h.ok, false);
  assert.equal(h.db.ok, true);
});

test("health: whisperAvailable si calcola una volta per processo (niente Python a ogni richiesta)", async () => {
  const first = (await H.getHealth()).whisper.available;
  // senza PATH e fuori dal progetto nessun backend sarebbe trovabile: se cambia, non è in cache
  const cwd = process.cwd(), pathEnv = process.env.PATH;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-nowhisper-"));
  try {
    process.chdir(tmp);
    process.env.PATH = "";
    assert.equal((await H.getHealth()).whisper.available, first);
  } finally {
    process.chdir(cwd);
    process.env.PATH = pathEnv;
  }
});
