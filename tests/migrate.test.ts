import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

test("DB esistente senza aree/ingested_files: aggiornato all'apertura, idempotente", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-migrate-"));
  const file = path.join(dir, "vecchio.db");
  const old = new Database(file);
  old.exec(`
    CREATE TABLE domains (id integer PRIMARY KEY AUTOINCREMENT, name text NOT NULL, description text,
      parent_id integer, kind text DEFAULT 'course' NOT NULL, path text, created_at integer);
    CREATE TABLE documents (id integer PRIMARY KEY AUTOINCREMENT, domain_id integer, title text NOT NULL);
    CREATE TABLE cards (id integer PRIMARY KEY AUTOINCREMENT, domain_id integer, due_at integer);
    INSERT INTO domains (name, kind, path) VALUES ('Vecchio corso', 'course', '/x/vecchio');
  `);
  old.close();

  process.env.DB_PATH = file;
  const { sqlite, ensureLibrarySchema } = await import("@/lib/db");
  const L = await import("@/lib/library");
  assert.deepEqual(L.getLibrary().loose.map((c) => [c.name, c.areas]), [["Vecchio corso", []]]);
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'ingested_files'").get());
  ensureLibrarySchema(); // seconda volta: nessun errore
});
