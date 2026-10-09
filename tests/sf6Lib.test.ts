import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotation } from "@/lib/sf6/notation";
import { SF6_ROSTER, getSf6Character } from "@/lib/sf6/roster";
import { FUNDAMENTALS_SLUG, isFundamentalType } from "@/lib/sf6/fundamentals";
import { SLUG_RE } from "@/lib/slug";
import { MODULES } from "@/lib/modules";
import { captureTarget } from "@/lib/client/captureTarget";
import { cn } from "@/lib/cn";

const kinds = (s: string) => parseNotation(s).map((t) => t.kind);

test("notazione: combo con prefisso, motion, cancel e super", () => {
  const t = parseNotation("cr.MK > 236+HP xx SA3");
  assert.deepEqual(t.map((x) => x.kind), ["modifier", "button", "separator", "motion", "button", "separator", "super"]);
  assert.deepEqual(t[1], { kind: "button", raw: "MK", strength: "M", family: "K", label: "MK" });
  assert.equal(t[3].kind === "motion" && t[3].arrow, "↓↘→");
  assert.equal(t[6].kind === "super" && t[6].label, "Super Lv.3");
});

test("notazione: cifre attaccate al bottone, motion a lettere, link e rapid, drive, testo libero", () => {
  assert.deepEqual(kinds("5HP"), ["modifier", "button"]);
  const m = parseNotation("5HP")[0];
  assert.equal(m.kind === "modifier" && m.label, "n");
  const q = parseNotation("qcfHP")[0];
  assert.equal(q.kind === "motion" && q.numpad, "236");
  assert.deepEqual(kinds("j.HK, st.HP ~ LK"), ["modifier", "button", "separator", "modifier", "button", "separator", "button"]);
  assert.equal(parseNotation("DI")[0].kind, "drive");
  assert.deepEqual(parseNotation("PP")[0], { kind: "button", raw: "PP", strength: "Any", family: "PP", label: "PP" });
  assert.deepEqual(kinds("L Spin Knuckle"), ["text", "text", "text"]);
  assert.deepEqual(parseNotation("   "), []);
});

test("roster: slug unici e validi, ricerca per slug, slug dei fondamentali fuori dal roster", () => {
  const slugs = SF6_ROSTER.map((c) => c.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.match(s, SLUG_RE);
  assert.equal(getSf6Character("ryu")?.name, "Ryu");
  assert.equal(getSf6Character("nessuno"), undefined);
  assert.equal(getSf6Character(FUNDAMENTALS_SLUG), undefined);
  assert.equal(isFundamentalType("neutral"), true);
  assert.equal(isFundamentalType("combo"), false);
});

test("modulo sf6 registrato: la quick capture su /sf6/** va al dominio collegato", () => {
  assert.deepEqual(MODULES.sf6, { title: "Street Fighter 6", href: "/sf6" });
  const areas = [{ slug: "alfa", module: null }, { slug: "beta", module: "sf6" }];
  assert.deepEqual(captureTarget("/sf6", areas), { kind: "area", slug: "beta" });
  assert.deepEqual(captureTarget("/sf6/ryu", areas), { kind: "area", slug: "beta" });
  assert.deepEqual(captureTarget("/sf6xyz", areas), { kind: "inbox" });
});

test("cn: unisce solo le stringhe non vuote", () => {
  assert.equal(cn("a", false, null, undefined, "", "b"), "a b");
});
