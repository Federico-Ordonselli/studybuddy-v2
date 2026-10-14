import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { useTempDb } from "./helpers/db";
import { withJudge, verdictJson } from "./helpers/judge";

const { sqlite } = await useTempDb();
const study = await import("@/lib/lessonStudy");
const prompts = await import("@/lib/lessonPrompts");
const { ensureHubSchema } = await import("@/lib/db");
const { deleteDocumentChunks } = await import("@/lib/rag/store");
const cornellApi = await import("@/app/api/lessons/cornell/route");
const pretestApi = await import("@/app/api/lessons/pretest/route");
const lessonsApi = await import("@/app/api/lessons/route");

sqlite.prepare("INSERT INTO domains (id, name, kind) VALUES (1, 'Specializzazione', 'macro')").run();
sqlite.prepare("INSERT INTO domains (id, name, parent_id) VALUES (2, 'Corso A', 1), (3, 'Corso B', 1), (4, 'Altro corso', NULL)").run();
function lesson(id: number, courseId = 2) {
  sqlite.prepare("INSERT INTO documents (id, domain_id, title, kind, meta) VALUES (?, ?, ?, 'transcript', ?)")
    .run(id, courseId, `Lezione ${id}`, JSON.stringify({ module: "Modulo 1", lesson: `Lezione ${id}` }));
  sqlite.prepare("INSERT INTO chunks (id, document_id, ordinal, content) VALUES (?, ?, 0, ?)")
    .run(id * 10, id, `MATERIALE-LEZIONE-${id}: i concetti sono trattati qui, non altrove.`);
}
for (let i = 1; i <= 12; i++) lesson(i, i === 2 ? 3 : i === 3 ? 4 : 2);
const guide = Array.from({ length: 5 }, (_, i) => ({ question: `Che cosa significa il concetto ${i + 1}?`, answer: `Il concetto ${i + 1} descrive un fatto.`, source: 1 }));
const guideJson = JSON.stringify({ questions: guide });
const quiz = guide.slice(0, 3).map((q) => ({ type: "open", question: q.question, answer: q.answer, rationale: "Spiegazione breve." }));
const draftAnswers = guide.map(() => "Un appunto personale.");

test("lezioni: scope corso/macro, materiale non vuoto, inesistenti e fuori scope", () => {
  assert.ok(study.listLessons(1).some((l) => l.courseId === 3));
  assert.ok(study.listLessons(2).every((l) => l.courseId === 2));
  assert.ok(!study.listLessons(1).some((l) => l.courseId === 4));
  assert.throws(() => study.listLessons(999), /Corso non trovato/);
  assert.throws(() => study.getCornell(2, 2), /Lezione non trovata/);
  assert.match(study.readLesson(2, 1).text, /MATERIALE-LEZIONE-1:/);
  assert.throws(() => study.readLesson(2, 3), /Lezione non trovata/);
  sqlite.prepare("INSERT INTO documents (id, domain_id, title) VALUES (99, 2, 'Vuota')").run();
  assert.ok(!study.listLessons(2).some((l) => l.id === 99));
});

test("generazione Cornell: solo il documento scelto, attese private, ripresa senza nuove chiamate", async () => {
  const bodies: Record<string, unknown>[] = [];
  const work = await withJudge([guideJson], () => study.startCornell(1, 1), bodies);
  assert.equal(work.questions.length, 5);
  assert.equal(work.noteId, null);
  assert.ok(!JSON.stringify(work).includes("descrive un fatto"));
  assert.ok(JSON.stringify(bodies).includes("MATERIALE-LEZIONE-1:"));
  assert.ok(!JSON.stringify(bodies).includes("MATERIALE-LEZIONE-2:"));
  assert.deepEqual(await withJudge([], () => study.startCornell(2, 1), bodies), work);
  assert.equal(bodies.length, 1);
});

