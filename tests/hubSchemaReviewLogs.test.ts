import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "@/lib/db/schemaSql";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-f0-"));
const file = path.join(dir, "pre-f0.db");

// DB «di ieri»: tutto lo schema tranne review_logs, con una carta già ripassata.
const old = new Database(file);
for (const s of SCHEMA_SQL.filter((s) => !s.includes("`review_logs`"))) old.exec(s);
old.exec("INSERT INTO cards (id, question, answer, repetitions) VALUES (7, 'D', 'R', 3)");
old.close();
process.env.DB_PATH = file;

test("DB esistente: review_logs creata all'avvio, carte intatte, idempotente", async () => {
  const { sqlite, ensureHubSchema } = await import("@/lib/db");
  const cols = (sqlite.prepare("PRAGMA table_info(review_logs)").all() as { name: string }[]).map((c) => c.name);
  assert.deepEqual(cols, [
    "id", "card_id", "reviewed_at", "rating", "legacy_quality", "confidence", "answer", "grader_rationale",
    "state_before", "stability", "difficulty", "scheduled_days", "grader_model", "prompt_version", "overridden",
  ]);
  assert.equal((sqlite.prepare("SELECT repetitions FROM cards WHERE id = 7").get() as { repetitions: number }).repetitions, 3);
  ensureHubSchema();
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'review_logs'").get() as { n: number }).n, 1);
});
