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
