import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {exclusive, exclusiveWithRetry} from '@/lib/transcriptionLock';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sb-lock-test-'));
process.env.STUDYBUDDY_TRANSCRIBE_LOCK=path.join(dir,'gpu.lock');
test('lock GPU condiviso fra processi e liberato anche dopo errori',async()=>{
 await exclusive(async()=>{
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {exclusive, exclusiveWithRetry} from './src/lib/transcriptionLock.ts';try{await exclusive(async()=>{});process.exit(1)}catch(e){process.exit(e.status===409?0:2)}`],{stdio:'ignore',env:process.env});
  const code=await new Promise(resolve=>child.on('exit',resolve));assert.equal(code,0);
 });
 assert.equal(fs.existsSync(process.env.STUDYBUDDY_TRANSCRIBE_LOCK!),false);
 await assert.rejects(exclusive(async()=>{throw Error('failure')}));
 assert.equal(await exclusive(async()=>42),42);

});

after(() => fs.rmSync(dir,{recursive:true,force:true}));
test('recupera un PID vivo appartenente a un processo precedente', async () => {
 fs.writeFileSync(process.env.STUDYBUDDY_TRANSCRIBE_LOCK!, JSON.stringify({pid:process.pid,since:Date.now(),identity:'precedente'}));
 assert.equal(await exclusive(async()=>42),42);
});
test('recupera lo stesso processo senza lock attivo in memoria', async () => {
 let owner = '';
 await exclusive(async()=> {
  owner = fs.readFileSync(process.env.STUDYBUDDY_TRANSCRIBE_LOCK!, 'utf8');
  await assert.rejects(exclusive(async()=>{}), (e: unknown) => (e as {status:number}).status === 409);
 });
 fs.writeFileSync(process.env.STUDYBUDDY_TRANSCRIBE_LOCK!,owner);
 assert.equal(await exclusive(async()=>42),42);
});

test('ingest attende il rilascio del lock e ritenta', async () => {
 let release!: () => void;
 const held = exclusive(() => new Promise<void>(resolve => { release = resolve; }));
 const waiting = exclusiveWithRetry(async () => 42, 100);
 setTimeout(release, 10);
 assert.equal(await waiting, 42);
 await held;
});
test('ingest limita l’attesa e propaga gli altri errori senza retry', async () => {
 await exclusive(async () => {
  await assert.rejects(exclusiveWithRetry(async()=>42, 10), (e: unknown) => (e as {status:number}).status === 409);
 });
 let calls = 0;
 await assert.rejects(exclusiveWithRetry(async()=> { calls++; throw Error('errore backend'); },100));
 assert.equal(calls,1);
});
