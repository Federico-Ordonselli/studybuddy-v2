import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

const { sqlite } = await useTempDb();
const { schedule, convertSm2, fsrsFields, ratingFromQuality, Rating, State } = await import("@/lib/tutor/scheduler");
const { reviewCard, overrideLastReview } = await import("@/lib/tutor/cards");
const { convertCardsToFsrs } = await import("@/lib/db");

const DAY = 86_400_000;
const now = new Date("2026-10-12T10:00:00Z");
const sm2Row = (o: Partial<{ ease: number; intervalDays: number; repetitions: number; dueAt: Date | null }> = {}) => ({
  ease: 2.5, intervalDays: 0, repetitions: 0, dueAt: now,
  fsrsState: null, stability: null, difficulty: null, reps: null, lapses: null,
  learningSteps: null, scheduledDays: null, lastReview: null, ...o,
});

/** Ollama finto: restituisce `replies` in ordine, uno per chiamata. */
async function withJudge<T>(replies: string[], fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async () => Response.json({ message: { content: replies[Math.min(i++, replies.length - 1)] } });
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const judge = (quality: number) => JSON.stringify({ quality, correct: quality >= 3, feedback: "ok" });

test("voto 0–5 → rating FSRS (temporaneo, fino alla Fase 2)", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(ratingFromQuality),
    [Rating.Again, Rating.Again, Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]);
});

test("carta nuova + Good → scadenza nel futuro, reps = 1", () => {
  const { update } = schedule(sm2Row(), Rating.Good, now);
  assert.ok(update.dueAt > now);
  assert.equal(update.reps, 1);
  assert.equal(update.lastReview?.getTime(), now.getTime());
});

test("carta in Review + Again → lapses + 1, stato Relearning", () => {
  const review = sm2Row({ repetitions: 3, intervalDays: 10, dueAt: now });
  const before = fsrsFields(review);
  assert.equal(before.fsrsState, State.Review);
  const { update } = schedule(review, Rating.Again, now);
  assert.equal(update.lapses, before.lapses + 1);
  assert.equal(update.fsrsState, State.Relearning);
});

test("conversione SM-2 → FSRS secondo la tabella 1.4", () => {
  const fresh = convertSm2(sm2Row(), now);
  assert.equal(fresh.fsrsState, State.New);
  assert.equal(fresh.dueAt.getTime(), now.getTime());
  assert.equal(fresh.reps, 0);

  const seen = convertSm2(sm2Row({ ease: 1.5, intervalDays: 6, repetitions: 2 }), now);
  assert.equal(seen.fsrsState, State.Review);
  assert.equal(seen.stability, 6);
  assert.equal(seen.difficulty, 9);                       // 5 + (2.5 − 1.5) × 4
  assert.equal(seen.lastReview?.getTime(), now.getTime() - 6 * DAY);
  assert.equal(seen.dueAt.getTime(), now.getTime());      // la scadenza non cambia
  assert.equal(seen.reps, 2);
  assert.equal(convertSm2(sm2Row({ ease: 3.5, intervalDays: 0, repetitions: 1 }), now).difficulty, 1);
  assert.equal(convertSm2(sm2Row({ ease: 1.3, intervalDays: 1, repetitions: 0 }), now).fsrsState, State.Review); // sbagliata almeno una volta
});

test("conversione sul DB: solo le righe senza stato FSRS, idempotente", () => {
  const due = Math.floor(now.getTime() / 1000);
  sqlite.exec(`INSERT INTO domains (id, name) VALUES (1, 'Corso');
    INSERT INTO cards (id, domain_id, question, answer, ease, interval_days, repetitions, due_at)
    VALUES (10, 1, 'D1', 'R1', 2.5, 0, 0, ${due}), (11, 1, 'D2', 'R2', 2.0, 15, 4, ${due}),
           (12, 1, 'D3', 'R3', 2.5, 3, 1, NULL);`);
  const read = () => sqlite.prepare(`SELECT id, fsrs_state, stability, difficulty, reps, lapses, learning_steps,
    scheduled_days, last_review, due_at FROM cards WHERE id IN (10, 11, 12) ORDER BY id`).all();
  assert.equal(convertCardsToFsrs(), 3);
  const first = read();
  assert.deepEqual(first.map((r) => (r as { fsrs_state: number }).fsrs_state), [State.New, State.Review, State.Review]);
  assert.ok((first[2] as { due_at: number | null }).due_at != null); // scadenza assente → adesso
  assert.equal(convertCardsToFsrs(), 0);
  assert.deepEqual(read(), first);
  sqlite.exec("DELETE FROM cards WHERE id IN (10, 11, 12)");
});

