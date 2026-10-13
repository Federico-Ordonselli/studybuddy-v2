import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "@/lib/db/schemaSql";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-f5-"));
const file = path.join(dir, "pre-f5.db");

// DB «di ieri»: tutto lo schema tranne map_exercises.
const old = new Database(file);
for (const s of SCHEMA_SQL.filter((s) => !s.includes("`map_exercises`"))) old.exec(s);
old.close();
process.env.DB_PATH = file;

test("DB esistente: map_exercises creata all'avvio, chiave (map_id, level_key), idempotente", async () => {
  const { sqlite, ensureHubSchema } = await import("@/lib/db");
  const cols = (sqlite.prepare("PRAGMA table_info(map_exercises)").all() as { name: string }[]).map((c) => c.name);
  assert.deepEqual(cols, ["map_id", "level_key", "focus_question", "proposal", "last_check", "created_at", "checked_at", "revealed_at", "completed_at"]);
  const ins = sqlite.prepare("INSERT INTO map_exercises (map_id, level_key, focus_question, proposal, created_at) VALUES ('m', 'root', 'D?', '{}', 1)");
  ins.run();
  assert.throws(() => ins.run(), /UNIQUE|PRIMARY KEY/);
  ensureHubSchema();
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'map_exercises'").get() as { n: number }).n, 1);
});
