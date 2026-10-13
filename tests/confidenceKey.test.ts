import { test } from "node:test";
import assert from "node:assert/strict";
import { confidenceFromKey } from "@/lib/client/confidence";

const key = (k: string, extra: Partial<Parameters<typeof confidenceFromKey>[0]> = {}) =>
  confidenceFromKey({ key: k, code: `Digit${k}`, altKey: false, ctrlKey: false, metaKey: false, typing: false, ...extra });

test("confidenceFromKey: 1/2/3 fuori dai campi di testo", () => {
  assert.deepEqual(["1", "2", "3"].map((k) => key(k)), [1, 2, 3]);
  assert.equal(key("4"), null);
  assert.equal(key("a", { code: "KeyA" }), null);
});

test("confidenceFromKey: mentre scrivi serve Alt (il tasto da solo è testo)", () => {
  assert.equal(key("1", { typing: true }), null);
  // con Alt alcune tastiere cambiano `key` (es. «¡»): conta il tasto fisico
  assert.equal(key("¡", { code: "Digit1", typing: true, altKey: true }), 1);
  assert.equal(key("3", { code: "Numpad3", typing: true, altKey: true }), 3);
});

test("confidenceFromKey: Ctrl e Meta restano al browser", () => {
  assert.equal(key("1", { ctrlKey: true }), null);
  assert.equal(key("1", { metaKey: true, altKey: true }), null);
});
