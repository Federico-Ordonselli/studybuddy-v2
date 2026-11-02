import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTempDb } from "./helpers/db";
import { makeTree } from "./helpers/fs";

let S: typeof import("@/lib/studio");
let C: typeof import("@/lib/rag/sources/coursera");
let L: typeof import("@/lib/library");
let sqlite: import("better-sqlite3").Database;
let dir: string;

const seg = (id: string, extra: object = {}) => ({ id, text: `Testo ${id}`, audio: `audio/part9/${id}.mp3`, duration: 2, ...extra });
const LESSON = {
  part: 9, title: "Capitolo 1", subtitle: "Sistemi",
  codeBlocks: { "p9-c001": { lang: "text", code: "riga 1\nriga 2" } },
  chapters: [
    { id: "p9-ch01", title: "Sistemi", quiz: [{ q: "Domanda di capitolo?", options: ["a", "b"], answer: 0, why: "perché" }], sections: [
      { id: "p9-ch01-s01", title: "Introduzione", segments: [seg("p9-ch01-s01-001"), seg("p9-ch01-s01-002", { code: { ref: "p9-c001", highlight: [1, 1] } })] },
      { id: "p9-ch01-s02", title: "Hardware", segments: [seg("p9-ch01-s02-001")] },
    ] },
    { id: "p9-ch02", title: "Von Neumann", sections: [
      { id: "p9-ch02-s01", title: "Modello", segments: [seg("p9-ch02-s01-001")] },
    ] },
  ],
};
const q = (text: string) => ({ q: text, options: ["giusta", "sbagliata 1", "sbagliata 2"], answer: 0, why: "spiegazione" });
const STUDY = {
  version: 1,
  sections: {
    "p9-ch01-s01": { cards: [{ q: "Che cos'è un sistema informatico?", a: "Hardware e software connessi in rete." }], quiz: [q("Q s01 a"), q("Q s01 b")] },
    "p9-ch01-s02": { cards: [{ q: "Che cosa comprende l'hardware di un computer?", a: "I dispositivi fisici." }], quiz: [q("Q s02")] },
    "p9-ch02-s01": { cards: [{ q: "Chi definì il modello concettuale dell'ENIAC?", a: "John von Neumann." }], quiz: [q("Q ch02")] },
  },
};

before(async () => {
  ({ sqlite, dir } = await useTempDb());
  S = await import("@/lib/studio");
  C = await import("@/lib/rag/sources/coursera");
  L = await import("@/lib/library");
});

function course(name: string, study: object | null = STUDY) {
  const root = path.join(dir, name);
  makeTree(root, {
    "01_Capitolo/studio/lesson.json": JSON.stringify(LESSON),
    "01_Capitolo/studio/audio/part9/p9-ch01-s01-001.mp3": "ID3",
    ...(study ? { "01_Capitolo/studio/study.json": JSON.stringify(study) } : {}),
  });
  return { root, id: L.createCourse(name, root, null), lessonPath: path.join(root, "01_Capitolo/studio/lesson.json") };
}

const lessonIdOf = (p: string) => (sqlite.prepare("SELECT id FROM studio_lessons WHERE path = ?").get(p) as { id: number }).id;
const cardsOf = (lessonId: number) => sqlite.prepare("SELECT question, suspended, studio_section AS s FROM cards WHERE studio_section LIKE ? ORDER BY id").all(`${lessonId}:%`) as { question: string; suspended: number; s: string }[];

test("parseLesson: rifiuta codice mancante e id duplicati, accetta la forma della pipeline", () => {
  assert.equal(S.parseLesson(LESSON).chapters.length, 2);
  const missing = structuredClone(LESSON);
  (missing.chapters[0].sections[0].segments[1] as { code: { ref: string } }).code.ref = "p9-c999";
  assert.throws(() => S.parseLesson(missing), /mancante/);
  const dup = structuredClone(LESSON);
  dup.chapters[1].sections[0].id = "p9-ch01-s01";
  assert.throws(() => S.parseLesson(dup), /duplicato/);
});

test("parseStudy: sezione sconosciuta o risposta fuori dalle opzioni = errore", () => {
  const lesson = S.parseLesson(LESSON);
  assert.throws(() => S.parseStudy({ version: 1, sections: { "p9-ch09-s01": {} } }, lesson), /sconosciuta/);
  assert.throws(() => S.parseStudy({ version: 1, sections: { "p9-ch01-s01": { quiz: [{ q: "x", options: ["a", "b"], answer: 2, why: "" }] } } }, lesson), /risposta/);
});

test("classify: solo studio/lesson.json è un pacchetto; .md è markdown", () => {
  assert.equal(C.classify("/c/m/studio/lesson.json"), "studio");
  assert.equal(C.classify("/c/m/lesson.json"), "skip");
  assert.equal(C.classify("/c/m/Capitolo_01.md"), "markdown");
});

test("ingestCourse registra la lezione: domande nel DB, carte bloccate; re-ingest invariato non duplica", async () => {
  const c = course("Corso A");
  const stats = await C.ingestCourse(c.root, c.id);
  assert.equal(stats.studioLessons, 1);
  assert.equal(stats.documents, 0); // il pacchetto non genera chunk
  const id = lessonIdOf(c.lessonPath);
  const quiz = (sqlite.prepare("SELECT count(*) AS n FROM studio_quiz WHERE lesson_id = ?").get(id) as { n: number }).n;
  assert.equal(quiz, 5); // 4 di sezione + 1 di fine capitolo
  assert.deepEqual(cardsOf(id).map((x) => x.suspended), [1, 1, 1]);
  const again = await C.ingestCourse(c.root, c.id);
  assert.equal(again.unchanged, 1);
  assert.equal(cardsOf(id).length, 3);
});

