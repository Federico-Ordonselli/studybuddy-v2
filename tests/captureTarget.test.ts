import { test } from "node:test";
import assert from "node:assert/strict";
import { captureTarget, noteBody } from "@/lib/client/captureTarget";

const areas = [{ slug: "uno", module: null }, { slug: "gioco", module: "mod" }];
const modules = { mod: { title: "Modulo", href: "/mod" } };

test("captureTarget: studio → corso, pagina dominio → dominio, route di un modulo → il suo dominio, altrove → inbox", () => {
  assert.deepEqual(captureTarget("/study/12", areas, modules), { kind: "course", id: 12 });
  assert.deepEqual(captureTarget("/study/12/qualcosa", areas, modules), { kind: "course", id: 12 });
  assert.deepEqual(captureTarget("/d/uno", areas, modules), { kind: "area", slug: "uno" });
  assert.deepEqual(captureTarget("/d/sconosciuto", areas, modules), { kind: "inbox" });
  assert.deepEqual(captureTarget("/mod", areas, modules), { kind: "area", slug: "gioco" });
  assert.deepEqual(captureTarget("/mod/combo/3", areas, modules), { kind: "area", slug: "gioco" });
  assert.deepEqual(captureTarget("/moderno", areas, modules), { kind: "inbox" }); // solo prefisso di segmento
  for (const p of ["/", "/corsi", "/corsi/add", "/settings", "/study/abc"]) assert.deepEqual(captureTarget(p, areas, modules), { kind: "inbox" }, p);
});

test("captureTarget: un modulo sconosciuto o ereditato dal prototipo non conta", () => {
  assert.deepEqual(captureTarget("/x", [{ slug: "a", module: "constructor" }], modules), { kind: "inbox" });
});

test("noteBody: corpo per POST /api/notes", () => {
  assert.deepEqual(noteBody("t", { kind: "inbox" }), { content: "t", domain: null, courseId: null });
  assert.deepEqual(noteBody("t", { kind: "area", slug: "uno" }), { content: "t", domain: "uno", courseId: null });
  assert.deepEqual(noteBody("t", { kind: "course", id: 4 }), { content: "t", domain: null, courseId: 4 });
});
