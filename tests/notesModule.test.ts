import { test, before } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

let N: typeof import("@/lib/notes");
let A: typeof import("@/lib/areas");
before(async () => {
  await useTempDb();
  N = await import("@/lib/notes");
  A = await import("@/lib/areas");
});

test("notesForModule: note dei domini collegati al modulo, più recenti prima, con limite", () => {
  const alfa = A.createArea({ name: "Alfa", module: "sf6" });
  const beta = A.createArea({ name: "Beta" });
  const n1 = N.createNote({ content: "uno", domain: alfa.slug });
  const n2 = N.createNote({ content: "due", domain: alfa.slug });
  N.createNote({ content: "altrove", domain: beta.slug });
  N.createNote({ content: "inbox" });
  const ids = N.notesForModule("sf6").map((n) => n.id);
  assert.deepEqual(ids, [n2.id, n1.id]);
  assert.equal(N.notesForModule("sf6", 1).length, 1);
  assert.deepEqual(N.notesForModule("nessuno"), []);
});
