import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { LibraryError } from "@/lib/errors";
import { extractFromTranscript, extractFundamentalsFromTranscript, parseItems, MAX_TRANSCRIPT_CHARS } from "@/lib/sf6/extract";

let server: http.Server;
let requests: Record<string, any>[] = [];
let reply = "";
before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: { content: reply } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const ITEMS = {
  items: [
    { type: "overview", title: "Piano", content: "Riassunto", notation: "5LP" },
    { type: "combo", title: "Punish", content: "c", notation: "2MP > 236HP" },
    { type: "tech", title: "Setup", content: "t", notation: "x" },
  ],
};

test("personaggio: richiesta a Ollama con modello del task, schema, contesto 32k e 8192 token d'uscita", async () => {
  requests = [];
  reply = "```json\n" + JSON.stringify(ITEMS) + "\n```";
  const r = await extractFromTranscript({ characterSlug: "ryu", transcript: "una guida abbastanza lunga su Ryu", sourceTitle: "Video" });
  assert.equal(requests.length, 1);
  const b = requests[0];
  assert.equal(b.model, "gemma4:12b");
  assert.deepEqual(b.format.required, ["items"]);
  assert.equal(b.options.num_ctx, 32768);
  assert.equal(b.options.num_predict, 8192);
  assert.equal(b.messages[0].role, "system");
  assert.match(b.messages[0].content, /Street Fighter 6/);
  assert.match(b.messages[1].content, /Personaggio: Ryu/);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.items.map((i) => [i.type, i.notation]), [["overview", null], ["combo", "2MP > 236HP"], ["tech", null]]);
});

test("trascrizione oltre il limite: tagliata e segnalata, il system prompt resta", async () => {
  requests = [];
  reply = JSON.stringify(ITEMS);
  const r = await extractFromTranscript({ characterSlug: "ryu", transcript: "x".repeat(MAX_TRANSCRIPT_CHARS + 10_000) });
  assert.equal(r.truncated, true);
  assert.ok(requests[0].messages[1].content.length < MAX_TRANSCRIPT_CHARS + 1000);
  assert.match(requests[0].messages[0].content, /Street Fighter 6/);
});

test("personaggio sconosciuto ⇒ 400 senza chiamare Ollama; trascrizione troppo corta ⇒ niente", async () => {
  requests = [];
  await assert.rejects(extractFromTranscript({ characterSlug: "nessuno", transcript: "testo lungo abbastanza per passare" }),
    (e) => e instanceof LibraryError && e.status === 400);
  assert.deepEqual(await extractFromTranscript({ characterSlug: "ryu", transcript: "corto" }), { items: [], truncated: false });
  assert.equal(requests.length, 0);
});

test("fondamentali: schema con i tipi dei fondamentali, notation sempre null", async () => {
  requests = [];
  reply = JSON.stringify({ items: [{ type: "overview", title: "O", content: "c", notation: null }, { type: "neutral", title: "AA", content: "c", notation: "2HP" }] });
  const r = await extractFundamentalsFromTranscript({ transcript: "una guida sui fondamentali del gioco" });
  assert.ok(requests[0].format.properties.items.items.properties.type.enum.includes("system"));
  assert.deepEqual(r.items.map((i) => [i.type, i.notation]), [["overview", null], ["neutral", null]]);
});

test("parseItems: JSON rotto ⇒ [], tipo ignoto ⇒ ripiego per modalità, item senza titolo scartati", () => {
  const char = ["overview", "combo", "tech", "strategy", "matchup", "general"] as const;
  assert.deepEqual(parseItems("niente json", char), []);
  assert.deepEqual(parseItems('{"items": 3}', char), []);
  const out = parseItems('prima {"items":[{"type":"boh","title":"T","content":"C"},{"type":"tech","title":"","content":"C"}]} dopo', char);
  assert.deepEqual(out, [{ type: "general", title: "T", content: "C", notation: null }]);
  const fund = ["overview", "system", "neutral", "offense", "defense", "mental"] as const;
  assert.equal(parseItems('{"items":[{"type":"boh","title":"T","content":"C"}]}', fund)[0].type, "system");
});
