import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {useTempDb} from './helpers/db';
await useTempDb();
const chat=await import('@/app/api/chat/route');
const cards=await import('@/app/api/cards/route');
const review=await import('@/app/api/review/route');
const summary=await import('@/app/api/summarize/route');
const request=(body:unknown,raw=false)=>new NextRequest('http://localhost/api/test',{method:'POST',headers:{'Content-Type':'application/json'},body:raw?body as string:JSON.stringify(body)});
test('JSON malformato e body non oggetto: 400 per tutte le route LLM',async()=>{
 for(const route of [chat,cards,review,summary])for(const b of ['{', 'null','[]'])assert.equal((await route.POST(request(b,true))).status,400);
});
test('chat: enum, id, stringhe, limiti e domanda quiz validati',async()=>{
 for(const b of [{mode:'bad'},{message:''},{message:42},{message:'x'.repeat(10001)},{message:'ok',domainId:-1},{message:'ok',domainId:1.5},{message:'ok',sessionId:'1'},{message:'ok',stream:'true'},{mode:'review',question:null,answer:'test'},{mode:'quiz',topic:[]}] )assert.equal((await chat.POST(request(b))).status,400);
});
test('review/cards/summarize rifiutano id e testo invalidi prima del modello',async()=>{
 for(const b of [{cardId:1,answer:''},{cardId:'1',answer:'a'},{cardId:1,answer:'a',domainId:0}])assert.equal((await review.POST(request(b))).status,400);
 for(const b of [{domainId:1,topic:''},{domainId:0,topic:'a'},{domainId:1,topic:'a',n:100}])assert.equal((await cards.POST(request(b))).status,400);
 for(const b of [{domainId:'1',topic:'a'},{domainId:1,topic:''},{domainId:1,module:42}])assert.equal((await summary.POST(request(b))).status,400);
});
