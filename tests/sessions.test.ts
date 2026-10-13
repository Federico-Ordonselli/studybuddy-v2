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

test("saveState aggiorna sessions.updated_at (per gli «ultimi corsi studiati» della home)", async () => {
  const s = await S.getOrCreateSession("socratic");
  sqlite.prepare("UPDATE sessions SET updated_at = 1 WHERE id = ?").run(s.id);
  S.saveState(s.id, { history: [] });
  const { updated_at } = sqlite.prepare("SELECT updated_at FROM sessions WHERE id = ?").get(s.id) as { updated_at: number };
  assert.ok(updated_at > 1_700_000_000, `updated_at = ${updated_at}`);
});

test("problemStatement: l'enunciato è il messaggio `turns - 1` posizioni indietro; spiegazioni precedenti escluse", () => {
  const u = (content: string) => ({ role: "user" as const, content });
  const a = (content: string) => ({ role: "assistant" as const, content });
  assert.equal(S.problemStatement([], 1), undefined);
  assert.equal(S.problemStatement([u("spiegami X"), a("ok")], 1), undefined);
  const h = [u("cos'è X?"), a("spiegazione"), u("Esercizio: inverti una stringa"), a("indizio"), u("provo con split"), a("indizio 2")];
  assert.equal(S.problemStatement(h, 3), "Esercizio: inverti una stringa");
  assert.equal(S.problemStatement(h, 2), "provo con split");
});

test("markNewProblem: il marker resta in cronologia (ripresa) ma non arriva al modello né all'enunciato", () => {
  const h = S.markNewProblem(S.appendTurn([], "Esercizio: inverti una stringa", "indizio"));
  assert.deepEqual(h.at(-1), { role: "assistant", content: S.NEW_PROBLEM_MESSAGE, tag: S.NEW_PROBLEM_TAG });
  assert.equal(S.markNewProblem(h), h, "niente marker doppi");
  assert.deepEqual(S.markNewProblem([]), [], "niente marker su una sessione vuota");
  const next = S.appendTurn(h, "Esercizio: somma un array", "indizio");
  assert.deepEqual(S.forModel(next).map((m) => m.content), ["Esercizio: inverti una stringa", "indizio", "Esercizio: somma un array", "indizio"]);
  assert.equal(S.problemStatement(next, 2), "Esercizio: somma un array", "secondo messaggio sul problema");
});
