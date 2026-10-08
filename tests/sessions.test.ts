import { test, before } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import type { Citation } from "@/lib/rag/pipeline";

let S: typeof import("@/lib/tutor/sessions");
let sqlite: import("better-sqlite3").Database;

before(async () => {
  ({ sqlite } = await useTempDb());
  S = await import("@/lib/tutor/sessions");
});

const cit: Citation = {
  n: 1, documentId: 7, kind: "transcript", label: "Modulo › lezione.srt", snippet: "…",
  startSec: 42, video: { path: "/tmp/lezione.mp4", startSec: 42 },
};

test("appendTurn: le citazioni restano sul messaggio dell'assistente e sopravvivono alla ripresa", async () => {
  const s = await S.getOrCreateSession("socratic");
  const history = S.appendTurn(s.state?.history ?? [], "domanda", "risposta [1]", [cit]);
  S.saveState(s.id, { history });
  const loaded = S.loadSession(s.id)!;
  assert.deepEqual(loaded.state?.history, [
    { role: "user", content: "domanda" },
    { role: "assistant", content: "risposta [1]", citations: [cit] },
  ]);
});

test("forModel: al modello arrivano solo role e content", () => {
  const history = S.appendTurn([], "domanda", "risposta", [cit]);
  assert.deepEqual(S.forModel(history), [
    { role: "user", content: "domanda" },
    { role: "assistant", content: "risposta" },
  ]);
});

test("sessione salvata prima delle citazioni: si carica e si continua", () => {
  const { id } = sqlite.prepare("INSERT INTO sessions (mode, state) VALUES ('socratic', ?) RETURNING id")
    .get(JSON.stringify({ history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] })) as { id: number };
  const old = S.loadSession(id)!.state!.history;
  const next = S.appendTurn(old, "c", "d", []);
  assert.equal(next.length, 4);
  assert.deepEqual(S.forModel(next).map((m) => m.content), ["a", "b", "c", "d"]);
});
