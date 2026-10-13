import test from "node:test";
import assert from "node:assert/strict";
import { cleanTranscript } from "@/lib/rag/cleanTranscript";

// Estratti nello stile delle trascrizioni dei corsi video (parlato trascritto, senza punteggiatura curata).
test("riempitivi: um, uh, you know, so basically", () => {
  assert.equal(
    cleanTranscript("Um, so a closure is, you know, a function that uh remembers its outer scope."),
    "So a closure is a function that remembers its outer scope.",
  );
  assert.equal(cleanTranscript("So basically, the browser parses the HTML first."), "The browser parses the HTML first.");
  assert.equal(cleanTranscript("Do you know what the DOM is? It is a tree."), "Do you know what the DOM is? It is a tree.");
});

test("frasi di servizio: apertura, chiusura, rimandi ad altre lezioni", () => {
  assert.equal(
    cleanTranscript("Welcome back. In this video, you'll learn about flexbox. Flexbox lays out items in one dimension. See you in the next video."),
    "Flexbox lays out items in one dimension.",
  );
  assert.equal(
    cleanTranscript("Bentornati. In questo video vediamo gli array. Un array è una lista ordinata di valori. Ci vediamo nella prossima lezione."),
    "Un array è una lista ordinata di valori.",
  );
});

test("ripetizioni consecutive di parole e di frasi", () => {
  assert.equal(cleanTranscript("The the useState hook returns returns a pair."), "The useState hook returns a pair.");
  assert.equal(cleanTranscript("Props are read-only. Props are read-only. You cannot change them."), "Props are read-only. You cannot change them.");
});

test("non tocca il testo già pulito, il codice e la punteggiatura", () => {
  const clean = "The fetch function returns a promise. Call response.json() to parse the body, then use the data.";
  assert.equal(cleanTranscript(clean), clean);
  assert.equal(cleanTranscript("Write const total = a + b; inside the function."), "Write const total = a + b; inside the function.");
});

test("estratto lungo: resta solo il contenuto", () => {
  const raw = "Hello and welcome back. Uh, in the previous lesson we talked about variables. " +
    "Now, um, let's talk about scope. Scope determines where a variable is visible. " +
    "A variable declared with let is, you know, block scoped. So basically var is function scoped. " +
    "Okay, let's get started. Thanks for watching.";
  assert.equal(
    cleanTranscript(raw),
    "Now, let's talk about scope. Scope determines where a variable is visible. A variable declared with let is block scoped. Var is function scoped.",
  );
  assert.equal(cleanTranscript(""), "");
});
