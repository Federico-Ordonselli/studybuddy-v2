import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaProvider } from '@/lib/providers/ollama';
import { decodedSse } from '@/lib/client/sse';
const body = (s:string) => new ReadableStream<Uint8Array>({start(c){for(const byte of new TextEncoder().encode(s))c.enqueue(Uint8Array.of(byte));c.close();}});
test('Ollama stream: UTF-8 e NDJSON spezzati, segnale e opzioni',async()=>{
 const fetchOriginal = globalThis.fetch;
 const abort = new AbortController();
 globalThis.fetch = async (_url,opts) => {
  assert.equal(opts?.signal,abort.signal);
  const request = JSON.parse(opts?.body as string);
  assert.equal(request.stream,true);
  assert.equal(request.think,false);
  return new Response(body('{"message":{"content":"perché"}}\n{"message":{"content":"?"},"done":true}\n'));
 };
 try {let result='';for await(const token of ollamaProvider.generateStream!('test',{messages:[],signal:abort.signal}))result+=token;assert.equal(result,'perché?');}
 finally{globalThis.fetch=fetchOriginal;}
});
test('Ollama stream incompleto o con errore non equivale a successo',async()=>{
 const original=globalThis.fetch;
 try {for(const data of ['{"message":{"content":"parziale"}}\n','{"error":"failure"}\n']) {
  globalThis.fetch=async()=>new Response(body(data));
  await assert.rejects(async()=>{for await(const _ of ollamaProvider.generateStream!('test',{messages:[]})) {} });
 }}finally{globalThis.fetch=original;}
});
test('SSE spezzato: metadata, testo accentato, done',async()=>{
 const events=[];for await(const e of decodedSse(body('event: metadata\ndata: {"sessionId":1}\n\nevent: token\ndata: {"text":"è"}\n\nevent: done\ndata: {}\n\n')))events.push(e);
 assert.deepEqual(events.map(e=>e.event),['metadata','token','done']);assert.equal(events[1].data.text,'è');
});
