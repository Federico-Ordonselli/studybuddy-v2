import test from "node:test";
import assert from "node:assert/strict";
import { buildCardContext, generateCardDrafts, markDuplicates, parseCardOutput, sourceForAnswer } from "@/lib/tutor/cardGen";

const chunks = [
  { chunkId: 10, content: "Um, welcome back. A closure is a function that remembers the variables of the scope where it was created.", docKind: "transcript" },
  { chunkId: 20, content: "The map method returns a new array with the results of calling a function on every element.", docKind: "html" },
];

test("contesto numerato [n], con le trascrizioni ripulite e il resto intatto", () => {
  const ctx = buildCardContext(chunks);
  assert.match(ctx, /^\[1\] A closure is a function/);
  assert.match(ctx, /\n\n\[2\] The map method returns/);
  assert.doesNotMatch(ctx, /welcome back|Um/);
});

test("parse: fatto e fonte dichiarati, cloze, controllo di qualità sulle carte", () => {
  const raw = JSON.stringify({
    facts: ["A closure remembers the variables of the scope where it was created.", "map returns a new array."],
    cards: [
      { fact: 0, type: "qa", question: "What does a closure remember?", answer: "The variables of the scope where it was created.", source: 1 },
      { fact: 1, type: "cloze", question: "The ____ method returns a new array with the results of a function.", answer: "map", source: 2 },
      { fact: 1, type: "qa", question: "Does map return a new array?", answer: "Yes", source: 2 },
    ],
  });
  const drafts = parseCardOutput(raw, chunks);
  assert.equal(drafts.length, 3);
  assert.deepEqual(drafts.map((d) => d.sourceChunkId), [10, 20, 20]);
  assert.equal(drafts[0].fact, "A closure remembers the variables of the scope where it was created.");
  assert.equal(drafts[1].type, "cloze");
  assert.deepEqual(drafts[0].issues, []);
  assert.deepEqual(drafts[2].issues.map((i) => i.code), ["yesno"]);
});

test("fonte dichiarata poco pertinente o fuori intervallo → attribuzione lessicale", () => {
  const raw = JSON.stringify({
    facts: ["map returns a new array"],
    cards: [
      { fact: 0, type: "qa", question: "What does map return?", answer: "A new array with the results of calling a function on every element.", source: 1 },
      { fact: 0, type: "qa", question: "What does map return when called?", answer: "A new array with the results of calling a function on every element.", source: 9 },
    ],
  });
  assert.deepEqual(parseCardOutput(raw, chunks).map((d) => d.sourceChunkId), [20, 20]);
});

test("output non valido: carte scartate o nessuna; cloze senza spazio vuoto diventa domanda", () => {
  assert.deepEqual(parseCardOutput("non json", chunks), []);
  assert.deepEqual(parseCardOutput(JSON.stringify({ facts: [], cards: "x" }), chunks), []);
  const drafts = parseCardOutput(JSON.stringify({ facts: ["f"], cards: [
    { fact: 0, type: "qa", question: " ", answer: "x", source: 1 },
    { fact: 7, type: "cloze", question: "What remembers its scope?", answer: "A closure", source: 1 },
  ] }), chunks);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].type, "qa");
  assert.equal(drafts[0].fact, "");
});

test("duplicati: rispetto alle carte esistenti e dentro la stessa generazione", () => {
  const raw = JSON.stringify({ facts: ["f"], cards: [
    { fact: 0, type: "qa", question: "What does a closure remember?", answer: "Its scope", source: 1 },
    { fact: 0, type: "qa", question: "What does a closure remember?", answer: "The outer variables", source: 1 },
    { fact: 0, type: "qa", question: "What does map return?", answer: "A new array", source: 2 },
  ] });
  const drafts = markDuplicates(parseCardOutput(raw, chunks), ["what does map return"]);
  assert.deepEqual(drafts.map((d) => d.issues.map((i) => i.code)), [[], ["duplicate"], ["duplicate"]]);
});

test("sourceForAnswer: il passaggio con più parole in comune", () => {
  assert.equal(sourceForAnswer("gatto sul divano", [{ chunkId: 1, content: "astronomia stelle galassie" }, { chunkId: 2, content: "gatto sul divano" }]), 2);
  assert.equal(sourceForAnswer("x", []), null);
});

test("generateCardDrafts: schema facts→cards, argomento nel prompt, un retry se il JSON non è valido", async () => {
  const original = globalThis.fetch;
  const bodies: { format?: { properties?: Record<string, unknown> }; messages: { content: string }[] }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const content = bodies.length === 1 ? "{rotto" : JSON.stringify({ facts: ["map returns a new array"], cards: [{ fact: 0, type: "qa", question: "What does map return?", answer: "A new array", source: 2 }] });
    return Response.json({ message: { content } });
  }) as typeof fetch;
  try {
    const drafts = await generateCardDrafts(chunks, { n: 3, topic: "array methods" });
    assert.equal(drafts.length, 1);
    assert.equal(bodies.length, 2);
    assert.deepEqual(Object.keys(bodies[0].format!.properties!), ["facts", "cards"]);
    const user = bodies[0].messages.at(-1)!.content;
    assert.match(user, /array methods/);
    assert.match(user, /\[2\] The map method/);
  } finally {
    globalThis.fetch = original;
  }
});
