import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useTempDb} from './helpers/db';
const {sqlite} = await useTempDb();
const {initVectorStore} = await import('@/lib/db');
const {vectorSearchByEmbedding,deleteDocumentChunks} = await import('@/lib/rag/store');
const {EMBED_DIM} = await import('@/lib/config');
initVectorStore();
const vec = (n:number)=>Array.from({length:EMBED_DIM},(_,i)=>i?0:n);
sqlite.exec("INSERT INTO domains(id,name) VALUES (1,'grande'),(2,'piccolo'),(3,'macro'); UPDATE domains SET parent_id=3 WHERE id=2; INSERT INTO documents(id,domain_id,title) VALUES (1,1,'a'),(2,2,'b');");
const insert=sqlite.prepare('INSERT INTO vec_chunks(chunk_id,embedding,domain_id) VALUES (?,?,?)');
for(let id=1;id<=90;id++) {const domain=id===90?2:1;sqlite.prepare('INSERT INTO chunks(id,document_id,ordinal,content) VALUES (?,?,?,?)').run(id,domain,id,`testo ${id}`);insert.run(BigInt(id),JSON.stringify(vec(id)),BigInt(domain));}
test('kNN filtrato trova il dominio piccolo anche oltre i candidati globali',()=>{
 assert.deepEqual(vectorSearchByEmbedding(vec(0),1,2).map(c=>c.chunkId),[90]);
 assert.deepEqual(vectorSearchByEmbedding(vec(0),1,3).map(c=>c.chunkId),[90]);
 assert.deepEqual(vectorSearchByEmbedding(vec(0),1).map(c=>c.chunkId),[1]);
});
test('deleteDocumentChunks elimina i vettori con metadato',()=>{deleteDocumentChunks(2);assert.deepEqual(vectorSearchByEmbedding(vec(0),1,2),[]);});
