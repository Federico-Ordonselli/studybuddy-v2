import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { useTempDb } from "./helpers/db";

await useTempDb();
const list = await import("@/app/api/maps/exercise/route");
const check = await import("@/app/api/maps/exercise/check/route");
const reveal = await import("@/app/api/maps/exercise/reveal/route");

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("GET livelli: mapId mancante 400, mappa senza esercizio → []", async () => {
  assert.equal((await list.GET(new NextRequest("http://localhost/api/maps/exercise"))).status, 400);
  const r = await list.GET(new NextRequest("http://localhost/api/maps/exercise?mapId=nessuna"));
  assert.deepEqual(await r.json(), { levels: [] });
});

test("POST crea: corpo non valido 400", async () => {
  assert.equal((await list.POST(post("/api/maps/exercise", { domainId: "1", topic: "" }))).status, 400);
});

test("check e reveal: mappa inesistente 404 con messaggio", async () => {
  const r = await check.POST(post("/api/maps/exercise/check", { mapId: "nessuna", spaceId: "x" }));
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /mappa inesistente/);
  assert.equal((await reveal.POST(post("/api/maps/exercise/reveal", { mapId: "nessuna", spaceId: "x" }))).status, 404);
});

const raw = (url: string, body: string) => new NextRequest(`http://localhost${url}`, { method: "POST", body, headers: { "content-type": "application/json" } });

test("JSON malformato o non-oggetto: 400 con {error} su tutte le POST", async () => {
  const routes = await Promise.all(["", "/expand", "/check", "/reveal", "/complete", "/card"].map((p) => import(`@/app/api/maps/exercise${p}/route`)));
  for (const r of routes) for (const body of ["{non json", "null", "[1,2]"]) {
    const res = await r.POST(raw("/api/maps/exercise", body));
    assert.equal(res.status, 400, body);
    assert.ok((await res.json()).error);
  }
});

test("GET livelli di una mappa-esercizio: nessuna soluzione nella risposta", async () => {
  const { withJudge } = await import("./helpers/judge");
  const { sqlite } = await import("@/lib/db");
  sqlite.prepare("INSERT OR IGNORE INTO domains (id, name) VALUES (1, 'Corso')").run();
  const { createExercise } = await import("@/lib/mapExercise");
  const FOUND = [{ chunkId: 10, documentId: 1, content: "Lo state provoca il rendering.", distance: 0, source: null, docKind: "text", docMeta: { fileHash: "h" } }];
  const reply = JSON.stringify({
    center: { title: "React", definition: "Libreria UI.", explanation: "SPIEGAZIONE-SEGRETA", sources: [1] },
    concepts: [{ title: "State", definition: "Dati locali.", explanation: "SPIEGAZIONE-SEGRETA", sources: [1], verb: "VERBO-SEGRETO" }],
    relations: [], focus_question: "Come?",
  });
  const { map } = await withJudge([reply], () => createExercise(1, "React", FOUND));
  const res = await list.GET(new NextRequest(`http://localhost/api/maps/exercise?mapId=${map.id}`));
  const text = await res.text();
  assert.match(text, /"focusQuestion":"Come\?"/);
  assert.doesNotMatch(text, /SEGRET|proposal|chunkIds/);
});
