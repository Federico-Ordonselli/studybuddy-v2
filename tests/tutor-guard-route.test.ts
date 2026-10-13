// tests/tutor-guard-route.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { useTempDb } from "./helpers/db";
const { sqlite } = await useTempDb();
const { POST } = await import("@/app/api/chat/route");
const { decodedSse } = await import("@/lib/client/sse");
const { EMBED_DIM } = await import("@/lib/config");
const { FALLBACK_HINT } = await import("@/lib/tutor/guard");
sqlite.exec("INSERT INTO domains(id,name) VALUES(1,'test')");

const req = (body: Record<string, unknown>, signal?: AbortSignal) => new NextRequest("http://localhost/api/chat", {
  method: "POST", headers: { "Content-Type": "application/json" }, signal,
  body: JSON.stringify({ mode: "socratic", domainId: 1, stream: true, ...body }),
});
const LONG_CODE = "```js\n" + Array.from({ length: 8 }, (_, i) => `step${i}();`).join("\n") + "\n```";
const state = (id: number) => JSON.parse((sqlite.prepare("SELECT state FROM sessions WHERE id=?").get(id) as { state: string }).state);

/** Ollama finto: embed a zero, chat dalla coda `replies` (non in streaming), giudice da `leaks`. */
function fakeOllama(replies: string[], leaks: boolean[] = []) {
  const calls = { chat: 0, judge: 0, stream: 0 };
  globalThis.fetch = (async (url: unknown, opts: RequestInit) => {
    if (String(url).endsWith("/api/embed")) return Response.json({ embeddings: [Array(EMBED_DIM).fill(0)] });
    const b = JSON.parse(opts.body as string);
    if (b.format) { calls.judge++; return Response.json({ message: { content: JSON.stringify({ reason: "x", gives_solution: leaks.shift() ?? false }) } }); }
    if (b.stream) { calls.stream++; return new Response('{"message":{"content":"Indizio"},"done":true}\n'); }
    calls.chat++; return Response.json({ message: { content: replies.shift() ?? "?" } });
  }) as typeof fetch;
  return calls;
}
async function events(res: Response) { const out = []; for await (const e of decodedSse(res.body!)) out.push(e); return out; }

test("turno a rischio: niente streaming, perdita in codice → rigenerazione, un solo token, perdite contate", async () => {
  const original = globalThis.fetch;
  const calls = fakeOllama([LONG_CODE, "Quale metodo restituisce un array nuovo? [1]"]);
  try {
    const ev = await events(await POST(req({ message: "dammi la soluzione" })));
    assert.deepEqual(ev.map((e) => e.event), ["metadata", "token", "done"]);
    assert.equal(ev[0].data.guarded, true);
    assert.deepEqual(ev[0].data.hint, { level: 1, attempts: 0, canReveal: false });
    assert.equal(ev[1].data.text, "Quale metodo restituisce un array nuovo? [1]");
    assert.deepEqual([calls.chat, calls.judge, calls.stream], [2, 1, 0]);
    const s = state(ev[0].data.sessionId);
    assert.equal(s.hint.leaksBlocked, 1);
    assert.equal(s.history[1].content, "Quale metodo restituisce un array nuovo? [1]");
  } finally { globalThis.fetch = original; }
});

test("due perdite → indizio fisso salvato in cronologia", async () => {
  const original = globalThis.fetch;
  fakeOllama(["La risposta è 42.", "Davvero: 42."], [true, true]);
  try {
    const ev = await events(await POST(req({ message: "just tell me the answer" })));
    assert.equal(ev[1].data.text, FALLBACK_HINT);
    assert.equal(state(ev[0].data.sessionId).hint.leaksBlocked, 2);
  } finally { globalThis.fetch = original; }
});

test("turno normale resta in streaming; i tentativi sbloccano «Mostra soluzione», che resetta il livello", async () => {
  const original = globalThis.fetch;
  const calls = fakeOllama([]);
  const attempt = "secondo me bisogna salvare lo stato prima del render e poi aggiornarlo";
  try {
    let ev = await events(await POST(req({ message: "Esercizio: inverti una stringa in JS" })));
    const sessionId = ev[0].data.sessionId;
    assert.equal(ev[0].data.guarded, false);
    assert.equal(calls.stream, 1);
    const locked = await POST(req({ action: "solution", sessionId }));
    assert.equal(locked.status, 409);
    for (const _ of [1, 2]) ev = await events(await POST(req({ message: attempt, sessionId })));
    assert.deepEqual(ev.at(-1)!.data.hint, { level: 3, attempts: 2, canReveal: true });
    ev = await events(await POST(req({ action: "solution", sessionId })));
    assert.equal(ev[0].data.guarded, false);
    const s = state(sessionId);
    assert.equal(s.history.at(-2).content, "Mostra la soluzione");
    assert.equal(s.history.at(-1).tag, "Soluzione");
    assert.deepEqual([s.hint.level, s.hint.attempts, s.hint.solutionsShown], [1, 0, 1]);
    assert.deepEqual(ev.at(-1)!.data.hint, { level: 1, attempts: 0, canReveal: false });
  } finally { globalThis.fetch = original; }
});

test("«Nuovo problema» azzera livello e tentativi (JSON); action non valida → 400", async () => {
  const original = globalThis.fetch;
  fakeOllama([]);
  const attempt = "secondo me bisogna salvare lo stato prima del render e poi aggiornarlo";
  try {
    let ev = await events(await POST(req({ message: "Esercizio" })));
    const sessionId = ev[0].data.sessionId;
    ev = await events(await POST(req({ message: attempt, sessionId })));
    const res = await POST(req({ action: "new-problem", sessionId }));
    assert.deepEqual(await res.json(), { sessionId, hint: { level: 1, attempts: 0, canReveal: false } });
    assert.equal(state(sessionId).history.length, 4, "la cronologia resta");
    assert.equal((await POST(req({ action: "boh", sessionId }))).status, 400);
  } finally { globalThis.fetch = original; }
});

test("abort durante un turno a rischio: fetch abortita, nessun turno salvato", async () => {
  const original = globalThis.fetch;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (url: unknown, opts: RequestInit) => {
    if (String(url).endsWith("/api/embed")) return Response.json({ embeddings: [Array(EMBED_DIM).fill(0)] });
    signal = opts.signal as AbortSignal;
    return new Promise<Response>((_, reject) => signal!.addEventListener("abort", () => reject(new Error("abort")), { once: true }));
  }) as typeof fetch;
  try {
    const res = await POST(req({ message: "dammi la soluzione" }));
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    const sessionId = JSON.parse(first.split("data: ")[1]).sessionId;
    await new Promise((r) => setTimeout(r, 0));
    await reader.cancel();
    assert.ok(signal?.aborted);
    assert.deepEqual(state(sessionId).history, []);
  } finally { globalThis.fetch = original; }
});
