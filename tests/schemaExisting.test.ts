import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

test("DB esistente con dati: initSchema non esegue niente e i dati restano", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-schema-"));
  const file = path.join(dir, "esistente.db");
  const pre = new Database(file);
  // forma minima di un DB reale: domains c'è già (con la colonna areas)
  pre.exec("CREATE TABLE domains (id integer PRIMARY KEY AUTOINCREMENT, name text NOT NULL, description text, parent_id integer, kind text DEFAULT 'course' NOT NULL, path text, areas text DEFAULT '[]' NOT NULL, created_at integer)");
  pre.prepare("INSERT INTO domains (name, kind) VALUES ('mio corso', 'course')").run();
  pre.close();
  process.env.DB_PATH = file;
  const { sqlite } = await import("@/lib/db");
  const names = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
  assert.ok(!names.includes("documents"), "initSchema non deve creare tabelle su un DB che ne ha già");
  assert.equal((sqlite.prepare("SELECT name FROM domains").get() as { name: string }).name, "mio corso");
});