test("salvataggio: nota del corso foglia, update della stessa nota, revisione e conflitto senza perdita", () => {
  const saved = study.saveCornell(1, 1, study.getCornell(1, 1)!.revision, draftAnswers, "Il riassunto personale.");
  const note = () => sqlite.prepare("SELECT * FROM notes WHERE id = ?").get(saved.noteId!) as { content: string; course_id: number };
  assert.equal(note().course_id, 2);
  assert.match(note().content, /Il riassunto personale/);
  const again = study.saveCornell(1, 1, saved.revision, draftAnswers, "Un nuovo riassunto.");
  assert.equal(again.noteId, saved.noteId);
  assert.match(note().content, /Un nuovo riassunto/);
  assert.throws(() => study.saveCornell(1, 1, saved.revision, draftAnswers, "Bozza obsoleta"), /altra scheda/);
  assert.match(note().content, /Un nuovo riassunto/);
  assert.throws(() => study.saveCornell(1, 1, again.revision, [], "x"), /ogni domanda/);
  assert.throws(() => study.saveCornell(1, 1, again.revision, draftAnswers, "x".repeat(2001)), /Riassunto non valido/);
});

test("verifica: giudice con sorgente della lezione, feedback salvato, nessun FSRS, invalidato alla modifica", async () => {
  const w = await withJudge([guideJson], () => study.startCornell(2, 4));
  const bodies: Record<string, unknown>[] = [];
  const checked = await withJudge([verdictJson("partial", { present: ["Un fatto"], missing: ["Un rapporto"], errors: ["Un errore"] })],
    () => study.checkCornell(2, 4, w.revision, draftAnswers, "Riassunto breve."), bodies);
  assert.equal(checked.grade?.verdict, "partial");
  const note = sqlite.prepare("SELECT content FROM notes WHERE id = ?").get(checked.noteId!) as { content: string };
  assert.match(note.content, /Punti coperti: Un fatto/);
  assert.ok(JSON.stringify(bodies).includes("MATERIALE-LEZIONE-4:"));
  assert.deepEqual(study.getCornell(2, 4), checked);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM review_logs").get() as { n: number }).n, 0);
  const changed = study.saveCornell(2, 4, checked.revision, draftAnswers, "Riassunto cambiato.");
  assert.equal(changed.grade, null);
});

test("modello invalido: nessuna attività o nota finta, errore di verifica conserva lo stato", async () => {
  await assert.rejects(withJudge(["{}"], () => study.startCornell(2, 5)), /domande guida valide/);
  assert.equal(study.getCornell(2, 5), null);
  const w = await withJudge([guideJson], () => study.startCornell(2, 5));
  const saved = study.saveCornell(2, 5, w.revision, draftAnswers, "Riassunto valido.");
  await assert.rejects(withJudge(["{}"], () => study.checkCornell(2, 5, saved.revision, draftAnswers, "Nuova bozza.")), /valutazione valida/);
  assert.deepEqual(study.getCornell(2, 5), saved);
});

test("carte: serve l'appunto salvato; fonte della lezione, anteprima e nessun salvataggio automatico", async () => {
  const w = await withJudge([guideJson], () => study.startCornell(2, 6));
  assert.throws(() => study.cornellCard(2, 6, w.revision, 0), /Scrivi e salva/);
  const saved = study.saveCornell(2, 6, w.revision, draftAnswers, "");
  const card = study.cornellCard(1, 6, saved.revision, 0);
  assert.equal(card.sourceChunkId, 60);
  assert.equal(card.answer, guide[0].answer);
  assert.ok(Array.isArray(card.issues));
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM cards").get() as { n: number }).n, 0);
  assert.throws(() => study.cornellCard(2, 6, saved.revision, -1), /Domanda non valida/);
});

