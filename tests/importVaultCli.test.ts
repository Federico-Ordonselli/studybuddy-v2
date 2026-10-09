import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "@/lib/db/schemaSql";
import { makeFakeVault, fingerprint, stoppedVaultCopy } from "./helpers/vault";
import { parseArgs } from "../scripts/import-vault";

const v = makeFakeVault({
  domains: [{ slug: "alfa", name: "Alfa", symbol: "✦" }, { slug: "beta", name: "Beta" }, { slug: "gamma", name: "Gamma" }],
  notes: [
    { content: "a1", domain: "alfa" }, { content: "a2", domain: "alfa" },
    { content: "b1", domain: "beta" }, { content: "g1", domain: "gamma" }, { content: "libera", domain: null },
  ],
  combos: 2,
  tips: 1,
  settings: { groq_api_key: "gsk_SEGRETO_finto", ollama_model: "m" },
});
after(() => v.close());
const sv = stoppedVaultCopy(v.dir); // copia di un vault fermo: gli originali non hanno una connessione viva

// DB sorgente di StudyBuddy: schema completo, un corso con un'area ancora come NOME libero
// (la conversione in slug la fa ensureHubSchema() sul file di lavoro, non sul sorgente).
const work = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cli-"));
const from = path.join(work, "sorgente.db");
const src = new Database(from);
src.pragma("journal_mode = WAL");
for (const s of SCHEMA_SQL) src.exec(s);
src.prepare("INSERT INTO domains (name, kind, areas) VALUES ('Corso', 'course', '[\"Alfa\"]')").run();
src.close();
const out = path.join(work, "data");
const target = path.join(out, "studybuddy.db");

const tsx = path.resolve("node_modules/.bin/tsx");
const baseEnv = { ...process.env };
delete baseEnv.DB_PATH; // il --from lo passa il test
const run = (...args: string[]) =>
  spawnSync(tsx, ["scripts/import-vault.ts", "--vault", sv.dir, "--from", from, ...args], { encoding: "utf8", env: baseEnv });
const originals = () => fingerprint([...sv.files, from]);
const leftovers = () => (fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.includes(".partial-")) : []);

test("dry-run: resoconto, niente target, niente file di lavoro, originali intatti, nessun segreto", () => {
  const before = originals();
  const r = run("--target", target, "--skip", "gamma");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /alfa .*agganciato a «Alfa»/);
  assert.match(r.stdout, /beta .*nuovo dominio «Beta»/);
  assert.match(r.stdout, /gamma .*escluso/);
  assert.match(r.stdout, /GROQ_API_KEY/);
  assert.match(r.stdout, /Dry-run/);
  assert.doesNotMatch(r.stdout + r.stderr, /gsk_SEGRETO/);
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(leftovers(), []);
  assert.deepEqual(originals(), before);
});

test("--apply: crea il target con domini, note e sf6; originali intatti", () => {
  const before = originals();
  const r = run("--target", target, "--skip", "gamma", "--apply");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Creato/);
  assert.deepEqual(leftovers(), []);
  assert.deepEqual(originals(), before);
  const db = new Database(target, { readonly: true });
  try {
    const q = (sql: string) => db.prepare(sql).all();
    assert.deepEqual(q("SELECT slug, name, symbol FROM areas ORDER BY position"),
      [{ slug: "alfa", name: "Alfa", symbol: "✦" }, { slug: "beta", name: "Beta", symbol: "·" }]);
    assert.deepEqual(q("SELECT areas FROM domains"), [{ areas: '["alfa"]' }]);
    assert.deepEqual(q("SELECT content, domain FROM notes ORDER BY id"), [
      { content: "a1", domain: "alfa" }, { content: "a2", domain: "alfa" },
      { content: "b1", domain: "beta" }, { content: "g1", domain: null }, { content: "libera", domain: null },
    ]);
    assert.deepEqual(q("SELECT count(*) AS n FROM sf6_combos"), [{ n: 2 }]);
    assert.deepEqual(q("SELECT count(*) AS n FROM sf6_tips"), [{ n: 1 }]);
  } finally {
    db.close();
  }
});

