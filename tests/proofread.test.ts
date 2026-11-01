import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { protect, restore, splitFrontmatter } from "@/lib/proofread/protect";
import { splitSections } from "@/lib/proofread/split";
import { compareWords, dropInventedHeadings, isAcceptable, similarWords } from "@/lib/proofread/guard";
import { proofreadNote, proofreadPiece, proofreadSection, unwrap, type Generator } from "@/lib/proofread/note";
import { listVault, readState, syncVault, validatePaths } from "@/lib/proofread/vault";

// Note sintetiche nello stile degli appunti presi a lezione (refusi, «e'» per «è»).
const NOTE = "i sistemi elaborativi\nUn sistema e' un insieme di elementi che interagiscono tra loro.\nUn elaboratore 'e un isstema in grado di acquisisre input.\n";
const FIXED = "# I sistemi elaborativi\nUn sistema è un insieme di elementi che interagiscono tra loro.\nUn elaboratore è un sistema in grado di acquisire input.\n";

const echo: Generator = async (o) => o.messages[0].content;

test("protect/restore: codice, wikilink, URL e tag restano identici", () => {
  const text = "Vedi [[Parte 1|la prima parte]] e ![[schema.png]].\n```js\nconst x = 1; // e' un commento\n```\nUsa `fetch()` su https://example.com/a_b?x=1 #da-rivedere [doc](https://x.org/p \"titolo\").\n";
  const p = protect(text);
  assert.ok(!p.text.includes("[["));
  assert.ok(!p.text.includes("const x"));
  assert.ok(!p.text.includes("https://"));
  assert.ok(!p.text.includes("#da-rivedere"));
  assert.ok(p.text.includes("[doc]"), "il testo visibile del link resta correggibile");
  assert.equal(restore(p.text, p.slots), text);
});

test("protect: i titoli Markdown non sono tag", () => {
  const p = protect("# Titolo\n## Sotto titolo\n");
  assert.equal(p.slots.length, 0);
});

test("restore: segnaposto perso, duplicato o inventato → null", () => {
  const p = protect("a `x` b `y` c");
  assert.equal(p.slots.length, 2);
  assert.equal(restore("a ⟦0⟧ b c", p.slots), null);
  assert.equal(restore("a ⟦0⟧ ⟦0⟧ b ⟦1⟧", p.slots), null);
  assert.equal(restore("a ⟦0⟧ b ⟦1⟧ ⟦2⟧", p.slots), null);
  assert.equal(restore("A ⟦0⟧ b ⟦1⟧ c.", p.slots), "A `x` b `y` c.");
});

test("splitFrontmatter separa lo YAML iniziale", () => {
  assert.deepEqual(splitFrontmatter("---\ntags: [a]\n---\ntesto"), { frontmatter: "---\ntags: [a]\n---\n", body: "testo" });
  assert.deepEqual(splitFrontmatter("testo\n---\n"), { frontmatter: "", body: "testo\n---\n" });
});

test("splitSections: la concatenazione ridà il testo, i titoli nel codice non tagliano", () => {
  const body = "intro\n# A\n" + "parola ".repeat(50) + "\n```\n# non un titolo\n```\n## B\nfine\n";
  const small = splitSections(body, 120);
  assert.equal(small.join(""), body);
  assert.ok(small.length >= 3);
  assert.ok(!small.some((s) => s.startsWith("# non un titolo")));
  assert.deepEqual(splitSections(body), [body], "sotto il budget resta un pezzo solo");
});

test("splitSections: un paragrafo enorme si taglia senza perdere testo", () => {
  const body = Array.from({ length: 200 }, (_, i) => `riga ${i} con qualche parola`).join("\n");
  const parts = splitSections(body, 500);
  assert.equal(parts.join(""), body);
  assert.ok(parts.every((p) => p.length <= 500));
});

