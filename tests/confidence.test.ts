import { test } from "node:test";
import assert from "node:assert/strict";
import { Rating, toRating } from "@/lib/tutor/scheduler";
import { confidence } from "@/lib/validation";

test("toRating: le 9 combinazioni verdetto × fiducia (tabella 6.2)", () => {
  const table = {
    correct: { 3: Rating.Easy, 2: Rating.Good, 1: Rating.Good },
    partial: { 3: Rating.Hard, 2: Rating.Hard, 1: Rating.Hard },
    wrong: { 3: Rating.Again, 2: Rating.Again, 1: Rating.Again },
  } as const;
  for (const verdict of ["correct", "partial", "wrong"] as const)
    for (const c of [1, 2, 3] as const) assert.equal(toRating(verdict, c), table[verdict][c], `${verdict}/${c}`);
});

test("toRating: senza fiducia una corretta resta Good", () => {
  assert.equal(toRating("correct"), Rating.Good);
});

test("validation.confidence: 1–3 o assente", () => {
  assert.equal(confidence(undefined), undefined);
  for (const c of [1, 2, 3]) assert.equal(confidence(c), c);
  for (const bad of [0, 4, 2.5, "3", null]) assert.throws(() => confidence(bad));
  assert.throws(() => confidence(undefined, true));
});