test("target esistente: rifiuta e non lo tocca", () => {
  const before = fingerprint([target]);
  const r = run("--target", target, "--apply");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /esiste già/);
  assert.deepEqual(fingerprint([target]), before);
});

test("piano con errori: exit 1, niente target, niente file di lavoro", () => {
  const other = path.join(out, "altro.db");
  const r = run("--target", other, "--skip", "omega", "--apply");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /--skip omega/);
  assert.equal(fs.existsSync(other), false);
  assert.deepEqual(leftovers(), []);
});

test("parseArgs: --from di default da DB_PATH, argomenti obbligatori e sconosciuti", () => {
  const a = parseArgs(["--vault", "v", "--target", "t.db", "--skip", "x", "--skip", "y"], { DB_PATH: "s.db" });
  assert.deepEqual(a, { vault: path.resolve("v"), target: path.resolve("t.db"), from: path.resolve("s.db"), skip: ["x", "y"], apply: false });
  assert.throws(() => parseArgs(["--target", "t.db"], { DB_PATH: "s.db" }), /Uso:/);
  assert.throws(() => parseArgs(["--vault", "v", "--target", "t.db"], {}), /DB_PATH/);
  assert.throws(() => parseArgs(["--vault", "v", "--target", "t.db", "--boh"], { DB_PATH: "s.db" }), /sconosciuto/);
  assert.throws(() => parseArgs(["--vault", "--target", "t.db"], { DB_PATH: "s.db" }), /vuole un valore/);
});

test("SIGINT: exit 130, niente file di lavoro, niente target, originali intatti", async () => {
  const before = originals();
  // sorgente da ~32 MB: il backup (100 pagine per passo) dura abbastanza da poter interrompere
  // a metà, senza sleep nel codice di produzione. Journal DELETE: niente WAL grosso su tmpfs.
  const big = path.join(work, "grosso.db");
  const bdb = new Database(big);
  for (const sql of SCHEMA_SQL) bdb.exec(sql);
  bdb.exec("CREATE TABLE ballast (b BLOB)");
  const ins = bdb.prepare("INSERT INTO ballast VALUES (zeroblob(1048576))");
  bdb.transaction(() => { for (let i = 0; i < 32; i++) ins.run(); })();
  bdb.close();
  const fresh = path.join(work, "sigint", "nuovo.db");
  const dir = path.dirname(fresh);
  const tmpDirs = () => new Set(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("sb-vault-")));
  const tmpBefore = tmpDirs();
  try {
    // node diretto con il loader tsx: il wrapper `tsx` non inoltra in modo affidabile il segnale al figlio
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/import-vault.ts", "--vault", sv.dir, "--from", big, "--target", fresh], { env: baseEnv, stdio: "ignore" });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) =>
      child.on("exit", (code, signal) => res({ code, signal })));
    const deadline = Date.now() + 15000;
    let seen = false;
    while (Date.now() < deadline && child.exitCode === null) {
      if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.includes(".partial-"))) { seen = true; break; }
      await new Promise((r) => setTimeout(r, 2));
    }
    if (child.exitCode === null) child.kill("SIGINT");
    const { code, signal } = await exited;
    assert.ok(seen, "il file di lavoro non è mai comparso");
    assert.equal(signal, null);
    assert.equal(code, 130);
    assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], []);
    assert.equal(fs.existsSync(fresh), false);
    assert.deepEqual([...tmpDirs()].filter((d) => !tmpBefore.has(d)), []);
    assert.deepEqual(originals(), before);
  } finally {
    for (const f of [big, `${big}-wal`, `${big}-shm`]) fs.rmSync(f, { force: true });
  }
});