test("compareWords: refusi e accenti non sono riscritture", () => {
  const r = compareWords(NOTE, FIXED);
  assert.equal(r.rewrites, 0);
  assert.ok(r.typoFixes >= 2);
  assert.ok(isAcceptable(r));
  assert.ok(similarWords("tecnhiche", "tecniche"));
  assert.ok(similarWords("ada", "da"));
  assert.ok(!similarWords("hardware", "software"));
  assert.equal(compareWords("in sieme a loro", "insieme a loro").rewrites, 0, "parole unite");
});

test("compareWords: una riformulazione si scarta", () => {
  const original = "Un sistema è un insieme di elementi che interagiscono tra loro in modo che a ogni richiesta corrisponda una risposta prefissata.";
  const rewritten = "Per sistema si intende un gruppo di componenti collegati: a ciascun input il sistema associa sempre lo stesso output.";
  const r = compareWords(original, rewritten);
  assert.ok(!isAcceptable(r), JSON.stringify(r));
  const added = compareWords("Il bit vale 0 o 1.", "Il bit vale 0 o 1. È l'unità minima di informazione usata dai calcolatori.");
  assert.ok(!isAcceptable(added), "frase aggiunta");
});

test("unwrap toglie il blocco ```markdown che il modello a volte aggiunge", () => {
  assert.equal(unwrap("```markdown\n# T\ntesto\n```"), "# T\ntesto");
  assert.equal(unwrap("testo"), "testo");
});

test("proofreadPiece: correzione accettata, spazi ai bordi preservati", async () => {
  const gen: Generator = async () => FIXED.trim();
  const r = await proofreadPiece("\n" + NOTE + "\n", gen);
  assert.equal(r.status, "corrected");
  assert.equal(r.text, "\n" + FIXED + "\n");
});

test("proofreadPiece: riscrittura → secondo tentativo → originale tenuto", async () => {
  const calls: number[] = [];
  const gen: Generator = async (o) => {
    calls.push(o.messages.length);
    assert.equal(o.temperature, 0);
    return "Testo del tutto diverso che non c'entra niente con l'originale scritto a lezione oggi pomeriggio.";
  };
  const original = "Un elaboratore e' un sistema in grado di acquisire input, memorizzare e trasformare le informazioni.";
  const r = await proofreadPiece(original, gen);
  assert.equal(r.status, "rejected");
  assert.equal(r.text, original);
  assert.deepEqual(calls, [1, 3], "il secondo tentativo vede la risposta precedente e la nota di riprova");
  assert.match(r.reason ?? "", /parole/);
});

test("proofreadPiece: un segnaposto perso fa riprovare, poi va bene", async () => {
  let n = 0;
  const gen: Generator = async (o) => (n++ === 0 ? "Vedi la nota." : o.messages[0].content.replace("e'", "è"));
  const r = await proofreadPiece("Vedi [[nota]], e' importante.", gen);
  assert.equal(r.status, "corrected");
  assert.equal(r.text, "Vedi [[nota]], è importante.");
});

test("proofreadPiece: niente parole → nessuna chiamata", async () => {
  const gen: Generator = async () => assert.fail("non deve chiamare il modello");
  assert.equal((await proofreadPiece("```\ncodice\n```\n", gen)).status, "skipped");
  assert.equal((await proofreadPiece("\n\n---\n", gen)).status, "skipped");
});

test("compareWords: una riga tolta si scarta anche se è poco rispetto alla sezione", () => {
  const body = "parola ".repeat(250) + "\nl'unita' centrale di elaborazione\n";
  const r = compareWords(body, "parola ".repeat(250));
  assert.equal(r.deleted, 4, "«l'» da solo conta come lettera sola");
  assert.ok(r.rewriteRatio < 0.1);
  assert.ok(!isAcceptable(r));
});

