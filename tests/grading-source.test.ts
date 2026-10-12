import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import { verdictJson, withJudge } from "./helpers/judge";

const { sqlite } = await useTempDb();
const { gradingSource, SOURCE_CHARS } = await import("@/lib/tutor/gradingSource");
const { reviewCard } = await import("@/lib/tutor/cards");
const { gradeTurn } = await import("@/lib/tutor/session");

const long = "HEAD punta al commit corrente. ".repeat(100);
sqlite.exec(`INSERT INTO domains (id, name) VALUES (1, 'Corso');
  INSERT INTO documents (id, domain_id, title, source, kind, meta) VALUES (1, 1, 'Lezione', '/corso/m1/lezione.en.srt', 'transcript', '{"crumbs":["Corso","Modulo 1"]}');
  INSERT INTO chunks (id, document_id, ordinal, content, meta) VALUES (7, 1, 0, '${long}', '{"startSec":125,"endSec":140}');
  INSERT INTO cards (id, domain_id, question, answer, source_chunk_id, due_at) VALUES (1, 1, 'Cos''è HEAD?', 'Il commit corrente', 7, 0),
    (2, 1, 'Cos''è git stash?', 'Mette da parte le modifiche', NULL, 0);`);

test("carta con sorgente: testo tagliato a 1500 caratteri e citazione del chunk", async () => {
  const s = await gradingSource("Cos'è HEAD?", 7, 1);
  assert.ok(s);
  assert.equal(s.text.length, SOURCE_CHARS);
  assert.equal(s.citation.documentId, 1);
  assert.equal(s.citation.kind, "transcript");
  assert.equal(s.citation.startSec, 125);
  assert.match(s.citation.label, /Corso › Modulo 1 › lezione\.en\.srt/);
});

test("id inesistente e retrieve che fallisce (embedding giù): nessuna sorgente, nessun errore", async () => {
  assert.equal(await withJudge([], () => gradingSource("Cos'è HEAD?", 999, 1)), null);
  assert.equal(await withJudge([], () => gradingSource("Cos'è git stash?", null, 1)), null);
});

test("reviewCard passa la sorgente al giudice e la restituisce", async () => {
  const bodies: Record<string, unknown>[] = [];
  const r = await withJudge([verdictJson("correct")], () => reviewCard(1, "il commit attuale", 1), bodies);
  assert.equal(r?.source?.documentId, 1);
  const user = (bodies[0] as { messages: { content: string }[] }).messages.at(-1)!.content;
  assert.match(user, /Passaggio sorgente/);
});

test("reviewCard senza sorgente trovabile giudica lo stesso", async () => {
  const r = await withJudge([verdictJson("wrong")], () => reviewCard(2, "non so", 1));
  assert.equal(r?.grade.verdict, "wrong");
  assert.equal(r?.source, undefined);
});

test("gradeTurn mcq non chiama il modello", async () => {
  const bodies: Record<string, unknown>[] = [];
  const q = { type: "mcq" as const, question: "Scegli", answer: "A", options: ["A", "B"], rationale: "" };
  const t = await withJudge([], () => gradeTurn(q, "B", 1), bodies);
  assert.equal(t.grade?.verdict, "wrong");
  assert.equal(bodies.length, 0);
});

test("gradeTurn aperta: giudizio con fallback retrieve (qui giù) e reply = feedback", async () => {
  const q = { type: "open" as const, question: "Cos'è HEAD?", answer: "Il commit corrente", rationale: "" };
  const t = await withJudge([verdictJson("partial", { feedback: "Quasi." })], () => gradeTurn(q, "un commit", 1));
  assert.equal(t.grade?.verdict, "partial");
  assert.equal(t.reply, "Quasi.");
});
