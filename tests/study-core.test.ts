import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {useTempDb} from './helpers/db';
const {dir}=await useTempDb();
const {sm2,nextDue}=await import('@/lib/tutor/sm2');
const {rrfFuse,toCitations}=await import('@/lib/rag/pipeline');
const {chunkText,chunkTranscript}=await import('@/lib/rag/chunk');
const {gradeChoice}=await import('@/lib/tutor/session');
const {normalizeOption}=await import('@/lib/tutor/quiz');
const {rag}=await import('@/lib/config');
test('SM-2: quality 0–5, ease e reset degli intervalli',()=>{
 const expected=[1.7,1.96,2.18,2.36,2.5,2.6];
 for(let quality=0;quality<=5;quality++){
  const next=sm2({ease:2.5,intervalDays:6,repetitions:2},quality);
  assert.ok(Math.abs(next.ease-expected[quality])<1e-9);
  assert.equal(next.intervalDays,quality<3?1:15);assert.equal(next.repetitions,quality<3?0:3);
 }
 assert.equal(sm2({ease:1.3,intervalDays:100,repetitions:9},0).ease,1.3);
 const first=sm2({ease:2.5,intervalDays:0,repetitions:0},5);assert.equal(first.intervalDays,1);
 assert.equal(sm2(first,5).intervalDays,6);
 const now=Date.now();assert.ok(nextDue(1).getTime()>now+23*3600000);
});
const chunk=(id:number,content='testo')=>({chunkId:id,documentId:id,content,distance:0});
test('RRF: premia accordo dei rami, dedup per id, topK ed empty',()=>{
 const one=chunk(1),two=chunk(2),three=chunk(3);
 assert.deepEqual(rrfFuse([[one,two],[three,two]],3).map(c=>c.chunkId),[2,1,3]);
 assert.deepEqual(rrfFuse([[one,two],[one]],1),[one]);
 assert.deepEqual(rrfFuse([],5),[]);
});
test('chunkText: vuoto, paragrafi accorpati e lunghi spezzati',()=>{
 assert.deepEqual(chunkText(' \n '),[]);
 assert.deepEqual(chunkText('primo\n\nsecondo'),['primo\n\nsecondo']);
 const chunks=chunkText('Una frase. '.repeat(1000));
 assert.ok(chunks.length>1);assert.ok(chunks.every(c=>c.length<=rag.chunkTokens*4));
});
test('chunkTranscript: timestamp del primo e ultimo cue e budget ordinario',()=>{
 assert.deepEqual(chunkTranscript([]),[]);
 const result=chunkTranscript([{startSec:61,endSec:70,text:'a'.repeat(1000)},{startSec:70,endSec:80,text:'b'.repeat(1000)},{startSec:80,endSec:90,text:'fine'}]);
 assert.deepEqual(result[0].meta,{startSec:61,endSec:70});assert.deepEqual(result[1].meta,{startSec:70,endSec:90});
 assert.ok(result.every(c=>c.content.length<=rag.chunkTokens*4));
});
test('gradeChoice e normalizeOption: spazi, maiuscole e scelta errata',()=>{
 assert.equal(normalizeOption('  A   B\nC '),'a b c');
 const q={type:'mcq' as const,question:'Scegli',answer:'Prima opzione',options:['Prima opzione','Seconda'],rationale:'Motivo'};
 assert.equal(gradeChoice(q,' PRIMA  OPZIONE ').quality,5);
 assert.equal(gradeChoice(q,'Seconda').quality,1);assert.equal(gradeChoice(q,'Seconda').correct,false);
 assert.match(gradeChoice(q,'Seconda').feedback,/Prima opzione/);
});
test('toCitations: numero, breadcrumb, snippet e video al secondo corretto',()=>{
 const video=path.join(dir,'lezione.mp4');fs.writeFileSync(video,'');
 const cite=toCitations([{...chunk(1,'a'.repeat(400)),docKind:'transcript',source:path.join(dir,'lezione.en.srt'),meta:{startSec:125,endSec:140},docMeta:{crumbs:['Corso','Modulo']}}])[0];
 assert.equal(cite.n,1);assert.equal(cite.snippet.length,240);assert.equal(cite.label,'Corso › Modulo › lezione.en.srt');
 assert.deepEqual(cite.video,{path:video,startSec:125});assert.equal(cite.endSec,140);
 assert.equal(toCitations([{...chunk(2),docKind:'pdf',source:path.join(dir,'slide.pdf')}])[0].video,undefined);
});