test("pretest: tre domande senza attese; reveal dopo tre tentativi, nessun giudice/carte/log", async () => {
  const bodies: Record<string, unknown>[] = [];
  const w = await withJudge([JSON.stringify({ questions: quiz })], () => study.startPretest(1, 7), bodies);
  assert.equal(w.questions.length, 3);
  assert.ok(!JSON.stringify(w).includes("descrive un fatto"));
  assert.ok(JSON.stringify(bodies).includes("MATERIALE-LEZIONE-7:"));
  assert.throws(() => study.revealPretest(2, 7, w.revision, ["", "non so", "non so"]), /risposta/);
  assert.throws(() => study.revealPretest(4, 7, w.revision, ["non so", "non so", "non so"]), /Lezione non trovata/);
  const r = study.revealPretest(2, 7, w.revision, ["non so", "Un tentativo", "non so"]);
  assert.equal(r.references[0].answer, quiz[0].answer);
  await withJudge([], () => study.startPretest(2, 7), bodies);
  assert.equal(bodies.length, 1);
  for (const table of ["cards", "review_logs", "sessions"]) assert.equal((sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
});

test("pretest invalido o duplicato: errore, nessuna attività salvata", async () => {
  await assert.rejects(withJudge([JSON.stringify({ questions: [quiz[0], quiz[0], quiz[0]] })], () => study.startPretest(2, 8)), /tre domande valide/);
  assert.equal(sqlite.prepare("SELECT 1 FROM lesson_studies WHERE document_id = 8").get(), undefined);
  await assert.rejects(withJudge([JSON.stringify({ questions: quiz.map((q) => ({ ...q, rationale: {} })) })], () => study.startPretest(2, 8)), /tre domande valide/);
  assert.equal(sqlite.prepare("SELECT 1 FROM lesson_studies WHERE document_id = 8").get(), undefined);
});

test("re-ingest invalida l'attività e preserva la nota; ricrea dopo eliminazione della nota", async () => {
  const w = await withJudge([guideJson], () => study.startCornell(2, 9));
  const saved = study.saveCornell(2, 9, w.revision, draftAnswers, "Riassunto da conservare.");
  deleteDocumentChunks(9);
  assert.equal(study.getCornell(2, 9), null);
  assert.ok(sqlite.prepare("SELECT 1 FROM notes WHERE id = ?").get(saved.noteId!));
  sqlite.prepare("INSERT INTO chunks (document_id, ordinal, content) VALUES (9, 0, 'Materiale aggiornato')").run();
  const regenerated = await withJudge([guideJson], () => study.startCornell(2, 9));
  assert.notEqual(regenerated.revision, saved.revision);
  assert.throws(() => study.saveCornell(2, 9, saved.revision, draftAnswers, "Bozza precedente"), /altra scheda/);
  const before = study.getCornell(2, 6)!;
  sqlite.prepare("DELETE FROM notes WHERE id = ?").run(before.noteId!);
  assert.equal(study.getCornell(2, 6)!.noteId, null);
  const after = study.saveCornell(2, 6, before.revision, draftAnswers, "");
  assert.ok(after.noteId);
});

test("migrazione idempotente e schema allineato", () => {
  const before = sqlite.prepare("SELECT count(*) AS n FROM lesson_studies").get();
  ensureHubSchema(); ensureHubSchema();
  assert.deepEqual(sqlite.prepare("SELECT count(*) AS n FROM lesson_studies").get(), before);
});

test("materiale cambiato durante la generazione: nessun esercizio con passaggi obsoleti", async () => {
  await withJudge([guideJson], async () => {
    const pending = study.startCornell(2, 10);
    sqlite.prepare("UPDATE chunks SET content = 'Materiale cambiato durante la chiamata' WHERE document_id = 10").run();
    await assert.rejects(pending, /materiale della lezione è cambiato/);
  });
  assert.equal(study.getCornell(2, 10), null);
});

test("verifica concorrente a un salvataggio: non sovrascrive la nota più recente", async () => {
  const w = await withJudge([guideJson], () => study.startCornell(2, 11));
  const saved = study.saveCornell(2, 11, w.revision, draftAnswers, "Riassunto iniziale.");
  await withJudge([verdictJson("correct")], async () => {
    const pending = study.checkCornell(2, 11, saved.revision, draftAnswers, "Riassunto da valutare.");
    study.saveCornell(2, 11, saved.revision, draftAnswers, "Riassunto da un'altra scheda.");
    await assert.rejects(pending, /altra scheda/);
  });
  assert.equal(study.getCornell(2, 11)!.summary, "Riassunto da un'altra scheda.");
  assert.equal(study.getCornell(2, 11)!.grade, null);
});

test("parser Cornell e budget: nomi mancanti, duplicati e fonte invalida scartati; selezione copre inizio/fine", () => {
  const passages = [{ chunkId: 1, content: "Fonte" }];
  const withCites = guide.map((q) => ({ ...q, answer: `${q.answer} [1]` }));
  assert.equal(prompts.parseGuide(JSON.stringify({ questions: withCites }), passages)![0].answer, guide[0].answer);
  assert.equal(prompts.parseGuide(JSON.stringify({ questions: guide.map((q) => ({ ...q, answer: "[1]" })) }), passages), null);
  assert.equal(prompts.parseGuide(JSON.stringify({ questions: guide.map((q) => ({ ...q, source: 2 })) }), passages), null);
  assert.equal(prompts.parseGuide(JSON.stringify({ questions: guide.map(() => guide[0]) }), passages), null);
  assert.equal(prompts.parseGuide(JSON.stringify({ questions: [{ ...guide[0], question: "Secondo il testo, cosa succede?" }, ...guide.slice(1)] }), passages), null);
  const selection = prompts.lessonPassages(Array.from({ length: 30 }, (_, i) => ({ chunkId: i, content: "x".repeat(3000) })));
  assert.equal(selection.partial, true);
  assert.equal(selection.passages[0].chunkId, 0);
  assert.equal(selection.passages.at(-1)!.chunkId, 29);
  assert.ok(selection.passages.reduce((n, p) => n + p.content.length, 0) <= 24000);
});

test("API: JSON malformato, id non validi, azione sconosciuta e lezioni scoped", async () => {
  for (const api of [cornellApi, pretestApi]) {
    const malformed = await api.POST(new NextRequest("http://localhost/api/lessons", { method: "POST", body: "{" }));
    assert.equal(malformed.status, 400);
    const invalid = await api.POST(new NextRequest("http://localhost/api/lessons", { method: "POST", body: JSON.stringify({ domainId: 2, documentId: 1, action: "bad" }) }));
    assert.equal(invalid.status, 400);
    const outOfScope = await api.POST(new NextRequest("http://localhost/api/lessons", { method: "POST", body: JSON.stringify({ domainId: 4, documentId: 1, action: "start" }) }));
    assert.equal(outOfScope.status, 404);
  }
  const response = lessonsApi.GET(new NextRequest("http://localhost/api/lessons?domainId=4"));
  const json = await response.json();
  assert.ok(json.lessons.every((l: { courseId: number }) => l.courseId === 4));
  assert.equal(lessonsApi.GET(new NextRequest("http://localhost/api/lessons?domainId=-1")).status, 400);
});

test("DB precedente: crea lesson_studies senza modificare le note esistenti", () => {
  const notesBefore = sqlite.prepare("SELECT * FROM notes ORDER BY id").all();
  sqlite.exec("DROP TABLE lesson_studies");
  ensureHubSchema(); ensureHubSchema();
  const keys = sqlite.prepare("PRAGMA foreign_key_list(lesson_studies)").all() as { table: string; on_delete: string }[];
  assert.ok(keys.some((k) => k.table === "documents" && k.on_delete === "CASCADE"));
  assert.ok(keys.some((k) => k.table === "notes" && k.on_delete === "SET NULL"));
  assert.deepEqual(sqlite.prepare("SELECT * FROM notes ORDER BY id").all(), notesBefore);
});
