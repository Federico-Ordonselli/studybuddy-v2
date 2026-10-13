import test from "node:test";
import assert from "node:assert/strict";
import { checkCard, type IssueCode } from "@/lib/tutor/cardQuality";

const codes = (question: string, answer: string): IssueCode[] => checkCard({ question, answer }).map((i) => i.code);

test("una carta atomica non ha problemi (definizione, meccanismo, codice, cloze)", () => {
  assert.deepEqual(codes("Cos'è una closure in JavaScript?", "Una funzione che ricorda le variabili dello scope in cui è stata creata."), []);
  assert.deepEqual(codes("Why does React re-render a component when its state changes?", "Because setState schedules an update that re-runs the component function."), []);
  assert.deepEqual(codes("Come si dichiara una costante in JavaScript?", "`const x = 1;`"), []);
  assert.deepEqual(codes("In CSS, ____ positions an element relative to its nearest positioned ancestor.", "position: absolute"), []);
});

test("risposta troppo lunga: oltre 25 parole, esclusi i blocchi di codice", () => {
  const long = Array.from({ length: 26 }, (_, i) => `parola${i}`).join(" ");
  assert.deepEqual(codes("Cosa fa il metodo map?", long), ["long"]);
  const code = "Così:\n```js\n" + Array.from({ length: 40 }, (_, i) => `x${i}`).join(" ") + "\n```";
  assert.deepEqual(codes("Come si scrive un ciclo for?", code), []);
});

test("enumerazione: nella domanda o come lista nella risposta", () => {
  assert.ok(codes("Elenca i tipi primitivi di JavaScript", "string").includes("enumeration"));
  assert.ok(codes("Quali sono i metodi HTTP più usati?", "GET").includes("enumeration"));
  assert.ok(codes("Name the three pillars of OOP.", "encapsulation").includes("enumeration"));
  assert.ok(codes("What are the 3 states of a promise?", "pending").includes("enumeration"));
  assert.ok(codes("Che linguaggi usa il front-end?", "HTML, CSS, JavaScript").includes("enumeration"));
  assert.ok(codes("Che linguaggi usa il front-end?", "- HTML\n- CSS\n- JavaScript").includes("enumeration"));
  // virgole in una frase normale non sono un elenco
  assert.deepEqual(codes("Cosa restituisce map?", "Un nuovo array, lasciando l'originale intatto, con i valori trasformati."), []);
});

test("domanda doppia", () => {
  assert.ok(codes("Cos'è il DOM? A cosa serve?", "Una rappresentazione ad albero della pagina").includes("double"));
  assert.ok(codes("What is a closure and how is it created?", "A function bundled with its scope").includes("double"));
  assert.ok(codes("Cos'è un hook e perché si usa?", "Una funzione di React").includes("double"));
});

test("domande sì/no o vero/falso", () => {
  for (const q of ["È vero che let ha scope di blocco?", "Is it possible to nest flexbox containers?", "Does map mutate the array?", "Can a const object be modified?", "Is there a limit to localStorage?", "Vero o falso: var ha scope di funzione"]) {
    assert.ok(codes(q, "Sì").includes("yesno"), q);
  }
  assert.deepEqual(codes("Is-a relationships: which OOP concept models them?", "Inheritance"), []);
  // in italiano il sì/no non inverte l'ausiliare: senza interrogativo, o con risposta «Sì/No»
  assert.ok(codes("Il metodo map modifica l'array originale?", "No, non lo cambia.").includes("yesno"));
  assert.ok(codes("Il metodo map modifica l'array originale?", "Crea sempre un array nuovo").includes("yesno"));
  assert.ok(codes("Spiega il ruolo di map", "Yes, it maps").includes("yesno"));
  for (const q of ["Qual è il comportamento di filter?", "In che modo reduce usa l'accumulatore?", "A cosa serve useEffect?", "Quanti argomenti riceve la callback di map?", "Which hook manages state?", "Dove viene dichiarata una variabile di blocco?"]) {
    assert.ok(!codes(q, "Una risposta").includes("yesno"), q);
  }
});

test("risposta già contenuta nella domanda", () => {
  assert.ok(codes("Il metodo filter crea un nuovo array con gli elementi che passano il test: cosa fa filter?", "crea un nuovo array con gli elementi che passano il test").includes("leak"));
  assert.ok(codes("Which keyword declares a block-scoped constant, const?", "const").includes("leak"));
  assert.deepEqual(codes("Which keyword declares a block-scoped constant?", "const"), []);
});

test("riferimenti al contesto che lo studente non vede", () => {
  assert.ok(codes("Secondo il testo, cosa fa useEffect?", "Esegue effetti collaterali").includes("context"));
  assert.ok(codes("In the passage, what is hoisting?", "Moving declarations to the top").includes("context"));
});

test("cloze: un solo spazio vuoto", () => {
  assert.ok(codes("____ e ____ sono hook di React.", "useState").includes("cloze"));
});

test("carta vuota e messaggi in italiano", () => {
  assert.deepEqual(codes(" ", "x"), ["empty"]);
  assert.deepEqual(codes("Cos'è?", ""), ["empty"]);
  for (const issue of checkCard({ question: "Elenca e spiega i 5 principi SOLID? Perché?", answer: "S, O, L, I, D" })) assert.ok(issue.message.length > 5);
});
