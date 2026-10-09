import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

test("domains.areas malformato: l'app si apre, le righe rotte restano com'erano, niente riconversione", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-hubbad-"));
  const file = path.join(dir, "rotto.db");
  const old = new Database(file);
  old.exec(`CREATE TABLE domains (id integer PRIMARY KEY AUTOINCREMENT, name text NOT NULL, description text,
    parent_id integer, kind text DEFAULT 'course' NOT NULL, path text, areas text DEFAULT '[]' NOT NULL, created_at integer)`);
  const ins = old.prepare("INSERT INTO domains (name, areas) VALUES (?, ?)");
  ins.run("vuota", "");
  ins.run("null", "null");
  ins.run("scalare", '"Web"');
  ins.run("numeri", "[3, \"Arte\"]");
  old.close();

  process.env.DB_PATH = file;
  const { sqlite, ensureHubSchema } = await import("@/lib/db");
  const get = (n: string) => (sqlite.prepare("SELECT areas FROM domains WHERE name = ?").get(n) as { areas: string }).areas;
  assert.equal(get("vuota"), "");
  assert.equal(get("null"), "null");
  assert.equal(get("scalare"), '"Web"');
  assert.equal(get("numeri"), '["arte"]'); // i non-stringa spariscono, il nome diventa slug
  const n = () => (sqlite.prepare("SELECT count(*) AS n FROM areas").get() as { n: number }).n;
  assert.equal(n(), 1);
  ensureHubSchema();
  assert.equal(n(), 1);
});