test("compareWords: parola che stavi scrivendo «completata» → scartata", () => {
  const original = "Il clock garantisce la temporizzazione e la sincronizzazione delle oper";
  const r = compareWords(original, "Il clock garantisce la temporizzazione e la sincronia.");
  assert.equal(r.longestGap, 2);
  assert.ok(!isAcceptable(r));
  assert.ok(!isAcceptable(compareWords("La ROM invece è non volat", "La ROM invece è non volatile.")), "parola completata");
  assert.ok(isAcceptable(compareWords("il programm è", "il programma è")), "lettera mancante");
  assert.ok(isAcceptable(compareWords("il il bit vale 0", "Il bit vale 0.")), "una ripetizione tolta va bene");
  assert.ok(isAcceptable(compareWords("ingresso e di uscita.l Interfacce", "ingresso e di uscita. Interfacce")), "lettera sola");
  const lost = compareWords("in grado di acquisisre input memorizzare", "in grado di acquisire, memorizzare");
  assert.equal(lost.deleted, 1);
  assert.ok(!isAcceptable(lost), "una parola vera tolta cambia il contenuto");
});

test("dropInventedHeadings: via i titoli nuovi, restano le righe promosse a titolo", () => {
  const original = "i sistemi elaborativi\nComputer: esegue dei programmi\nProgramma: sere di istruzioni\n";
  const corrected = "# I sistemi elaborativi\n\n# Computer\n\nComputer: esegue dei programmi\n\n## Programma\nProgramma: serie di istruzioni\n";
  assert.equal(
    dropInventedHeadings(original, corrected),
    "# I sistemi elaborativi\n\nComputer: esegue dei programmi\n\nProgramma: serie di istruzioni\n",
  );
  assert.equal(dropInventedHeadings("il modello Von Nuemann\n", "## Il modello Von Neumann\n"), "## Il modello Von Neumann\n", "titolo con refuso corretto");
});

test("proofreadSection: sezione scartata → si riprova per paragrafi", async () => {
  const section = "Primo paragrafo e' qui.\n\nSecondo paragrafo con un refuso: isstema.\n";
  const gen: Generator = async (o) => {
    const t = o.messages[0].content;
    if (t.includes("Primo") && t.includes("Secondo")) return "Primo paragrafo è qui."; // perde il secondo
    return t.replace("e'", "è").replace("isstema", "sistema");
  };
  const parts = await proofreadSection(section, gen);
  assert.deepEqual(parts.map((p) => p.status), ["corrected", "corrected"]);
  assert.equal(parts.map((p) => p.text).join(""), "Primo paragrafo è qui.\n\nSecondo paragrafo con un refuso: sistema.\n");
});

test("proofreadPiece: la parola che stai scrivendo non arriva al modello", async () => {
  let seen = "";
  const gen: Generator = async (o) => {
    seen = o.messages[0].content;
    return seen.replace("e'", "è").replace("computr", "computer") + ".";
  };
  const r = await proofreadPiece("Si spegne il computr. La ROM invece e' non volat", gen);
  assert.ok(!seen.includes("volat"));
  assert.equal(r.text, "Si spegne il computer. La ROM invece è non volat");
  assert.equal(protect("fine riga\n", { trailingWord: true }).slots.length, 0, "con l'a capo la riga è finita");
});

test("proofreadNote: frontmatter intatto e a capo CRLF preservati", async () => {
  const note = "---\ntitle: e' prova\n---\nuna nota e' qui\r\n".replace(/\n/g, "\r\n").replace(/\r\r/g, "\r");
  const gen: Generator = async (o) => o.messages[0].content.replace("e'", "è");
  const r = await proofreadNote(note, gen);
  assert.ok(r.text.startsWith("---\r\ntitle: e' prova\r\n---\r\n"));
  assert.ok(r.text.includes("una nota è qui\r\n"));
});

function tmpVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proofread-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  fs.mkdirSync(path.join(vault, "Corso"), { recursive: true });
  fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), "{}");
  fs.writeFileSync(path.join(vault, "Corso", "Parte 1.md"), NOTE);
  fs.writeFileSync(path.join(vault, "Corso", "schema.png"), Buffer.from([1, 2, 3]));
  return { root, vault, out: path.join(root, "vault-pulito") };
}

test("validatePaths: la copia non può stare dentro il vault né contenerlo", () => {
  const { vault, root } = tmpVault();
  assert.throws(() => validatePaths(vault, path.join(vault, "pulito")), /fuori dal vault/);
  assert.throws(() => validatePaths(vault, vault), /fuori dal vault/);
  assert.throws(() => validatePaths(vault, root), /dentro la cartella/);
  assert.throws(() => validatePaths(path.join(root, "manca"), path.join(root, "x")), /non esiste/);
});

