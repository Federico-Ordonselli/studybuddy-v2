import { test, before } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

let H: typeof import("@/lib/home");
let sqlite: import("better-sqlite3").Database;
let a: number, b: number, c: number;
const now = () => Math.floor(Date.now() / 1000);

before(async () => {
  ({ sqlite } = await useTempDb());
  H = await import("@/lib/home");
  const L = await import("@/lib/library");
  const A = await import("@/lib/areas");
  const N = await import("@/lib/notes");
  A.createArea({ name: "Primo", symbol: "✦" });
  A.createArea({ name: "Secondo" });
  a = L.createCourse("Alfa", "/tmp/h/a", null);
  b = L.createCourse("Beta", "/tmp/h/b", null);
  c = L.createCourse("Gamma", "/tmp/h/c", null);
  const card = sqlite.prepare("INSERT INTO cards (domain_id, question, answer, due_at) VALUES (?, 'q', 'a', ?)");
  card.run(a, now() - 10); card.run(b, now() - 10); card.run(b, now() - 20); card.run(c, now() + 86400);
  const sess = sqlite.prepare("INSERT INTO sessions (domain_id, mode, created_at, updated_at) VALUES (?, 'socratic', ?, ?)");
  sess.run(a, now() - 5000, null);          // solo created_at (riga di prima della F3)
  sess.run(b, now() - 9000, now() - 100);   // ripresa di recente
  sess.run(c, now() - 3000, null);
  sess.run(null, now(), now());             // sessione senza dominio: ignorata
  N.createNote({ content: "inbox 1" }); N.createNote({ content: "inbox 2" }); N.createNote({ content: "dominio", domain: "primo" });
});

test("dueByDomain: solo carte scadute, per dominio, dal più carico", () => {
  assert.deepEqual(H.dueByDomain().map((d) => [d.name, d.due]), [["Beta", 2], ["Alfa", 1]]);
  assert.equal(H.dueTotal(), 3);
});

test("recentCourses: ultima attività per corso (updated_at, altrimenti created_at), dal più recente", () => {
  assert.deepEqual(H.recentCourses().map((r) => r.name), ["Beta", "Gamma", "Alfa"]);
  assert.deepEqual(H.recentCourses(2).map((r) => r.name), ["Beta", "Gamma"]);
  assert.ok(!Number.isNaN(Date.parse(H.recentCourses()[0].lastAt)));
});

test("getShellData: domini in ordine, corsi per nome, carte in scadenza, note in inbox", () => {
  const s = H.getShellData();
  assert.deepEqual(s.areas.map((x) => [x.slug, x.symbol]), [["primo", "✦"], ["secondo", "·"]]);
  assert.deepEqual(s.courses.map((x) => x.name), ["Alfa", "Beta", "Gamma"]);
  assert.equal(s.dueTotal, 3);
  assert.equal(s.inboxCount, 2);
});
