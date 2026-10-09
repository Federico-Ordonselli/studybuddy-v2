import { test, before } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

let L: typeof import("@/lib/library");
let A: typeof import("@/lib/areas");
let sqlite: import("better-sqlite3").Database;

before(async () => {
  ({ sqlite } = await useTempDb());
  L = await import("@/lib/library");
  A = await import("@/lib/areas");
  A.createArea({ name: "Web" });
  A.createArea({ name: "Data" });
});

const now = () => Math.floor(Date.now() / 1000);

test("getLibrary: macro con figli, corsi sciolti, carte in scadenza aggregate", () => {
  const m = L.createMacro("Specializzazione X", ["web"]);
  const a = L.createCourse("Corso A", "/tmp/x/a", m);
  const b = L.createCourse("Corso B", "/tmp/b", null, ["data", "web"]);
  sqlite.prepare("INSERT INTO cards (domain_id, question, answer, due_at) VALUES (?, 'q', 'a', ?)").run(a, now() - 10);
  sqlite.prepare("INSERT INTO cards (domain_id, question, answer, due_at) VALUES (?, 'q', 'a', ?)").run(a, now() + 86400);
  const lib = L.getLibrary();
  const macro = lib.macros.find((x) => x.id === m)!;
  assert.equal(macro.courses.length, 1);
  assert.equal(macro.courses[0].id, a);
  assert.equal(macro.due, 1);
  assert.ok(lib.loose.some((c) => c.id === b));
  assert.deepEqual(lib.areas.map((a) => a.slug), ["web", "data"]); // ordine dei domini (position)
  assert.equal(lib.areas.find((a) => a.slug === "web")?.courses, 2);
});

test("getTrail: corso dentro macro, macro con i suoi corsi, id sconosciuto", () => {
  const m = L.createMacro("Macro T");
  const c = L.createCourse("Corso T", "/tmp/t", m);
  assert.deepEqual(L.getTrail(c)?.macro, { id: m, name: "Macro T" });
  assert.equal(L.getTrail(m)?.kind, "macro");
  assert.deepEqual(L.getTrail(m)?.courses, [{ id: c, name: "Corso T" }]);
  assert.equal(L.getTrail(999999), null);
});

test("invarianti: niente macro dentro macro, niente corso dentro corso", () => {
  const m1 = L.createMacro("M1");
  const m2 = L.createMacro("M2");
  const c = L.createCourse("C", "/tmp/c", null);
  assert.throws(() => L.updateDomain(m1, { parentId: m2 }), L.LibraryError);
  const c2 = L.createCourse("C2", "/tmp/c2", null);
  assert.throws(() => L.updateDomain(c2, { parentId: c }), L.LibraryError);
  L.updateDomain(c, { parentId: m1 });
  L.updateDomain(c, { parentId: null });
  assert.equal(L.findByPath("/tmp/c")?.parentId, null);
});

test("nome e domini: validazione; solo slug esistenti", () => {
  const c = L.createCourse("Nome", "/tmp/n", null);
  assert.throws(() => L.updateDomain(c, { name: "   " }), L.LibraryError);
  L.updateDomain(c, { name: "  Nuovo   nome ", areas: [" web ", "web", "data"] });
  const d = L.findByPath("/tmp/n")!;
  assert.equal(d.name, "Nuovo nome");
  assert.deepEqual(d.areas, ["web", "data"]);
  assert.throws(() => L.updateDomain(c, { areas: ["Web"] }), L.LibraryError);      // un nome, non uno slug
  assert.throws(() => L.updateDomain(c, { areas: ["sconosciuto"] }), L.LibraryError); // slug che non esiste
  assert.throws(() => L.updateDomain(c, { areas: [3] }), L.LibraryError);
  assert.throws(() => L.createCourse("X", "/tmp/x2", null, ["boh"]), L.LibraryError);
  assert.throws(() => L.createMacro("MX", ["boh"]), L.LibraryError);
  assert.deepEqual(L.findByPath("/tmp/n")!.areas, ["web", "data"]); // invariato
});

test("createMacro con corsi dentro; deleteMacro rende sciolti i figli", () => {
  const c = L.createCourse("Figlio", "/tmp/f", null);
  const m = L.createMacro("Da eliminare", [], [c]);
  assert.equal(L.findByPath("/tmp/f")?.parentId, m);
  L.deleteMacro(m);
  assert.equal(L.findByPath("/tmp/f")?.parentId, null);
  assert.equal(L.getTrail(m), null);
});

test("deleteMacro bloccato se il macro ha carte/mappe/sessioni proprie; vietato sui corsi", () => {
  const m = L.createMacro("Con sessione");
  sqlite.prepare("INSERT INTO sessions (domain_id, mode) VALUES (?, 'socratic')").run(m);
  assert.throws(() => L.deleteMacro(m), (e: unknown) => e instanceof L.LibraryError && e.status === 409);
  const c = L.createCourse("Corso", "/tmp/cc", null);
  assert.throws(() => L.deleteMacro(c), L.LibraryError);
});

test("id inesistente → LibraryError 404", () => {
  assert.throws(() => L.updateDomain(424242, { name: "x" }), (e: unknown) => e instanceof L.LibraryError && e.status === 404);
});
