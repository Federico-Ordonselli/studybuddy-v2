import { test, before } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import { LibraryError } from "@/lib/errors";

let S: typeof import("@/lib/sf6/store");
let sqlite: import("better-sqlite3").Database;
before(async () => {
  ({ sqlite } = await useTempDb());
  S = await import("@/lib/sf6/store");
});
const err = (status: number) => (e: unknown) => e instanceof LibraryError && e.status === status;

test("combo: creazione con valori ripuliti, drive limitato a 6, stato di default", () => {
  const c = S.createCombo({ character_slug: "ryu", notation: " cr.MK > 236HP ", situation: "  ", damage: 2100, drive_cost: 9 });
  assert.equal(c.notation, "cr.MK > 236HP");
  assert.equal(c.situation, null);
  assert.equal(c.status, "learning");
  assert.equal(c.damage, 2100);
  assert.equal(c.driveCost, 6);
  assert.match(c.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("combo: input non validi ⇒ 400", () => {
  assert.throws(() => S.createCombo({ character_slug: "nessuno", notation: "5LP" }), err(400));
  assert.throws(() => S.createCombo({ character_slug: "ryu", notation: "  " }), err(400));
  assert.throws(() => S.createCombo({ character_slug: "ryu", notation: "5LP", damage: "abc" }), err(400));
  assert.throws(() => S.createCombo({ character_slug: "ryu", notation: "5LP", damage: -1 }), err(400));
  assert.throws(() => S.createCombo({ character_slug: "ryu", notation: "5LP", status: "boh" }), err(400));
});

test("combo PATCH: aggiorna, svuota con null o stringa vuota, 400 senza campi, 404 se manca", () => {
  const c = S.createCombo({ character_slug: "ken", notation: "5LP", situation: "corner", damage: 1000, notes: "n" });
  const u = S.updateCombo(c.id, { status: "practicing", situation: null, damage: "", notes: "" });
  assert.equal(u.status, "practicing");
  assert.equal(u.situation, null);
  assert.equal(u.damage, null);
  assert.equal(u.notes, null);
  assert.equal(u.notation, "5LP");
  assert.throws(() => S.updateCombo(c.id, {}), err(400));
  assert.throws(() => S.updateCombo(c.id, { damage: "x" }), err(400));
  assert.throws(() => S.updateCombo(c.id, { notation: "" }), err(400));
  assert.throws(() => S.updateCombo(999999, { notes: "x" }), err(404));
  assert.throws(() => S.updateCombo("abc", { notes: "x" }), err(400));
});

test("combo: elenco per personaggio (più recenti prima), conteggi, recenti, eliminazione", () => {
  const a = S.createCombo({ character_slug: "cammy", notation: "2LK" });
  const b = S.createCombo({ character_slug: "cammy", notation: "2MK" });
  assert.deepEqual(S.listCombos("cammy").map((c) => c.id), [b.id, a.id]);
  assert.equal(S.comboCounts().cammy, 2);
  assert.equal(S.recentCombos(1)[0].id, b.id);
  S.deleteCombo(a.id);
  S.deleteCombo(a.id); // idempotente
  assert.deepEqual(S.listCombos("cammy").map((c) => c.id), [b.id]);
  assert.throws(() => S.deleteCombo("x"), err(400));
});

test("righe importate dal vault: created_at in secondi ⇒ ISO", () => {
  sqlite.prepare("INSERT INTO sf6_combos (character_slug, notation, status, created_at) VALUES ('jp', '5HP', 'learning', 1700000000)").run();
  assert.equal(S.listCombos("jp")[0].createdAt, "2023-11-14T22:13:20.000Z");
});

test("consigli per personaggio: tipi ammessi, notation solo sulle combo, scarta gli item vuoti", () => {
  const ins = S.createTips({
    character_slug: "ryu", source_title: " Guida ", source_url: "",
    items: [
      { type: "overview", title: "Piano", content: "C", notation: "5LP" },
      { type: "combo", title: "Punish", content: "c", notation: "2MP > 236HP" },
      { type: "system", title: "Non ammesso qui", content: "x" },
      { type: "tech", title: "", content: "x" },
      "spazzatura",
    ],
  });
  assert.deepEqual(ins.map((t) => [t.type, t.notation]), [["overview", null], ["combo", "2MP > 236HP"]]);
  assert.equal(ins[0].sourceTitle, "Guida");
  assert.equal(ins[0].sourceUrl, null);
  assert.throws(() => S.createTips({ character_slug: "ryu", items: [] }), err(400));
  assert.throws(() => S.createTips({ character_slug: "nessuno", items: [{ type: "tech", title: "t", content: "c" }] }), err(400));
});

test("fondamentali: slug sentinella, notation sempre null, filtro general", () => {
  const ins = S.createTips({ is_general: true, items: [{ type: "neutral", title: "Anti-air", content: "c", notation: "2HP" }, { type: "combo", title: "x", content: "y" }] });
  assert.deepEqual(ins.map((t) => [t.characterSlug, t.type, t.notation]), [["__general__", "neutral", null]]);
  assert.ok(S.listTips({ general: true }).every((t) => t.characterSlug === "__general__"));
  assert.ok(S.listTips({ character: "ryu" }).every((t) => t.characterSlug === "ryu"));
  S.deleteTip(ins[0].id);
  assert.equal(S.listTips({ general: true }).some((t) => t.id === ins[0].id), false);
});
