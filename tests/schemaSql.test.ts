import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { generateSchemaSql, renderModule } from "../scripts/schema-sql";

const tables = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

test("schemaSql.ts è allineato a schema.ts (altrimenti: npm run db:schema)", async () => {
  const committed = fs.readFileSync(path.resolve("src/lib/db/schemaSql.ts"), "utf8");
  assert.equal(committed, renderModule(await generateSchemaSql()));
});

test("DB nuovo: initSchema crea le tabelle; una seconda chiamata non fa nulla", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-schema-"));
  process.env.DB_PATH = path.join(dir, "nuovo.db");
  const { sqlite, initSchema } = await import("@/lib/db");
  for (const t of ["domains", "areas", "documents", "chunks", "cards", "sessions", "concept_maps", "ingested_files", "notes"]) {
    assert.ok(tables(sqlite).includes(t), t);
  }
  sqlite.prepare("INSERT INTO domains (name, kind) VALUES ('x', 'course')").run();
  initSchema(); // idempotente
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM domains").get() as { n: number }).n, 1);
});
