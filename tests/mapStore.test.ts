import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

const { sqlite } = await useTempDb();
const { saveMap, listMaps, deleteMap } = await import("@/lib/mappe/store");
const { createMapDocument } = await import("@/lib/mappe/modello.js");

sqlite.prepare("INSERT INTO domains (id, name) VALUES (1, 'Corso')").run();

test("listMaps segnala le mappe-esercizio, deleteMap cancella anche le righe dell'esercizio", () => {
  const a = saveMap(1, createMapDocument("Normale"), 0);
  const b = saveMap(1, createMapDocument("Esercizio"), 0);
  sqlite.prepare("INSERT INTO map_exercises (map_id, level_key, focus_question, proposal, created_at) VALUES (?, 'root', 'D?', '{}', 1)").run(b.id);
  const byId = new Map(listMaps(1).map((m) => [m.id, m.exercise]));
  assert.equal(byId.get(a.id), false);
  assert.equal(byId.get(b.id), true);
  deleteMap(b.id);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM map_exercises WHERE map_id = ?").get(b.id) as { n: number }).n, 0);
  assert.deepEqual(listMaps(1).map((m) => m.id), [a.id]);
});