test("override → stesso stato di una review fatta subito con il rating giusto", async () => {
  sqlite.exec(`INSERT OR IGNORE INTO domains (id, name) VALUES (1, 'Corso');
    INSERT INTO cards (id, domain_id, question, answer, ease, interval_days, repetitions, due_at)
    VALUES (20, 1, 'Cos''è HEAD?', 'Il commit corrente', 2.3, 8, 3, 0);`);
  const row = () => sqlite.prepare(`SELECT fsrs_state, stability, difficulty, reps, lapses, learning_steps,
    scheduled_days, last_review, due_at FROM cards WHERE id = 20`).get() as Record<string, number>;
  const card0 = sm2Row({ ease: 2.3, intervalDays: 8, repetitions: 3, dueAt: new Date(0) });

  await withJudge([judge(1)], () => reviewCard(20, "non ricordo", 1));
  const [judged] = sqlite.prepare("SELECT * FROM review_logs WHERE card_id = 20").all() as Record<string, number>[];
  assert.equal(judged.rating, Rating.Again);

  const res = overrideLastReview(20, Rating.Good, 1);
  assert.equal(res.rating, Rating.Good);
  const reviewedAt = new Date(judged.reviewed_at * 1000);
  const { update } = schedule(card0, Rating.Good, reviewedAt);
  const sec = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : null);
  assert.deepEqual(row(), {
    fsrs_state: update.fsrsState, stability: update.stability, difficulty: update.difficulty, reps: update.reps,
    lapses: update.lapses, learning_steps: update.learningSteps, scheduled_days: update.scheduledDays,
    last_review: sec(update.lastReview), due_at: sec(update.dueAt),
  });

  const logs = sqlite.prepare("SELECT * FROM review_logs WHERE card_id = 20 ORDER BY id").all() as Record<string, unknown>[];
  assert.equal(logs.length, 2);
  assert.equal(logs[0].overridden, 1);
  assert.equal(logs[1].overridden, 0);
  assert.equal(logs[1].rating, Rating.Good);
  assert.equal(logs[1].grader_model, "manual");
  assert.equal(logs[1].answer, "non ricordo");
  assert.equal(logs[1].reviewed_at, logs[0].reviewed_at);
  assert.equal(logs[1].state_before, logs[0].state_before);

  // si può correggere di nuovo: riparte dallo stesso stato di partenza
  overrideLastReview(20, Rating.Easy, 1);
  const again = schedule(card0, Rating.Easy, reviewedAt).update;
  assert.equal(row().stability, again.stability);
  const flags = sqlite.prepare("SELECT overridden FROM review_logs WHERE card_id = 20 ORDER BY id").all();
  assert.deepEqual(flags, [{ overridden: 1 }, { overridden: 1 }, { overridden: 0 }]);
});

test("override: niente da correggere → 404, review di prima di FSRS → 409, rating non valido → 400", () => {
  sqlite.exec(`INSERT INTO cards (id, domain_id, question, answer) VALUES (30, 1, 'D', 'R'), (31, 1, 'D2', 'R2');
    INSERT INTO review_logs (card_id, reviewed_at, answer, state_before)
    VALUES (31, 0, 'x', '{"ease":2.5,"intervalDays":6,"repetitions":2}');`);
  assert.throws(() => overrideLastReview(30, Rating.Good), (e: { status?: number }) => e.status === 404);
  assert.throws(() => overrideLastReview(31, Rating.Good), (e: { status?: number }) => e.status === 409);
  assert.throws(() => overrideLastReview(31, 7 as never), (e: { status?: number }) => e.status === 400);
  assert.throws(() => overrideLastReview(999, Rating.Good), (e: { status?: number }) => e.status === 404);
});
