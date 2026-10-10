import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import {useTempDb} from './helpers/db';
const {dir,sqlite}=await useTempDb();
const {EMBED_DIM}=await import('@/lib/config');
sqlite.exec(`INSERT INTO domains(id,name) VALUES(1,'test'); INSERT INTO documents(id,domain_id,title) VALUES(1,1,'doc'); INSERT INTO chunks(id,document_id,ordinal,content) VALUES(1,1,0,'test'); CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id INTEGER PRIMARY KEY,embedding float[${EMBED_DIM}]);`);
sqlite.prepare('INSERT INTO vec_chunks(chunk_id,embedding) VALUES (?,?)').run(1n,JSON.stringify(Array(EMBED_DIM).fill(0)));
const original=path.join(dir,'test.db');const target=path.join(dir,'migrated.db');
const run=(apply:boolean)=>spawnSync(process.execPath,['--import','tsx','scripts/migrate-vec-domain.ts','--from',original,'--target',target,...(apply?['--apply']:[])],{encoding:'utf8'});
test('migrazione vec: dry-run non pubblica, apply su copia, originale e vettori intatti',()=>{
 const before=fs.readFileSync(original),wal=fs.readFileSync(original+'-wal');
 const dry=run(false);assert.equal(dry.status,0,dry.stderr);assert.equal(fs.existsSync(target),false);
 const applied=run(true);assert.equal(applied.status,0,applied.stderr);
 const copy=new Database(target);sqliteVec.load(copy);
 try{const row=copy.prepare('SELECT chunk_id,domain_id FROM vec_chunks').get() as {chunk_id:number;domain_id:number};assert.deepEqual(row,{chunk_id:1,domain_id:1});assert.equal((copy.prepare('select vec_length(embedding) n from vec_chunks').get() as {n:number}).n,EMBED_DIM);}finally{copy.close();}
 assert.deepEqual(fs.readFileSync(original),before);assert.deepEqual(fs.readFileSync(original+'-wal'),wal);
 assert.notEqual(run(true).status,0);
});
