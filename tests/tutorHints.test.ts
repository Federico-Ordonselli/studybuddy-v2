import { test } from "node:test";
import assert from "node:assert/strict";
import { initialHint, isAttempt, nextHint, resetProblem, afterSolution, canReveal, publicHint } from "@/lib/tutor/hints";

test("isAttempt: codice o una proposta di almeno 8 parole, non domande né richieste di soluzione", () => {
  assert.equal(isAttempt("ho provato con arr.map(x => x * 2) ma esce undefined"), true);
  assert.equal(isAttempt("secondo me bisogna salvare lo stato prima del render e poi aggiornarlo"), true);
  assert.equal(isAttempt("la mia soluzione è usare map invece di forEach perché restituisce un array nuovo"), true);
  assert.equal(isAttempt("non so"), false);
  assert.equal(isAttempt("perché bisogna salvare lo stato prima del render e poi aggiornarlo?"), false);
  assert.equal(isAttempt("dammi la soluzione per favore che non ci arrivo proprio più"), false);
});

test("nextHint: il primo messaggio di un problema non è un tentativo; poi ogni tentativo sale di un livello, fino a 4", () => {
  const long = "secondo me bisogna salvare lo stato prima del render e poi aggiornarlo";
  let h = nextHint(initialHint(), long);
  assert.deepEqual([h.level, h.attempts, h.turns], [1, 0, 1]);
  h = nextHint(h, "dammi la soluzione");
  assert.deepEqual([h.level, h.attempts], [1, 0], "chiedere non fa salire");
  for (let i = 0; i < 5; i++) h = nextHint(h, long);
  assert.deepEqual([h.level, h.attempts], [4, 5]);
});

test("canReveal dopo 2 tentativi; afterSolution e resetProblem tornano al livello 1 tenendo i contatori", () => {
  const long = "secondo me bisogna salvare lo stato prima del render e poi aggiornarlo";
  let h = nextHint(initialHint(), "esercizio");
  h = nextHint(h, long);
  assert.equal(canReveal(h), false);
  h = nextHint(h, long);
  assert.equal(canReveal(h), true);
  assert.deepEqual(publicHint(h), { level: 3, attempts: 2, canReveal: true });
  const shown = afterSolution({ ...h, leaksBlocked: 2 });
  assert.deepEqual(shown, { level: 1, attempts: 0, turns: 0, leaksBlocked: 2, solutionsShown: 1 });
  assert.deepEqual(resetProblem(h), { ...h, level: 1, attempts: 0, turns: 0 });
});

test("isAttempt: una domanda senza codice non è mai un tentativo", () => {
  assert.equal(isAttempt("che differenza c'è tra let e const?"), false);
  assert.equal(isAttempt("I think the function should return the array?"), false);
});