test("syncVault: copia speculare, originali intatti, invariati saltati, rimossi tolti", async () => {
  const { vault, out } = tmpVault();
  assert.deepEqual(listVault(vault), ["Corso/Parte 1.md", "Corso/schema.png"]);
  let calls = 0;
  const gen: Generator = async () => (calls++, FIXED.trim());

  const first = await syncVault(vault, out, { gen });
  assert.deepEqual(first.map((e) => e.action).sort(), ["copied", "corrected"]);
  assert.equal(fs.readFileSync(path.join(out, "Corso", "Parte 1.md"), "utf8"), FIXED);
  assert.equal(fs.readFileSync(path.join(vault, "Corso", "Parte 1.md"), "utf8"), NOTE, "originale intatto");
  assert.ok(!fs.existsSync(path.join(out, ".obsidian")));
  assert.equal(calls, 1);

  const second = await syncVault(vault, out, { gen });
  assert.ok(second.every((e) => e.action === "skipped"));
  assert.equal(calls, 1, "nota invariata: nessuna chiamata");

  fs.rmSync(path.join(vault, "Corso", "schema.png"));
  fs.writeFileSync(path.join(out, "mio.md"), "scritto a mano nella copia");
  const third = await syncVault(vault, out, { gen });
  assert.ok(third.some((e) => e.file === "Corso/schema.png" && e.action === "removed"));
  assert.ok(!fs.existsSync(path.join(out, "Corso", "schema.png")));
  assert.ok(fs.existsSync(path.join(out, "mio.md")), "i file non scritti dallo strumento restano");
});

test("syncVault: nota rinominata → copia della correzione senza chiamare il modello, cartella vecchia tolta", async () => {
  const { vault, out } = tmpVault();
  let calls = 0;
  const gen: Generator = async () => (calls++, FIXED.trim());
  await syncVault(vault, out, { gen });
  fs.renameSync(path.join(vault, "Corso"), path.join(vault, "Corso 2"));
  const events = await syncVault(vault, out, { gen });
  assert.equal(calls, 1);
  assert.equal(events.find((e) => e.file === "Corso 2/Parte 1.md")?.action, "copied");
  assert.equal(fs.readFileSync(path.join(out, "Corso 2", "Parte 1.md"), "utf8"), FIXED);
  assert.ok(!fs.existsSync(path.join(out, "Corso")), "cartella vuota tolta");
});

test("syncVault: sezioni scartate registrate nello stato, dry-run non scrive", async () => {
  const { vault, out } = tmpVault();
  const dry = await syncVault(vault, out, { gen: echo, dryRun: true });
  assert.equal(dry.length, 2);
  assert.ok(!fs.existsSync(out));

  const gen: Generator = async () => "Contenuto completamente inventato dal modello che non rispetta per niente gli appunti originali della lezione.";
  await syncVault(vault, out, { gen });
  const state = readState(out);
  assert.equal(state.files["Corso/Parte 1.md"].rejected?.length, 3, "scartata intera, poi riga per riga");
  assert.equal(fs.readFileSync(path.join(out, "Corso", "Parte 1.md"), "utf8"), NOTE, "copia = originale dove la correzione è scartata");
});

test("syncVault: un errore del modello su una nota non ferma le altre", async () => {
  const { vault, out } = tmpVault();
  fs.writeFileSync(path.join(vault, "Altra.md"), "altra nota e' qui");
  const gen: Generator = async (o) => {
    if (o.messages[0].content.includes("altra")) throw new Error("Ollama giù");
    return FIXED.trim();
  };
  const events = await syncVault(vault, out, { gen });
  assert.equal(events.find((e) => e.file === "Altra.md")?.action, "error");
  assert.equal(events.find((e) => e.file === "Corso/Parte 1.md")?.action, "corrected");
  assert.ok(!readState(out).files["Altra.md"], "rifatta alla prossima passata");
});
