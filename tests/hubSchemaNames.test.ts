import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-hubn-"));
const file = path.join(dir, "vecchio.db");

const old = new Database(file);
old.exec(`
  CREATE TABLE domains (id integer PRIMARY KEY AUTOINCREMENT, name text NOT NULL, description text,
    parent_id integer, kind text DEFAULT 'course' NOT NULL, path text, areas text DEFAULT '[]' NOT NULL, created_at integer);
  CREATE TABLE ingested_files (domain_id integer NOT NULL, source text NOT NULL, file_hash text NOT NULL, PRIMARY KEY (domain_id, source));
`);
const ins = old.prepare("INSERT INTO domains (name, kind, areas) VALUES (?, 'course', ?)");
ins.run("a", JSON.stringify(["data science"]));
ins.run("b", JSON.stringify(["data science"]));
ins.run("c", JSON.stringify(["Data Science"]));
ins.run("d", JSON.stringify([" Web "]));
ins.run("e", JSON.stringify(["Web"]));
old.close();
process.env.DB_PATH = file;

test("conversione: vince la variante più usata; spazi/maiuscole = stesso dominio", async () => {
  const { sqlite } = await import("@/lib/db");
  const rows = sqlite.prepare("SELECT slug, name FROM areas ORDER BY position").all() as { slug: string; name: string }[];
  assert.deepEqual(rows, [{ slug: "data-science", name: "data science" }, { slug: "web", name: "Web" }]);
  const of = (n: string) => JSON.parse((sqlite.prepare("SELECT areas FROM domains WHERE name = ?").get(n) as { areas: string }).areas);
  assert.deepEqual(of("c"), ["data-science"]);
  assert.deepEqual(of("d"), ["web"]);
  assert.deepEqual(of("e"), ["web"]);
});
