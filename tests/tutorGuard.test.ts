import { test } from "node:test";
import assert from "node:assert/strict";
import { isSolutionRequest, codeLeak, hasCode } from "@/lib/tutor/guard";

const POSITIVE = [
  "dammi la soluzione",
  "Dimmi la risposta per favore",
  "qual è la soluzione?",
  "scrivi tu il codice",
  "scrivimi il codice completo",
  "fammelo tu, non ci arrivo",
  "soluzione?",
  "just tell me the answer",
  "Give me the solution",
  "write the code for me",
];
const NEGATIVE = [
  "cos'è il DOM?",
  "che differenza c'è tra let e const?",
  "ho provato con un ciclo for ma restituisce undefined",
  "la mia soluzione è usare map invece di forEach, va bene?",
  "My answer is that the state is lost on re-render",
  "perché useEffect gira due volte?",
  "non capisco la consegna dell'esercizio",
  "mi spieghi cosa fa flexbox?",
  "what does the virtual DOM do?",
  "ho scritto const x = arr.map(f) e funziona a metà",
];

test("isSolutionRequest: 10 richieste esplicite riconosciute (IT/EN)", () => {
  for (const m of POSITIVE) assert.equal(isSolutionRequest(m), true, m);
});
test("isSolutionRequest: 10 domande e tentativi non riconosciuti come richieste", () => {
  for (const m of NEGATIVE) assert.equal(isSolutionRequest(m), false, m);
});

test("codeLeak: blocco recintato oltre 6 righe non vuote", () => {
  const block = (n: number) => "Ecco:\n```js\n" + Array.from({ length: n }, (_, i) => `const a${i} = ${i};`).join("\n") + "\n```";
  assert.equal(codeLeak(block(6)), false);
  assert.equal(codeLeak(block(7)), true);
  assert.equal(codeLeak("```\n\n\nx\n\n\n```"), false, "le righe vuote non contano");
  assert.equal(codeLeak("nessun codice qui"), false);
  assert.equal(codeLeak("```js\nconst a = 1;\n"), false, "blocco non chiuso: nessuna perdita certa");
});

test("hasCode: blocchi, codice inline e righe di codice", () => {
  assert.equal(hasCode("uso `arr.map(f)`"), true);
  assert.equal(hasCode("```\nx\n```"), true);
  assert.equal(hasCode("ho scritto const x = arr.map(f) e funziona a metà"), true);
  assert.equal(hasCode("items.forEach(i => console.log(i));"), true);
  assert.equal(hasCode("penso che serva un ciclo"), false);
});
