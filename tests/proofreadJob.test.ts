import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cancelProofread, currentProofread, listVaults, startProofread } from "@/lib/proofread/job";
import { STATE_FILE } from "@/lib/proofread/vault";
import { LibraryError } from "@/lib/errors";
import type { Generator } from "@/lib/proofread/note";

function root() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "proofread-job-"));
  fs.mkdirSync(path.join(r, "corso", ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(r, "corso", "a.md"), "una nota e' qui\n");
  fs.writeFileSync(path.join(r, "corso", "b.md"), "un altra nota e' qui\n");
  fs.mkdirSync(path.join(r, "vuoto"));
  fs.mkdirSync(path.join(r, ".nascosto"));
  fs.writeFileSync(path.join(r, ".nascosto", "x.md"), "x");
  return r;
}

async function finished() {
  for (let i = 0; i < 200 && currentProofread()?.status === "running"; i++) await new Promise((r) => setTimeout(r, 5));
  return currentProofread()!;
}

const fix: Generator = async (o) => o.messages[0].content.replace("e'", "è");

test("listVaults: solo cartelle con note, niente nascoste né copie", async () => {
  const r = root();
  assert.deepEqual(listVaults(r).map((v) => [v.name, v.notes, v.copy]), [["corso", 2, "corso-pulito"]]);
  fs.mkdirSync(path.join(r, "corso-pulito"));
  fs.writeFileSync(path.join(r, "corso-pulito", "a.md"), "x");
  fs.writeFileSync(path.join(r, "corso-pulito", STATE_FILE), JSON.stringify({ version: 1, files: {} }));
  assert.deepEqual(listVaults(r).map((v) => v.name), ["corso"], "la copia non è un vault da correggere");
  assert.deepEqual(listVaults(path.join(r, "manca")), []);
});

test("startProofread: passata completa con avanzamento, poi da rivedere nell'elenco", async () => {
  const r = root();
  const job = startProofread({ vault: "corso" }, { root: r, gen: fix });
  assert.equal(job.status, "running");
  const done = await finished();
  assert.equal(done.status, "done");
  assert.equal(done.total, 2);
  assert.equal(done.processed, 2);
  assert.equal(done.counts.corrected, 2);
  assert.equal(fs.readFileSync(path.join(r, "corso-pulito", "a.md"), "utf8"), "una nota è qui\n");
  assert.equal(fs.readFileSync(path.join(r, "corso", "a.md"), "utf8"), "una nota e' qui\n");
  const [v] = listVaults(r);
  assert.ok(v.lastRun);
  assert.deepEqual(v.review, []);

  const again = startProofread({ vault: "corso" }, { root: r, gen: async () => assert.fail("note invariate") });
  assert.equal(again.id !== job.id, true);
  assert.equal((await finished()).counts.skipped, 2);
});

test("startProofread: vault inesistente o percorso → 404, nessun job", () => {
  const r = root();
  for (const vault of ["../corso", "corso/..", "vuoto", "", 3]) {
    assert.throws(() => startProofread({ vault }, { root: r, gen: fix }), (e: unknown) => e instanceof LibraryError);
  }
});

test("una correzione alla volta; Interrompi la ferma e tiene le note già fatte", async () => {
  const r = root();
  let release!: () => void;
  const gate = new Promise<void>((ok) => (release = ok));
  let calls = 0;
  const slow: Generator = async (o) => {
    calls++;
    if (calls === 2) await gate;
    o.signal?.throwIfAborted();
    return o.messages[0].content.replace("e'", "è");
  };
  startProofread({ vault: "corso" }, { root: r, gen: slow });
  await new Promise((ok) => setTimeout(ok, 20));
  assert.throws(() => startProofread({ vault: "corso" }, { root: r, gen: fix }), (e: unknown) => e instanceof LibraryError && e.status === 409);
  cancelProofread();
  release();
  const job = await finished();
  assert.equal(job.status, "cancelled");
  assert.equal(job.counts.corrected, 1);
  assert.ok(fs.existsSync(path.join(r, "corso-pulito", "a.md")));
  assert.throws(() => cancelProofread(), (e: unknown) => e instanceof LibraryError && e.status === 409);
});

test("Ollama spento: errore leggibile, non uno per nota", async () => {
  const { OllamaUnavailableError } = await import("@/lib/errors");
  const r = root();
  let calls = 0;
  startProofread({ vault: "corso" }, { root: r, gen: async () => { calls++; throw new OllamaUnavailableError("giù"); } });
  const job = await finished();
  assert.equal(job.status, "error");
  assert.match(job.error ?? "", /Ollama non raggiungibile/);
  assert.equal(calls, 1);
});
