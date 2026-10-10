import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {useTempDb} from './helpers/db';
const {sqlite}=await useTempDb();
const {POST}=await import('@/app/api/chat/route');
const {decodedSse}=await import('@/lib/client/sse');
const {EMBED_DIM}=await import('@/lib/config');
sqlite.exec("INSERT INTO domains(id,name) VALUES(1,'test')");
const request=(stream:boolean,signal?:AbortSignal)=>new NextRequest('http://localhost/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'socratic',domainId:1,message:'Domanda',stream}),signal});
test('chat SSE: metadati prima dei token, done e salvataggio finale; JSON invariato',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  if(String(url).endsWith('/api/embed'))return Response.json({embeddings:[Array(EMBED_DIM).fill(0)]});
  const b=JSON.parse(opts!.body as string);
  if(!b.stream)return Response.json({message:{content:'Risposta'}});
  assert.ok(opts!.signal);
  return new Response('{"message":{"content":"Ri"}}\n{"message":{"content":"sposta"},"done":true}\n');
 };
 try{
  const response=await POST(request(true));assert.match(response.headers.get('Content-Type')!,/text\/event-stream/);
  const events=[];for await(const event of decodedSse(response.body!))events.push(event);
  assert.deepEqual(events.map(e=>e.event),['metadata','token','token','done']);
  const saved=JSON.parse((sqlite.prepare('SELECT state FROM sessions WHERE id=?').get(events[0].data.sessionId) as {state:string}).state);
  assert.equal(saved.history[1].content,'Risposta');
  const json=await (await POST(request(false))).json();assert.equal(json.reply,'Risposta');assert.ok(json.sessionId);
 }finally{globalThis.fetch=original;}
});
test('chat SSE incompleto: errore e nessun turno parziale persistito',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>String(url).endsWith('/api/embed')?Response.json({embeddings:[Array(EMBED_DIM).fill(0)]}):new Response('{"message":{"content":"parziale"}}\n');
 try{
  const events=[];for await(const event of decodedSse((await POST(request(true))).body!))events.push(event);
  assert.equal(events.at(-1)?.event,'error');assert.equal(events.some(e=>e.event==='done'),false);
  const saved=JSON.parse((sqlite.prepare('SELECT state FROM sessions WHERE id=?').get(events[0].data.sessionId) as {state:string}).state);
  assert.deepEqual(saved.history,[]);
 }finally{globalThis.fetch=original;}
});
test('cancellare il lettore SSE abortisce la fetch Ollama e non salva un turno',async()=>{
 const original=globalThis.fetch;
 let signal:AbortSignal|undefined;
 globalThis.fetch=async(url,opts)=>{
  if(String(url).endsWith('/api/embed'))return Response.json({embeddings:[Array(EMBED_DIM).fill(0)]});
  signal=opts!.signal as AbortSignal;
  return new Response(new ReadableStream({start(c){signal!.addEventListener('abort',()=>c.error(new Error('abort')),{once:true});}}));
 };
 try{
  const response=await POST(request(true));const reader=response.body!.getReader();
  await reader.read(); // metadata
  await new Promise(r=>setTimeout(r,0));await reader.cancel();
  assert.ok(signal?.aborted);
  const state=JSON.parse((sqlite.prepare('SELECT state FROM sessions ORDER BY id DESC LIMIT 1').get() as {state:string}).state);
  assert.deepEqual(state.history,[]);
 }finally{globalThis.fetch=original;}
});
