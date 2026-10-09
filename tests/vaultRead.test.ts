import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeFakeVault, fingerprint } from "./helpers/vault";
import { loadVaultDomains, readVault, snapshotVaultDb, vaultDbPath } from "@/lib/vaultImport/read";

const v = makeFakeVault({
  domains: [{ slug: "alfa", name: "Alfa", symbol: "✦", tagline: "cose" }, { slug: "beta", name: "Beta" }],
  notes: [{ content: "prima", domain: "alfa", createdAt: 1700000000 }, { content: "seconda", domain: null, createdAt: 1700000500 }],
  combos: 2,
  tips: 1,
  settings: { groq_api_key: "gsk_SEGRETO_finto", ollama_model: "m" },
});
after(() => v.close());
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sb-snap-"));

test("i dati del vault finto stanno solo nel WAL: il solo .db non ha tabelle", () => {
  const d = tmp();
  fs.copyFileSync(vaultDbPath(v.dir), path.join(d, "vault.db"));
  assert.throws(() => readVault(path.join(d, "vault.db")), /nessuna tabella notes/);
});

test("snapshot + readVault: note, sf6 e solo le CHIAVI delle impostazioni", () => {
  const data = readVault(snapshotVaultDb(v.dir, tmp()));
  assert.deepEqual(data.notes, [
    { id: 1, content: "prima", domain: "alfa", createdAt: 1700000000 },
    { id: 2, content: "seconda", domain: null, createdAt: 1700000500 },
  ]);
  assert.equal(data.combos.length, 2);
  assert.deepEqual(Object.keys(data.combos[0]),
    ["id", "character_slug", "notation", "situation", "status", "damage", "drive_cost", "notes", "created_at"]);
  assert.equal(data.combos[1].damage, 1001);
  assert.equal(data.tips.length, 1);
  assert.deepEqual(data.settingKeys, ["groq_api_key", "ollama_model"]);
  assert.ok(!JSON.stringify(data).includes("gsk_SEGRETO"));
});

test("l'originale non cambia (né .db, né -wal, né -shm)", () => {
  const before = fingerprint(v.files);
  readVault(snapshotVaultDb(v.dir, tmp()));
  assert.deepEqual(fingerprint(v.files), before);
});

test("vault senza tabelle sf6: combo e tip vuoti", () => {
  const w = makeFakeVault({ domains: [{ slug: "alfa", name: "Alfa" }], notes: [{ content: "x", domain: null }], sf6: false });
  try {
    const data = readVault(snapshotVaultDb(w.dir, tmp()));
    assert.deepEqual([data.notes.length, data.combos, data.tips], [1, [], []]);
  } finally { w.close(); }
});

test("snapshot di una cartella senza vault: errore leggibile", () => {
  assert.throws(() => snapshotVaultDb(tmp(), tmp()), /non trovo .*vault\.db/);
});

test("loadVaultDomains: legge DOMAINS dal codice del vault", async () => {
  assert.deepEqual(await loadVaultDomains(v.dir), [
    { slug: "alfa", name: "Alfa", tagline: "cose", symbol: "✦" },
    { slug: "beta", name: "Beta", tagline: "", symbol: "·" },
  ]);
  await assert.rejects(loadVaultDomains(tmp()), /non trovo .*domains\.ts/);
});
