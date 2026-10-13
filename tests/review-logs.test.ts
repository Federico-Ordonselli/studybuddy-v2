import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import { verdictJson, withJudge } from "./helpers/judge";

const { sqlite } = await useTempDb();
const { reviewCard, deleteCard, overrideLastReview } = await import("@/lib/tutor/cards");
const { PROMPT_VERSION } = await import("@/lib/tutor/grade");
const { models } = await import("@/lib/config");

sqlite.exec(`INSERT INTO domains (id, name) VALUES (1, 'Corso');
  INSERT INTO cards (id, domain_id, question, answer, ease, interval_days, repetitions, due_at)
  VALUES (1, 1, 'Cos''è HEAD?', 'Il puntatore al commit corrente', 2.5, 6, 2, 0),
         (2, 1, 'Cosa fa git stash?', 'Mette da parte le modifiche', 2.5, 0, 0, 0);`);

type Log = Record<string, unknown>;
const logs = (cardId: number) => sqlite.prepare("SELECT * FROM review_logs WHERE card_id = ? ORDER BY id").all(cardId) as Log[];

test("una review scrive esattamente una riga di log, nella stessa operazione dell'update", async () => {
  const judge = verdictJson("correct", { feedback: "Manca il dettaglio sul detached HEAD." });
  const result = await withJudge([judge], () => reviewCard(1, "punta al commit attuale", 1));
  assert.ok(result);
  const rows = logs(1);
  assert.equal(rows.length, 1);
  const [log] = rows;
  assert.equal(log.answer, "punta al commit attuale");
  assert.equal(log.legacy_quality, null);
  assert.equal(log.rating, 3);          // correct → Good
  assert.equal(log.confidence, null);   // nessuna fiducia indicata
  assert.equal(JSON.parse(String(log.grader_rationale)).feedback, "Manca il dettaglio sul detached HEAD.");
  assert.equal(log.grader_model, models.grade.model);
  assert.equal(log.prompt_version, PROMPT_VERSION);
  assert.equal(log.overridden, 0);
  // stato prima: carta SM-2 (intervallo 6, ease 2.5) convertita al volo in Review
  const before = JSON.parse(String(log.state_before));
  assert.equal(before.fsrsState, 2);
  assert.equal(before.stability, 6);
  assert.equal(before.difficulty, 5);
  const card = sqlite.prepare("SELECT fsrs_state, stability, difficulty, scheduled_days, due_at FROM cards WHERE id = 1").get() as Record<string, number>;
  assert.equal(log.stability, card.stability);
  assert.equal(log.difficulty, card.difficulty);
  assert.equal(log.scheduled_days, card.scheduled_days);
  assert.equal(card.due_at * 1000, result.dueAt);
  assert.equal(result.rating, 3);
  assert.ok(Math.abs(Number(log.reviewed_at) - Date.now() / 1000) < 60);
});

test("un giudizio non valido (anche al retry) non produce righe né cambia la carta", async () => {
  await assert.rejects(withJudge(["non è JSON", JSON.stringify({ quality: 9 })], () => reviewCard(2, "boh", 1)));
  assert.equal(logs(2).length, 0);
  const card = sqlite.prepare("SELECT fsrs_state, due_at FROM cards WHERE id = 2").get();
  assert.deepEqual(card, { fsrs_state: null, due_at: 0 });
});

test("i log seguono la carta: eliminarla elimina il suo storico", async () => {
  const judge = verdictJson("wrong", { feedback: "No." });
  await withJudge([judge], () => reviewCard(2, "non so", 1));
  assert.equal(logs(2).length, 1);
  deleteCard(2);
  assert.equal(logs(2).length, 0);
  assert.equal(logs(1).length, 1);
});

test("un correct con errori elencati non va a Good", async () => {
  sqlite.exec(`INSERT INTO cards (id, domain_id, question, answer, due_at) VALUES (3, 1, 'Cosa fa git add -p?', 'Aggiunge pezzi di modifiche in modo interattivo', 0);`);
  const result = await withJudge([verdictJson("correct", { errors: ["dice che fa il commit"] })], () => reviewCard(3, "aggiunge a pezzi e fa il commit", 1));
  assert.equal(result?.grade.verdict, "partial");
  assert.equal(logs(3)[0].rating, 2); // Hard
});

test("la fiducia finisce nel log e decide Good/Easy su una risposta corretta", async () => {
  sqlite.exec(`INSERT INTO cards (id, domain_id, question, answer, due_at) VALUES (4, 1, 'Cos''è un branch?', 'Un puntatore mobile a un commit', 0),
    (5, 1, 'Cos''è un tag?', 'Un puntatore fisso a un commit', 0);`);
  const sure = await withJudge([verdictJson("correct")], () => reviewCard(4, "un puntatore mobile", 1, 3));
  assert.equal(sure?.rating, 4); // Easy
  assert.equal(sure?.confidence, 3);
  assert.equal(logs(4)[0].confidence, 3);
  const unsure = await withJudge([verdictJson("correct")], () => reviewCard(5, "un puntatore fisso", 1, 1));
  assert.equal(unsure?.rating, 3); // Good
  assert.equal(logs(5)[0].confidence, 1);
});

test("la correzione del voto conserva la fiducia dichiarata", () => {
  overrideLastReview(4, 2, 1);
  const [orig, manual] = logs(4);
  assert.equal(orig.overridden, 1);
  assert.equal(manual.grader_model, "manual");
  assert.equal(manual.confidence, 3);
});
