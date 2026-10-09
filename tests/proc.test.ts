import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, runOk, venvBin } from "@/lib/proc";

test("run: non blocca l'event loop mentre il processo gira", async () => {
  let ticks = 0;
  const t = setInterval(() => ticks++, 20);
  const r = await run("sleep", ["0.3"], { timeoutMs: 5000 });
  clearInterval(t);
  assert.equal(r.code, 0);
  assert.ok(ticks >= 5, `tick: ${ticks}`);
});

test("run: exit ≠ 0 restituito, binario mancante e timeout rifiutati con messaggi leggibili", async () => {
  assert.equal((await run("sh", ["-c", "exit 3"], { timeoutMs: 5000 })).code, 3);
  await assert.rejects(run("comando-che-non-esiste-xyz", [], { timeoutMs: 5000 }), /comando-che-non-esiste-xyz non installato/);
  await assert.rejects(run("sleep", ["5"], { timeoutMs: 100 }), /tempo scaduto/);
  await assert.rejects(runOk("sh", ["-c", "echo boom >&2; exit 3"], { timeoutMs: 5000 }), /sh exit 3: boom/);
});

test("run: stdout UTF-8 integro", async () => {
  const r = await run("node", ["-e", "process.stdout.write('è'.repeat(100000))"], { timeoutMs: 10000 });
  assert.equal(r.stdout, "è".repeat(100000));
});

test("venvBin: binario della .venv se c'è, altrimenti il nome", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-venv-"));
  assert.equal(venvBin("yt-dlp", root), "yt-dlp");
  fs.mkdirSync(path.join(root, ".venv/bin"), { recursive: true });
  fs.writeFileSync(path.join(root, ".venv/bin/yt-dlp"), "");
  assert.equal(venvBin("yt-dlp", root), path.join(root, ".venv/bin/yt-dlp"));
});
