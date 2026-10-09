import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { groqKey, transcribeFile, transcribeChunks } from "@/lib/groq";
import { chunkAudio } from "@/lib/media";
import { transcribeBackend } from "@/lib/transcribe";

// NODE_ENV è obbligatoria nel tipo di Next: qui conta solo il contenuto
const asEnv = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-groq-"));
const audio = path.join(dir, "a.mp3");
fs.writeFileSync(audio, Buffer.from("finto mp3"));

let server: http.Server;
let base = "";
let last: { auth?: string; body: string } = { body: "" };
let status = 200;
before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      last = { auth: req.headers.authorization, body };
      res.statusCode = status;
      res.end(status === 200 ? JSON.stringify({ text: " ciao mondo ", language: "it", duration: 12.5 }) : "chiave non valida");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/audio/transcriptions`;
});
after(() => server.close());

test("groq: multipart con modello, verbose_json, lingua e chiave Bearer", async () => {
  status = 200;
  const r = await transcribeFile(audio, { apiKey: "k-finta", url: base, language: "it" });
  assert.deepEqual(r, { text: "ciao mondo", language: "it", durationSec: 12.5 });
  assert.equal(last.auth, "Bearer k-finta");
  assert.match(last.body, /name="model"\r\n\r\nwhisper-large-v3-turbo/);
  assert.match(last.body, /name="response_format"\r\n\r\nverbose_json/);
  assert.match(last.body, /name="language"\r\n\r\nit/);
});

test("groq: errore HTTP leggibile, file oltre 24 MB rifiutato prima dell'invio", async () => {
  status = 401;
  await assert.rejects(transcribeFile(audio, { apiKey: "k", url: base }), /Groq 401: chiave non valida/);
  const big = path.join(dir, "big.mp3");
  fs.writeFileSync(big, "");
  fs.truncateSync(big, 25 * 1024 * 1024);
  await assert.rejects(transcribeFile(big, { apiKey: "k", url: base }), /troppo grande/);
});

test("groq: chunk in parallelo ma testo nell'ordine dei chunk, durate sommate", async () => {
  const delays = [60, 10, 30];
  const r = await transcribeChunks(["0", "1", "2"], async (p) => {
    await new Promise((res) => setTimeout(res, delays[Number(p)]));
    return { text: `parte${p}`, language: p === "0" ? null : "en", durationSec: 10 };
  });
  assert.deepEqual(r, { text: "parte0 parte1 parte2", language: "en", durationSec: 30 });
});

test("backend: locale di default, groq solo se richiesto, chiave obbligatoria, valori sconosciuti rifiutati", () => {
  assert.equal(transcribeBackend(asEnv({})), "local");
  assert.equal(transcribeBackend(asEnv({ TRANSCRIBE_BACKEND: "local" })), "local");
  assert.equal(transcribeBackend(asEnv({ TRANSCRIBE_BACKEND: "groq" })), "groq");
  assert.throws(() => transcribeBackend(asEnv({ TRANSCRIBE_BACKEND: "cloud" })), /TRANSCRIBE_BACKEND/);
  assert.throws(() => groqKey(asEnv({})), /GROQ_API_KEY/);
  assert.equal(groqKey(asEnv({ GROQ_API_KEY: " k " })), "k");
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
test("media: chunkAudio taglia a segmenti della durata chiesta", { skip: !hasFfmpeg && "ffmpeg assente" }, async () => {
  const src = path.join(dir, "sine.mp3");
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=25", "-ac", "1", "-ar", "16000", "-b:a", "32k", src]);
  const chunks = await chunkAudio(src, dir, 10);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => path.basename(c)), ["chunk-000.mp3", "chunk-001.mp3", "chunk-002.mp3"]);
});
