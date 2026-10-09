import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import type { VaultData, VaultDomain } from "@/lib/vaultImport/read";

let sqlite: import("better-sqlite3").Database;
let createArea: typeof import("@/lib/areas").createArea;
let listAreas: typeof import("@/lib/areas").listAreas;
let planImport: typeof import("@/lib/vaultImport/plan").planImport;
let applyImport: typeof import("@/lib/vaultImport/plan").applyImport;
let formatReport: typeof import("@/lib/vaultImport/report").formatReport;

before(async () => {
  ({ sqlite } = await useTempDb()); // prima di importare i moduli che usano @/lib/db
  ({ createArea, listAreas } = await import("@/lib/areas"));
  ({ planImport, applyImport } = await import("@/lib/vaultImport/plan"));
  ({ formatReport } = await import("@/lib/vaultImport/report"));
});

const vault = (p: Partial<VaultData>): VaultData => ({ notes: [], combos: [], tips: [], settingKeys: [], ...p });
const dom = (slug: string, name: string, extra: Partial<VaultDomain> = {}): VaultDomain => ({ slug, name, tagline: "", symbol: "·", ...extra });
const note = (id: number, domain: string | null, createdAt = 1700000000 + id) => ({ id, content: `nota ${id}`, domain, createdAt });
const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
const notesBy = () => sqlite.prepare("SELECT id, content, domain, course_id AS courseId, created_at AS createdAt FROM notes ORDER BY id").all();

beforeEach(() => {
  sqlite.exec("DELETE FROM notes; DELETE FROM areas; DELETE FROM domains; DELETE FROM sf6_combos; DELETE FROM sf6_tips; DELETE FROM sqlite_sequence;");
});

test("aggancio per slug: l'area tiene il nome, prende simbolo e tagline; le note la seguono", () => {
  createArea({ name: "Alfa" });
  sqlite.prepare("INSERT INTO domains (name, kind, areas) VALUES ('Corso', 'course', '[\"alfa\"]')").run();
  const plan = planImport(vault({ notes: [note(1, "alfa")] }), [dom("alfa", "Alfa Vault", { symbol: "✦", tagline: "cose" })]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.steps.map((s) => [s.action, s.by, s.target, s.name, s.notes]), [["hook", "slug", "alfa", "Alfa", 1]]);
  assert.deepEqual(plan.areas, [{ slug: "alfa", name: "Alfa", courses: 1, vault: "alfa" }]);
  applyImport(plan);
  const [a] = listAreas();
  assert.deepEqual([a.slug, a.name, a.symbol, a.tagline, a.notes], ["alfa", "Alfa", "✦", "cose", 1]);
});

test("aggancio per nome: stesso nome a meno delle maiuscole, slug diverso → stesso dominio", () => {
  createArea({ name: "Gamma Uno" }); // slug gamma-uno
  const plan = planImport(vault({ notes: [note(1, "gamma")] }), [dom("gamma", "gamma uno")]);
  assert.deepEqual(plan.steps.map((s) => [s.action, s.by, s.target]), [["hook", "name", "gamma-uno"]]);
  applyImport(plan);
  assert.deepEqual(listAreas().map((a) => [a.slug, a.name, a.notes]), [["gamma-uno", "Gamma Uno", 1]]);
});

test("dominio nuovo: tiene lo slug del vault, va in coda, prende il modulo solo se registrato", () => {
  createArea({ name: "Alfa" });
  const modules = { beta: { title: "Beta", href: "/beta" } };
  const plan = planImport(vault({}), [dom("beta", "Beta", { symbol: "♪" }), dom("delta", "Delta")], { modules });
  assert.deepEqual(plan.steps.map((s) => [s.action, s.target, s.module]), [["new", "beta", "beta"], ["new", "delta", null]]);
  applyImport(plan);
  assert.deepEqual(listAreas().map((a) => [a.slug, a.symbol, a.module, a.position]),
    [["alfa", "·", null, 0], ["beta", "♪", "beta", 1], ["delta", "·", null, 2]]);
});

test("esclusi e domini sconosciuti → inbox, e il piano lo dice", () => {
  const plan = planImport(
    vault({ notes: [note(1, "alfa"), note(2, "delta"), note(3, "zeta"), note(4, null), note(5, "")] }),
    [dom("alfa", "Alfa"), dom("delta", "Delta")],
    { skip: ["delta"] },
  );
  assert.deepEqual(plan.steps.map((s) => [s.vault.slug, s.action, s.notes]), [["alfa", "new", 1], ["delta", "skip", 1]]);
  assert.deepEqual(plan.inbox, { fromVault: 2, skipped: 1, unknown: [{ slug: "zeta", notes: 1 }] });
  const r = applyImport(plan);
  assert.equal(r.inbox, 4);
  assert.deepEqual(listAreas().map((a) => a.slug), ["alfa"]);
});

