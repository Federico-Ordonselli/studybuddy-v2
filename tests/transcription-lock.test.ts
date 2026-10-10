import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {exclusive} from '@/lib/transcriptionLock';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sb-lock-test-'));
process.env.STUDYBUDDY_TRANSCRIBE_LOCK=path.join(dir,'gpu.lock');
test('lock GPU condiviso fra processi e liberato anche dopo errori',async()=>{
 await exclusive(async()=>{
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {exclusive} from './src/lib/transcriptionLock.ts';try{await exclusive(async()=>{});process.exit(1)}catch(e){process.exit(e.status===409?0:2)}`],{stdio:'ignore',env:process.env});
  const code=await new Promise(resolve=>child.on('exit',resolve));assert.equal(code,0);
 });
 assert.equal(fs.existsSync(process.env.STUDYBUDDY_TRANSCRIBE_LOCK!),false);
 await assert.rejects(exclusive(async()=>{throw Error('failure')}));
 assert.equal(await exclusive(async()=>42),42);
 fs.rmSync(dir,{recursive:true,force:true});
});
