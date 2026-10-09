import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "@/lib/db/schemaSql";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-f4-"));
const file = path.join(dir, "pre-f4.db");

// DB «di ieri»: tutto lo schema di oggi tranne le tabelle sf6, con una nota dentro.
const old = new Database(file);
for (const s of SCHEMA_SQL.filter((s) => !s.includes("`sf6_"))) old.exec(s);
old.prepare("INSERT INTO notes (content, created_at) VALUES ('nota', 1700000000)").run();
old.close();
process.env.DB_PATH = file;

const cols = (db: Database.Database, t: string) =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

test("DB pre-F4: sf6_combos e sf6_tips create con le colonne del vault, dati esistenti intatti", async () => {
  const { sqlite, ensureHubSchema } = await import("@/lib/db");
  assert.deepEqual(cols(sqlite, "sf6_combos"),
    ["id", "character_slug", "notation", "situation", "status", "damage", "drive_cost", "notes", "created_at"]);
  assert.deepEqual(cols(sqlite, "sf6_tips"),
    ["id", "character_slug", "type", "title", "content", "notation", "source_title", "source_url", "created_at"]);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM notes").get() as { n: number }).n, 1);
  ensureHubSchema(); // idempotente
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'sf6_%' AND type = 'table'").get() as { n: number }).n, 2);
});
