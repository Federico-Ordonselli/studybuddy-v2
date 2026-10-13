import { test } from "node:test";
import assert from "node:assert/strict";
import { isSolutionRequest, codeLeak, hasCode, guardedReply, parseLeak, checkLeak, FALLBACK_HINT, RETRY_NOTE } from "@/lib/tutor/guard";

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

const LONG_CODE = "```js\n" + Array.from({ length: 8 }, (_, i) => `step${i}();`).join("\n") + "\n```";

test("guardedReply: risposta pulita passa al primo colpo, giudice chiamato una volta", async () => {
  const notes: (string | undefined)[] = []; let judged = 0;
  const r = await guardedReply({ generate: async (n) => { notes.push(n); return "Cosa hai provato finora?"; }, judge: async () => { judged++; return false; } });
  assert.deepEqual(r, { reply: "Cosa hai provato finora?", blocked: 0, fallback: false });
  assert.deepEqual(notes, [undefined]); assert.equal(judged, 1);
});

test("guardedReply: blocco di codice lungo = perdita senza chiamare il giudice; una sola rigenerazione con la nota", async () => {
  const notes: (string | undefined)[] = []; let judged = 0;
  const r = await guardedReply({
    generate: async (n) => { notes.push(n); return notes.length === 1 ? LONG_CODE : "Pensa a quale metodo restituisce un array nuovo [1]."; },
    judge: async () => { judged++; return false; },
  });
  assert.equal(r.reply, "Pensa a quale metodo restituisce un array nuovo [1].");
  assert.equal(r.blocked, 1); assert.equal(r.fallback, false);
  assert.deepEqual(notes, [undefined, RETRY_NOTE]);
  assert.equal(judged, 1, "il giudice gira solo sulla seconda risposta, la prima l'ha fermata il codice");
});

test("guardedReply: due perdite → indizio fisso, mai più di due generazioni", async () => {
  let generated = 0;
  const r = await guardedReply({ generate: async () => { generated++; return "La risposta è 42."; }, judge: async () => true });
  assert.deepEqual(r, { reply: FALLBACK_HINT, blocked: 2, fallback: true });
  assert.equal(generated, 2);
});

test("parseLeak: JSON valido o null", () => {
  assert.equal(parseLeak('{"reason":"dà il codice","gives_solution":true}'), true);
  assert.equal(parseLeak('{"reason":"solo un indizio","gives_solution":false}'), false);
  assert.equal(parseLeak('{"gives_solution":"yes"}'), null);
  assert.equal(parseLeak("non json"), null);
});

test("checkLeak: schema e temperature 0; JSON non valido due volte → nessun blocco (fail-open)", async () => {
  const original = globalThis.fetch; const bodies: any[] = []; const warn = console.warn; console.warn = () => {};
  globalThis.fetch = (async (_url: unknown, opts: RequestInit) => {
    bodies.push(JSON.parse(opts.body as string));
    return Response.json({ message: { content: "boh" } });
  }) as typeof fetch;
  try {
    assert.equal(await checkLeak("problema", "[1] contesto", "risposta"), false);
    assert.equal(bodies.length, 2, "un retry");
    assert.ok(bodies[0].format, "schema passato come format");
    assert.equal(bodies[0].options.temperature, 0);
  } finally { globalThis.fetch = original; console.warn = warn; }
});

test("hasCode: la prosa con parole come function/let/return non è codice", () => {
  for (const m of ["I think the function should return the array", "let me try again", "che differenza c'è tra let e const?", "Ho provato prima A;"])
    assert.equal(hasCode(m), false, m);
  for (const m of ["const x = 1", "function foo(a) {", "if (x) {", "return a + b;", "def f(x):"]) assert.equal(hasCode(m), true, m);
});

test("isSolutionRequest: verbo + oggetto vicini; più formule, meno falsi positivi", () => {
  for (const m of ["Dimmi se la mia risposta è corretta", "dimmi cosa fa il codice", "just tell me what flexbox does"])
    assert.equal(isSolutionRequest(m), false, m);
  for (const m of ["puoi darmi la soluzione?", "mi dai la soluzione", "fammi vedere la soluzione", "mi scrivi il codice?", "just tell me the answer", "dimmi direttamente la risposta"])
    assert.equal(isSolutionRequest(m), true, m);
});

test("isSolutionRequest: «correggilo tu» è una richiesta, «correggi il mio codice: …?» no", () => {
  for (const m of ["correggilo tu", "correggimelo tu per favore", "correggi tu"]) assert.equal(isSolutionRequest(m), true, m);
  assert.equal(isSolutionRequest("correggi il mio codice: ho dimenticato un punto e virgola?"), false);
});
