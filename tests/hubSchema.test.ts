import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-hub-"));
const file = path.join(dir, "vecchio.db");

// DB «di ieri»: domains con aree come nomi liberi, nessuna tabella areas.
const old = new Database(file);
old.exec(`
  CREATE TABLE domains (id integer PRIMARY KEY AUTOINCREMENT, name text NOT NULL, description text,
    parent_id integer, kind text DEFAULT 'course' NOT NULL, path text, areas text DEFAULT '[]' NOT NULL, created_at integer);
  CREATE TABLE ingested_files (domain_id integer NOT NULL, source text NOT NULL, file_hash text NOT NULL, PRIMARY KEY (domain_id, source));
`);
const ins = old.prepare("INSERT INTO domains (name, kind, areas) VALUES (?, 'course', ?)");
ins.run("uno", JSON.stringify(["Web", "Società"]));
ins.run("due", JSON.stringify(["web"]));
ins.run("tre", JSON.stringify(["C", "C++"]));
ins.run("quattro", "[]");
old.close();

process.env.DB_PATH = file;

const areasOf = (sqlite: Database.Database, name: string) =>
  JSON.parse((sqlite.prepare("SELECT areas FROM domains WHERE name = ?").get(name) as { areas: string }).areas);

test("conversione: nomi → slug, Web/web uniti, C/C++ separati, accenti tolti", async () => {
  const { sqlite } = await import("@/lib/db");
  const rows = sqlite.prepare("SELECT slug, name, position FROM areas ORDER BY position").all() as { slug: string; name: string; position: number }[];
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r.name]));
  assert.deepEqual(Object.keys(bySlug).sort(), ["c", "c-2", "societa", "web"]);
  assert.equal(bySlug.societa, "Società");
  assert.equal(bySlug.web, "Web");
  assert.deepEqual(rows.map((r) => r.position), [0, 1, 2, 3]);
  assert.deepEqual(areasOf(sqlite, "uno"), ["web", "societa"]);
  assert.deepEqual(areasOf(sqlite, "due"), ["web"]);
  assert.deepEqual(areasOf(sqlite, "tre").sort(), ["c", "c-2"]);
  assert.deepEqual(areasOf(sqlite, "quattro"), []);
});

test("conversione idempotente: una seconda chiamata non cambia niente", async () => {
  const { sqlite, ensureHubSchema } = await import("@/lib/db");
  const snap = () => JSON.stringify([sqlite.prepare("SELECT * FROM areas ORDER BY slug").all(), sqlite.prepare("SELECT id, areas FROM domains ORDER BY id").all()]);
  const before = snap();
  ensureHubSchema();
  assert.equal(snap(), before);
});

test("la tabella creata su un DB esistente ha le stesse colonne di un DB nuovo", async () => {
  const { sqlite } = await import("@/lib/db");
  const { SCHEMA_SQL } = await import("@/lib/db/schemaSql");
  const fresh = new Database(":memory:");
  fresh.exec(SCHEMA_SQL.find((s) => s.startsWith("CREATE TABLE `areas`"))!);
  const cols = (db: Database.Database) => JSON.stringify(db.prepare("PRAGMA table_info(areas)").all());
  assert.equal(cols(sqlite), cols(fresh));
});