test("note con id e date originali; corso mai assegnato", () => {
  applyImport(planImport(vault({ notes: [note(5, null, 1600000000), note(9, null, 1650000000)] }), []));
  assert.deepEqual(notesBy(), [
    { id: 5, content: "nota 5", domain: null, courseId: null, createdAt: 1600000000 },
    { id: 9, content: "nota 9", domain: null, courseId: null, createdAt: 1650000000 },
  ]);
});

test("id già usati nel target: le note del vault prendono id nuovi, nessuna si perde", () => {
  sqlite.prepare("INSERT INTO notes (id, content, created_at) VALUES (5, 'già qui', 1690000000)").run();
  const plan = planImport(vault({ notes: [note(5, null, 1600000000), note(6, null, 1600000001)] }), []);
  assert.equal(plan.renumbered, true);
  applyImport(plan);
  const rows = notesBy() as { id: number; content: string; createdAt: number }[];
  assert.deepEqual(rows.map((r) => [r.content, r.createdAt]),
    [["già qui", 1690000000], ["nota 5", 1600000000], ["nota 6", 1600000001]]);
  assert.match(formatReport(plan), /id nuovi/);
});

test("sf6: righe copiate con id e colonne", () => {
  const combos = [{ id: 3, character_slug: "pg-a", notation: "c", situation: null, status: "practicing", damage: 1200, drive_cost: 2, notes: null, created_at: 1700000000 }];
  const tips = [{ id: 7, character_slug: "pg-a", type: "general", title: "t", content: "x", notation: null, source_title: "s", source_url: null, created_at: 1700000001 }];
  const r = applyImport(planImport(vault({ combos, tips }), []));
  assert.deepEqual([r.combos, r.tips], [1, 1]);
  assert.deepEqual(sqlite.prepare("SELECT * FROM sf6_combos").get(), combos[0]);
  assert.deepEqual(sqlite.prepare("SELECT * FROM sf6_tips").get(), tips[0]);
});

test("impostazioni: groq_api_key da spostare in .env, le altre scartate; mai valori", () => {
  const plan = planImport(vault({ settingKeys: ["groq_api_key", "ollama_model", "use_claude"] }), []);
  assert.deepEqual(plan.settings, { dropped: ["ollama_model", "use_claude"], toEnv: [{ key: "groq_api_key", env: "GROQ_API_KEY" }] });
  assert.match(formatReport(plan), /GROQ_API_KEY/);
});

test("errori: niente si applica e niente si scrive", () => {
  createArea({ name: "Alfa" });
  const plan = planImport(
    vault({ notes: [note(1, null)] }),
    [dom("alfa", "Alfa"), dom("ALFA2", "Alfa"), dom("beta", "Beta", { symbol: "abcd" }), dom("beta", "Beta bis")],
    { skip: ["omega"] },
  );
  const text = plan.errors.join("\n");
  assert.match(text, /--skip omega/);
  assert.match(text, /ALFA2.*slug non valido/);
  assert.match(text, /finiscono entrambi su «Alfa»/);
  assert.match(text, /beta.*simbolo/);
  assert.match(text, /due domini con slug «beta»/);
  assert.throws(() => applyImport(plan), /non applicabile/);
  assert.equal(count("SELECT count(*) AS n FROM notes"), 0);
  assert.deepEqual(listAreas().map((a) => [a.slug, a.symbol]), [["alfa", "·"]]);
  assert.match(formatReport(plan), /Errori/);
});

test("sf6 già popolate nel target: errore invece di mescolare", () => {
  sqlite.prepare("INSERT INTO sf6_tips (character_slug, type, title, content, created_at) VALUES ('p', 'general', 't', 'c', 1)").run();
  const tips = [{ id: 1, character_slug: "pg-a", type: "general", title: "t", content: "x", notation: null, source_title: null, source_url: null, created_at: 1 }];
  assert.match(planImport(vault({ tips }), []).errors.join(), /sf6_tips/);
});

test("formatReport: domini, note, mappa delle aree e totali dopo l'import", () => {
  createArea({ name: "Alfa" });
  sqlite.prepare("INSERT INTO domains (name, kind, areas) VALUES ('Corso', 'course', '[\"alfa\"]')").run();
  const plan = planImport(vault({ notes: [note(1, "alfa"), note(2, "delta")], combos: [], tips: [] }),
    [dom("alfa", "Alfa", { symbol: "✦" }), dom("beta", "Beta"), dom("delta", "Delta")], { skip: ["delta"] });
  const before = formatReport(plan);
  assert.match(before, /alfa .*agganciato a «Alfa» \(alfa, stesso slug\)/);
  assert.match(before, /beta .*nuovo dominio «Beta» \(beta\)/);
  assert.match(before, /delta .*escluso \(--skip\): 1 nota va nell'inbox/);
  assert.match(before, /alfa +Alfa · 1 corso ← vault alfa/);
  assert.doesNotMatch(before, /Dopo l'import/);
  const after = formatReport(plan, applyImport(plan));
  assert.match(after, /Dopo l'import: 2 domini, 2 note \(1 nell'inbox\), 0 combo, 0 tip/);
});
