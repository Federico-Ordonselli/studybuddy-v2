import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-f3-"));
const file = path.join(dir, "pre-f3.db");

// DB «di ieri»: tutto lo schema F2, ma sessions senza updated_at e nessuna tabella notes.
const old = new Database(file);
old.exec(`
  CREATE TABLE domains (id integer PRIMARY KEY AUTOINCREMENT, name text NOT NULL, description text,
    parent_id integer, kind text DEFAULT 'course' NOT NULL, path text, areas text DEFAULT '[]' NOT NULL, created_at integer);
  CREATE TABLE sessions (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, domain_id integer, mode text DEFAULT 'socratic' NOT NULL,
    state text, created_at integer); -- come in schemaSql.ts di oggi, senza updated_at
  INSERT INTO domains (name, kind) VALUES ('corso', 'course');
  INSERT INTO sessions (domain_id, mode, created_at) VALUES (1, 'socratic', 1700000000);
`);
old.close();
process.env.DB_PATH = file;

test("DB pre-F3: notes creata e sessions.updated_at aggiunta, righe esistenti intatte", async () => {
  const { sqlite } = await import("@/lib/db");
  assert.ok(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'").get());
  const cols = (sqlite.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("updated_at"));
  const s = sqlite.prepare("SELECT created_at, updated_at FROM sessions").get() as { created_at: number; updated_at: number | null };
  assert.equal(s.created_at, 1700000000);
  assert.equal(s.updated_at, null);
});

test("idempotente: una seconda chiamata non cambia niente", async () => {
  const { sqlite, ensureHubSchema } = await import("@/lib/db");
  const snap = () => JSON.stringify(sqlite.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all());
  const before = snap();
  ensureHubSchema();
  assert.equal(snap(), before);
});

test("notes e sessions hanno le stesse colonne di un DB nuovo", async () => {
  const { sqlite } = await import("@/lib/db");
  const { SCHEMA_SQL } = await import("@/lib/db/schemaSql");
  const fresh = new Database(":memory:");
  for (const s of SCHEMA_SQL) fresh.exec(s);
  const cols = (db: Database.Database, t: string) => JSON.stringify(db.prepare(`PRAGMA table_info(${t})`).all());
  assert.equal(cols(sqlite, "notes"), cols(fresh, "notes"));
  assert.equal(cols(sqlite, "sessions"), cols(fresh, "sessions"));
});
