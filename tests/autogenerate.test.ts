import test from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
const {sqlite} = await useTempDb();
const {createJob,listModules,moduleChunks,runJob,latestJob,retryJob,listMaterials} = await import("@/lib/autogenerate");
sqlite.exec(`INSERT INTO domains(id,name,kind) VALUES (1,'Percorso','macro'),(2,'Corso A','course'),(3,'Corso B','course'); UPDATE domains SET parent_id=1 WHERE id IN (2,3);
INSERT INTO documents(id,domain_id,title,meta) VALUES (1,2,'A','{"module":"01"}'),(2,2,'B','{"module":"02"}'),(3,3,'C','{"module":"01"}');
INSERT INTO chunks(document_id,ordinal,content) VALUES (1,0,'Primo modulo A'),(2,0,'Secondo modulo A'),(3,0,'Primo modulo B');`);
test('moduli omonimi dei corsi figli sono distinti e i chunk restano nel modulo selezionato',()=>{
 const modules=listModules(1);assert.equal(modules.length,3);assert.equal(new Set(modules.map(m=>m.key)).size,3);
 assert.deepEqual(moduleChunks(modules.find(m=>m.domainId===2 && m.module==='01')!).map(c=>c.content),['Primo modulo A']);
});
test('validazione, avanzamento persistente, errori e ripresa senza ripetere i passaggi completati',async()=>{
 assert.throws(()=>createJob(2,['inesistente'],['summary']));assert.throws(()=>createJob(2,[listModules(2)[0].key],['invalido']));
 const job=createJob(2,listModules(2).map(m=>m.key),['summary','glossary','summary']);assert.equal(job.steps.length,4);
 assert.throws(()=>createJob(2,[listModules(2)[0].key],['summary']));
 let calls=0;
 await runJob(job,async s=>{calls++;if(s.kind==='glossary')throw new Error('modello indisponibile');});
 assert.equal(calls,4);assert.equal(latestJob(2)?.status,'complete');assert.equal(latestJob(2)?.steps.filter(s=>s.status==='error').length,2);
 await runJob(retryJob(2),async()=>{calls++;});assert.equal(calls,6);assert.ok(latestJob(2)?.steps.every(s=>s.status==='done'));
 assert.throws(()=>retryJob(2));
});
test('raccolta dei materiali include i figli ma esclude corsi estranei',()=>{
 sqlite.prepare('INSERT INTO study_materials(id,domain_id,module,kind,content) VALUES (?,?,?,?,?)').run('a',2,'01','glossary','Termine: definizione');
 assert.equal(listMaterials(1).length,1);assert.equal(listMaterials(3).length,0);
 assert.throws(()=>listMaterials(999));
});
test('generazione usa tutti i chunk del modulo, salva riassunti e flashcard senza duplicati',async()=>{
 const {generateStep}=await import('@/lib/autogenerate');
 const step={...listModules(2)[0],kind:'summary' as const,status:'pending' as const};
 const original=globalThis.fetch;
 const prompts:string[]=[];
 globalThis.fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));prompts.push(JSON.stringify(body.messages));
  const content=body.format ? JSON.stringify({questions:[{type:'open',question:'Come funziona il concetto A?',answer:'Primo modulo A',rationale:'Definizione'}]}) : '# Sintesi\nPrimo modulo A';
  return Response.json({message:{content}});
 };
 try {
  await generateStep(step);
  assert.ok(prompts.every(p=>p.includes('Primo modulo A') && !p.includes('Secondo modulo A') && !p.includes('Primo modulo B')));
  assert.match(listMaterials(2).find(m=>m.kind==='summary')!.content,/Sintesi/);
  await generateStep({...step,kind:'flashcards'});await generateStep({...step,kind:'flashcards'});
  const cards=sqlite.prepare('SELECT * FROM cards WHERE domain_id=2').all() as {source_chunk_id:number}[];
  assert.equal(cards.length,1);assert.equal(cards[0].source_chunk_id,moduleChunks(step)[0].chunkId);
 }finally {globalThis.fetch=original;}
});
