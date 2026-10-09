import { test, before } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

let A: typeof import("@/lib/areas");
let E: typeof import("@/lib/errors");
let sqlite: import("better-sqlite3").Database;

before(async () => {
  ({ sqlite } = await useTempDb());
  A = await import("@/lib/areas");
  E = await import("@/lib/errors");
});

const isErr = (status: number) => (e: unknown) => e instanceof E.LibraryError && e.status === status;
const course = (name: string, areas: string[]) =>
  sqlite.prepare("INSERT INTO domains (name, kind, areas) VALUES (?, 'course', ?)").run(name, JSON.stringify(areas));

test("createArea: slug dal nome, default di simbolo e tagline, posizione in coda", () => {
  const a = A.createArea({ name: "  Sviluppo   Web " });
  assert.deepEqual(a, { slug: "sviluppo-web", name: "Sviluppo Web", tagline: "", symbol: "·", module: null, position: 0 });
  const b = A.createArea({ name: "Dati", symbol: "✦", tagline: "numeri e grafici" });
  assert.equal(b.position, 1);
  assert.equal(b.symbol, "✦");
});

test("createArea: nome vuoto, troppo lungo o già usato (anche con maiuscole diverse) ⇒ errore", () => {
  assert.throws(() => A.createArea({ name: "  " }), isErr(400));
  assert.throws(() => A.createArea({ name: "x".repeat(61) }), isErr(400));
  assert.throws(() => A.createArea({ name: "sviluppo web" }), isErr(409));
});

test("createArea: slug già preso da un altro nome ⇒ suffisso", () => {
  const a = A.createArea({ name: "Sviluppo-Web!" }); // slug base uguale a «Sviluppo Web»
  assert.equal(a.slug, "sviluppo-web-2");
});

test("simbolo e tagline: limiti", () => {
  assert.throws(() => A.createArea({ name: "S1", symbol: "abc" }), isErr(400));
  assert.equal(A.createArea({ name: "S2", symbol: "" }).symbol, "·");
  assert.equal(A.createArea({ name: "S3", symbol: "👩‍💻" }).symbol, "👩‍💻"); // un grafema solo
  assert.throws(() => A.createArea({ name: "S4", tagline: "t".repeat(141) }), isErr(400));
});

test("module: solo moduli registrati (registro vuoto in F2)", () => {
  assert.throws(() => A.createArea({ name: "Con modulo", module: "sf6" }), isErr(400));
  assert.equal(A.validateModule(null), null);
  assert.equal(A.validateModule(""), null);
  assert.equal(A.validateModule("x", { x: { title: "X", href: "/x" } }), "x");
  assert.throws(() => A.validateModule("y", { x: { title: "X", href: "/x" } }), isErr(400));
});

test("rinomina: lo slug resta, i corsi restano agganciati", () => {
  const a = A.createArea({ name: "Vecchio" });
  course("corso del vecchio", [a.slug]);
  const b = A.updateArea(a.slug, { name: "Nuovo", tagline: "ciao" });
  assert.equal(b.slug, a.slug);
  assert.equal(b.name, "Nuovo");
  assert.equal(b.tagline, "ciao");
  assert.equal(A.listAreas().find((x) => x.slug === a.slug)?.courses, 1);
  assert.throws(() => A.updateArea("non-esiste", { name: "x" }), isErr(404));
  assert.throws(() => A.updateArea(a.slug, { name: "dati" }), isErr(409)); // nome di un altro dominio
  A.updateArea(a.slug, { name: "NUOVO" }); // stesso dominio, solo maiuscole: ok
});

test("elimina: rifiutato se ci sono corsi (dice quanti), poi riesce", () => {
  const a = A.createArea({ name: "Da togliere" });
  const r1 = course("c1", [a.slug]);
  course("c2", ["altro", a.slug]);
  assert.throws(() => A.deleteArea(a.slug), (e: unknown) => isErr(409)(e) && /2 corsi/.test((e as Error).message));
  sqlite.prepare("UPDATE domains SET areas = '[]' WHERE id = ?").run(r1.lastInsertRowid);
  sqlite.prepare("UPDATE domains SET areas = '[\"altro\"]' WHERE name = 'c2'").run();
  A.deleteArea(a.slug);
  assert.equal(A.listAreas().some((x) => x.slug === a.slug), false);
  assert.throws(() => A.deleteArea(a.slug), isErr(404));
});

test("reorderAreas: permutazione completa, altrimenti errore", () => {
  const all = A.listAreas().map((a) => a.slug);
  const rev = [...all].reverse();
  A.reorderAreas(rev);
  assert.deepEqual(A.listAreas().map((a) => a.slug), rev);
  assert.throws(() => A.reorderAreas(rev.slice(1)), isErr(400));
  assert.throws(() => A.reorderAreas([...rev, "intruso"]), isErr(400));
  assert.throws(() => A.reorderAreas([rev[0], ...rev]), isErr(400));
  assert.throws(() => A.reorderAreas("no"), isErr(400));
});

test("assertAreasExist: slug sconosciuti nel messaggio", () => {
  A.assertAreasExist([]);
  assert.throws(() => A.assertAreasExist(["dati", "boh"]), (e: unknown) => isErr(400)(e) && /boh/.test((e as Error).message));
});

test("listAreas: conta i corsi anche con domains.areas malformato", () => {
  sqlite.prepare("INSERT INTO domains (name, kind, areas) VALUES ('rotto', 'course', 'non json')").run();
  assert.ok(A.listAreas().length > 0);
});

test("dominio usato solo da un corso dentro un macro: non conta, si elimina e viene tolto dal figlio", () => {
  const x = A.createArea({ name: "Solo nel macro" });
  const y = A.createArea({ name: "Su corso sciolto" });
  const m = sqlite.prepare("INSERT INTO domains (name, kind, areas) VALUES ('macroX', 'macro', '[]')").run();
  sqlite.prepare("INSERT INTO domains (name, kind, parent_id, areas) VALUES ('figlio', 'course', ?, ?)")
    .run(m.lastInsertRowid, JSON.stringify([x.slug, "altro"]));
  course("sciolto", [y.slug]);
  const courses = (s: string) => A.listAreas().find((a) => a.slug === s)?.courses;
  assert.equal(courses(x.slug), 0);
  assert.equal(courses(y.slug), 1);
  A.deleteArea(x.slug);
  const f = sqlite.prepare("SELECT areas FROM domains WHERE name = 'figlio'").get() as { areas: string };
  assert.deepEqual(JSON.parse(f.areas), ["altro"]);
  assert.throws(() => A.deleteArea(y.slug), isErr(409));
});

test("elimina con note: rifiutato (dice quante), listAreas conta le note; spostate le note riesce", async () => {
  const N = await import("@/lib/notes");
  const a = A.createArea({ name: "Con note" });
  const n1 = N.createNote({ content: "uno", domain: a.slug });
  N.createNote({ content: "due", domain: a.slug });
  assert.equal(A.listAreas().find((x) => x.slug === a.slug)?.notes, 2);
  assert.throws(() => A.deleteArea(a.slug), (e: unknown) => isErr(409)(e) && /2 note/.test((e as Error).message));
  N.moveNote(n1.id, {});
  sqlite.prepare("UPDATE notes SET domain = NULL WHERE domain = ?").run(a.slug);
  A.deleteArea(a.slug);
  assert.equal(A.listAreas().some((x) => x.slug === a.slug), false);
});
