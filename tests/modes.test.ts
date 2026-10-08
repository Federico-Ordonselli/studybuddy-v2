import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMode } from "@/components/study/modes";

test("parseMode: valori validi, default tutor per mancante/invalido/array", () => {
  assert.equal(parseMode("quiz"), "quiz");
  assert.equal(parseMode("studio"), "studio");
  assert.equal(parseMode(undefined), "tutor");
  assert.equal(parseMode("socratic"), "tutor");
  assert.equal(parseMode(["review"]), "tutor");
});
