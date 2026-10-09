import { test, before } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

let N: typeof import("@/lib/notes");
let A: typeof import("@/lib/areas");
let L: typeof import("@/lib/library");
let E: typeof import("@/lib/errors");
let sqlite: import("better-sqlite3").Database;
let macro: number, child: number, loose: number, other: number;

before(async () => {
  ({ sqlite } = await useTempDb());
  N = await import("@/lib/notes");
  A = await import("@/lib/areas");
  L = await import("@/lib/library");
  E = await import("@/lib/errors");
  A.createArea({ name: "Uno", symbol: "✦" }); // slug "uno"
  A.createArea({ name: "Due" });              // slug "due"
  macro = L.createMacro("Macro", ["uno"]);
  child = L.createCourse("Figlio", "/tmp/n/figlio", macro);
  loose = L.createCourse("Sciolto", "/tmp/n/sciolto", null, ["uno"]);
  other = L.createCourse("Altro", "/tmp/n/altro", null, ["due"]);
});

const isErr = (status: number) => (e: unknown) => e instanceof E.LibraryError && e.status === status;

test("createNote: inbox, dominio, corso; testo ripulito; etichetta della destinazione", () => {
  const a = N.createNote({ content: "  idea al volo  " });
  assert.equal(a.content, "idea al volo");
  assert.equal(a.domain, null);
  assert.equal(a.courseId, null);
  assert.equal(a.where, "Inbox");
  assert.ok(!Number.isNaN(Date.parse(a.createdAt)));
  assert.equal(N.createNote({ content: "d", domain: "uno" }).where, "✦ Uno");
  assert.equal(N.createNote({ content: "c", courseId: child }).where, "Figlio");
  assert.equal(N.createNote({ content: "vuoti = inbox", domain: "", courseId: null }).where, "Inbox");
});

test("validazione: vuota, solo spazi, troppo lunga, dominio o corso sconosciuto, entrambi ⇒ 400, niente salvato", () => {
  const count = () => (sqlite.prepare("SELECT count(*) AS n FROM notes").get() as { n: number }).n;
  const before = count();
  assert.throws(() => N.createNote({ content: "" }), isErr(400));
  assert.throws(() => N.createNote({ content: "   \n " }), isErr(400));
  assert.throws(() => N.createNote({ content: 42 }), isErr(400));
  assert.throws(() => N.createNote({ content: "x".repeat(10001) }), isErr(400));
  N.createNote({ content: "x".repeat(10000) }); // al limite: ok
  assert.throws(() => N.createNote({ content: "x", domain: "boh" }), isErr(400));
  assert.throws(() => N.createNote({ content: "x", courseId: 999999 }), isErr(400));
  assert.throws(() => N.createNote({ content: "x", courseId: "abc" }), isErr(400));
  assert.throws(() => N.createNote({ content: "x", domain: "uno", courseId: child }), isErr(400));
  assert.equal(count(), before + 1);
});

test("moveNote: dall'inbox a un dominio, a un corso, di nuovo all'inbox; id sconosciuto ⇒ 404", () => {
  const n = N.createNote({ content: "da spostare" });
  assert.equal(N.moveNote(n.id, { domain: "due" }).domain, "due");
  const c = N.moveNote(n.id, { courseId: loose });
  assert.deepEqual([c.domain, c.courseId], [null, loose]);
  assert.equal(N.moveNote(n.id, {}).where, "Inbox");
  assert.throws(() => N.moveNote(n.id, { domain: "uno", courseId: loose }), isErr(400));
  assert.throws(() => N.moveNote(424242, {}), isErr(404));
});

test("deleteNote e liste: inbox in ordine dal più recente, conteggio inbox", () => {
  const before = N.countInbox();
  const x = N.createNote({ content: "prima" });
  sqlite.prepare("UPDATE notes SET created_at = created_at - 100 WHERE id = ?").run(x.id);
  const y = N.createNote({ content: "dopo" });
  const inbox = N.listInbox();
  assert.ok(inbox.findIndex((n) => n.id === y.id) < inbox.findIndex((n) => n.id === x.id));
  assert.equal(N.countInbox(), before + 2);
  N.deleteNote(x.id);
  assert.equal(N.countInbox(), before + 1);
  assert.throws(() => N.deleteNote(x.id), isErr(404));
  assert.equal(N.listInbox(1).length, 1);
});

test("listForCourse: un corso vede le sue note; un macro anche quelle dei suoi corsi", () => {
  const onChild = N.createNote({ content: "sul figlio", courseId: child });
  const onMacro = N.createNote({ content: "sul macro", courseId: macro });
  assert.ok(N.listForCourse(child).some((n) => n.id === onChild.id));
  assert.ok(!N.listForCourse(child).some((n) => n.id === onMacro.id));
  const ids = N.listForCourse(macro).map((n) => n.id);
  assert.ok(ids.includes(onChild.id) && ids.includes(onMacro.id));
});

test("listForArea: note del dominio + note dei suoi corsi (anche figli di un macro del dominio), non quelle di altri", () => {
  const d = N.createNote({ content: "del dominio", domain: "uno" });
  const f = N.createNote({ content: "figlio del macro", courseId: child });
  const s = N.createNote({ content: "corso sciolto", courseId: loose });
  const o = N.createNote({ content: "altro dominio", courseId: other });
  const i = N.createNote({ content: "inbox" });
  const ids = N.listForArea("uno").map((n) => n.id);
  for (const n of [d, f, s]) assert.ok(ids.includes(n.id), n.content);
  for (const n of [o, i]) assert.ok(!ids.includes(n.id), n.content);
});

test("listInbox senza limite restituisce tutta l'inbox (oltre 50 note); con limite lo rispetta", () => {
  for (let i = 0; i < 55; i++) N.createNote({ content: `bulk ${i}` });
  assert.equal(N.listInbox().length, N.countInbox());
  assert.ok(N.listInbox().length > 50);
  assert.equal(N.listInbox(2).length, 2);
});
