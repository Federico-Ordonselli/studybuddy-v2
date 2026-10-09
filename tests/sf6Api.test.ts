import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { useTempDb } from "./helpers/db";

const vods = fs.mkdtempSync(path.join(os.tmpdir(), "sb-api-vods-"));
process.env.STUDYBUDDY_VODS_DIR = vods;
process.env.STUDYBUDDY_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sb-api-up-"));

let combos: typeof import("@/app/api/sf6/combos/route");
let combo: typeof import("@/app/api/sf6/combos/[id]/route");
let tips: typeof import("@/app/api/sf6/tips/route");
let tip: typeof import("@/app/api/sf6/tips/[id]/route");
let imp: typeof import("@/app/api/sf6/import/route");
let tr: typeof import("@/app/api/sf6/transcribe/route");
let vodsRoute: typeof import("@/app/api/sf6/vods/route");
before(async () => {
  await useTempDb();
  combos = await import("@/app/api/sf6/combos/route");
  combo = await import("@/app/api/sf6/combos/[id]/route");
  tips = await import("@/app/api/sf6/tips/route");
  tip = await import("@/app/api/sf6/tips/[id]/route");
  imp = await import("@/app/api/sf6/import/route");
  tr = await import("@/app/api/sf6/transcribe/route");
  vodsRoute = await import("@/app/api/sf6/vods/route");
});

const url = (p: string) => `http://localhost:3000${p}`;
const json = (p: string, method: string, body: unknown) =>
  new NextRequest(url(p), { method, body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const body = async (r: Response) => (await r.json()) as any;

test("combo: crea, elenca per personaggio, modifica, elimina; JSON rotto 400", async () => {
  const c = await body(await combos.POST(json("/api/sf6/combos", "POST", { character_slug: "ryu", notation: "5LP", drive_cost: 2 })));
  assert.equal(c.driveCost, 2);
  assert.equal((await body(await combos.GET(new NextRequest(url("/api/sf6/combos?character=ryu"))))).length, 1);
  const u = await combo.PATCH(json(`/api/sf6/combos/${c.id}`, "PATCH", { status: "consolidated" }), ctx(String(c.id)));
  assert.equal((await body(u)).status, "consolidated");
  assert.equal((await combo.PATCH(json("/x", "PATCH", { status: "x" }), ctx(String(c.id)))).status, 400);
  assert.equal((await combo.PATCH(json("/x", "PATCH", { notes: "x" }), ctx("999999"))).status, 404);
  assert.equal((await combo.DELETE(new NextRequest(url("/x"), { method: "DELETE" }), ctx(String(c.id)))).status, 200);
  assert.equal((await combos.POST(json("/api/sf6/combos", "POST", "{rotto"))).status, 400);
});

test("consigli: salva per personaggio e fondamentali, filtro general, elimina", async () => {
  const r = await body(await tips.POST(json("/api/sf6/tips", "POST", { is_general: true, items: [{ type: "mental", title: "Tilt", content: "c" }] })));
  assert.equal(r.inserted.length, 1);
  const g = await body(await tips.GET(new NextRequest(url("/api/sf6/tips?general=1"))));
  assert.deepEqual(g.map((t: any) => t.title), ["Tilt"]);
  assert.equal((await tip.DELETE(new NextRequest(url("/x"), { method: "DELETE" }), ctx(String(r.inserted[0].id)))).status, 200);
  assert.equal((await tips.POST(json("/api/sf6/tips", "POST", { character_slug: "ryu", items: [] }))).status, 400);
});

test("import: validazione prima di chiamare l'LLM", async () => {
  const short = await imp.POST(json("/api/sf6/import", "POST", { transcript: "corto", character_slug: "ryu" }));
  assert.equal(short.status, 400);
  const bad = await imp.POST(json("/api/sf6/import", "POST", { transcript: "una trascrizione abbastanza lunga", character_slug: "nessuno" }));
  assert.equal(bad.status, 400);
});

test("transcribe: sorgente mancante 400, VOD e upload inesistenti 404, URL non http 400", async () => {
  assert.equal((await tr.POST(json("/api/sf6/transcribe", "POST", {}))).status, 400);
  const v = await tr.POST(json("/api/sf6/transcribe", "POST", { vod_filename: "assente.mp4" }));
  assert.equal(v.status, 404);
  assert.match((await body(v)).error, /File non trovato/);
  assert.equal((await tr.POST(json("/api/sf6/transcribe", "POST", { upload_id: "abcd.mp3" }))).status, 404);
  assert.equal((await tr.POST(json("/api/sf6/transcribe", "POST", { url: "--exec=boom" }))).status, 400);
});

test("vods: cartella e file", async () => {
  fs.writeFileSync(path.join(vods, "match.mkv"), "x");
  const r = await body(await vodsRoute.GET());
  assert.equal(r.dir, vods);
  assert.deepEqual(r.files.map((f: any) => f.filename), ["match.mkv"]);
});

test("transcribe: richiesta già abortita ⇒ errore e l'upload viene cancellato", async () => {
  const up = path.join(process.env.STUDYBUDDY_UPLOAD_DIR!, "abort1234.mp3");
  fs.writeFileSync(up, "non audio");
  const ac = new AbortController();
  ac.abort();
  const req = new NextRequest(url("/api/sf6/transcribe"), {
    method: "POST", body: JSON.stringify({ upload_id: "abort1234.mp3" }),
    headers: { "content-type": "application/json" }, signal: ac.signal,
  });
  const res = await tr.POST(req);
  assert.ok(res.status >= 400);
  assert.equal(fs.existsSync(up), false);
});