test("study.json modificato: il re-ingest importa la carta nuova senza duplicare le altre", async () => {
  const c = course("Corso B");
  await C.ingestCourse(c.root, c.id);
  const next = structuredClone(STUDY);
  next.sections["p9-ch01-s02"].cards.push({ q: "Che cosa comprende il software di un computer?", a: "Programmi, dati e istruzioni." });
  fs.writeFileSync(path.join(c.root, "01_Capitolo/studio/study.json"), JSON.stringify(next));
  const stats = await C.ingestCourse(c.root, c.id);
  assert.equal(stats.studioLessons, 1);
  assert.equal(cardsOf(lessonIdOf(c.lessonPath)).length, 4);
});

test("saveState: completare una sezione sblocca le sue carte; le sospese a mano restano sospese", async () => {
  const c = course("Corso C");
  await C.ingestCourse(c.root, c.id);
  const id = lessonIdOf(c.lessonPath);
  const r = await S.saveState(id, { segmentId: "p9-ch01-s02-001", offset: 1, rate: 1.25, completedSections: ["p9-ch01-s01", "inventata"] });
  assert.equal(r.unlocked, 1);
  assert.deepEqual(r.state.completedSections, ["p9-ch01-s01"]);
  assert.deepEqual(cardsOf(id).map((x) => x.suspended), [0, 1, 1]);
  sqlite.prepare("UPDATE cards SET suspended = 1 WHERE studio_section = ?").run(`${id}:p9-ch01-s01`);
  // Il client rimanda sempre l'elenco completo: le sezioni già completate non si risbloccano.
  const again = await S.saveState(id, { segmentId: "p9-ch01-s02-001", offset: 0, completedSections: ["p9-ch01-s01"] });
  assert.equal(again.unlocked, 0);
  assert.equal(cardsOf(id)[0].suspended, 1);
  // Un elenco più corto non cancella le sezioni già completate.
  const shorter = await S.saveState(id, { completedSections: [] });
  assert.deepEqual(shorter.state.completedSections, ["p9-ch01-s01"]);
  assert.equal(shorter.state.segmentId, "p9-ch01-s02-001");
});

test("importare dopo aver ascoltato: le carte nuove delle sezioni completate nascono sbloccate", async () => {
  const c = course("Corso D", null);
  await C.ingestCourse(c.root, c.id);
  const id = lessonIdOf(c.lessonPath);
  await S.saveState(id, { completedSections: ["p9-ch01-s01"] });
  fs.writeFileSync(path.join(c.root, "01_Capitolo/studio/study.json"), JSON.stringify(STUDY));
  await C.ingestCourse(c.root, c.id);
  assert.deepEqual(cardsOf(id).map((x) => x.suspended), [0, 1, 1]);
});

test("quizPool: solo sezioni completate, metà dalle ultime due, opzioni rimescolate con la risposta giusta", async () => {
  const c = course("Corso E");
  await C.ingestCourse(c.root, c.id);
  const id = lessonIdOf(c.lessonPath);
  assert.deepEqual(await S.quizPool(id, 10), []);
  await S.saveState(id, { completedSections: ["p9-ch01-s01"] });
  const first = await S.quizPool(id, 10);
  assert.deepEqual(first.map((x) => x.q).sort(), ["Q s01 a", "Q s01 b"]);
  await S.saveState(id, { completedSections: ["p9-ch01-s01", "p9-ch01-s02", "p9-ch02-s01"] });
  const two = await S.quizPool(id, 2);
  // ultime due sezioni completate: s02 del capitolo 1 (con il quiz di capitolo) e ch02-s01
  assert.equal(two.filter((x) => ["p9-ch01-s02", "p9-ch02-s01"].includes(x.sectionId)).length, 1);
  for (const x of await S.quizPool(id, 50)) assert.equal(x.options[x.answer], x.q === "Domanda di capitolo?" ? "a" : "giusta");
  assert.ok((await S.quizPool(id, 50)).every((x) => x.sectionTitle));
});

test("audioFile: solo .mp3 dentro studio/, niente percorsi che escono", async () => {
  const c = course("Corso F");
  await C.ingestCourse(c.root, c.id);
  const id = lessonIdOf(c.lessonPath);
  assert.ok((await S.audioFile(id, "audio/part9/p9-ch01-s01-001.mp3"))?.endsWith("p9-ch01-s01-001.mp3"));
  assert.equal(await S.audioFile(id, "audio/part9/assente.mp3"), null);
  assert.equal(await S.audioFile(id, "../study.json"), null);
  assert.equal(await S.audioFile(id, "../../../../etc/passwd.mp3"), null);
  assert.equal(await S.audioFile(id, "/etc/x.mp3"), null);
});

test("listLessons: avanzamento e carte sbloccate per lezione", async () => {
  const c = course("Corso G");
  await C.ingestCourse(c.root, c.id);
  const id = lessonIdOf(c.lessonPath);
  await S.saveState(id, { completedSections: ["p9-ch01-s01"] });
  const row = S.listLessons().find((l) => l.id === id)!;
  assert.equal(row.courseName, "Corso G");
  assert.equal(row.sections, 3);
  assert.equal(row.completed, 1);
  assert.equal(row.cardsTotal, 3);
  assert.equal(row.cardsUnlocked, 1);
});
