import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

test("il DB temporaneo ha le tabelle dello schema", async () => {
  const { sqlite } = await useTempDb();
  const names = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  for (const t of ["domains", "documents", "chunks", "cards", "sessions", "concept_maps"]) {
    assert.ok(names.includes(t), `manca la tabella ${t}`);
  }
});
