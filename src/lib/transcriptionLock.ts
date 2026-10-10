import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LibraryError} from './errors';

export function formatTranscriptionAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} s` : ''}`;
}
/** Lock condiviso fra Next, SF6 e CLI; recupera un lock lasciato da un processo terminato. */
export async function exclusive<T>(fn:()=>Promise<T>):Promise<T> {
  const lock=process.env.STUDYBUDDY_TRANSCRIBE_LOCK ?? path.join(os.tmpdir(),`studybuddy-whisper-${process.getuid?.() ?? 'local'}.lock`);
  let fd: number | undefined;
  for(let attempt=0;attempt<2;attempt++) {
    try { fd=fs.openSync(lock,'wx',0o600); break; }
    catch(e) {
      if((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let owner:{pid:number;since:number}|undefined;
      try {owner=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{}
      let alive=true;
      if(owner && Number.isSafeInteger(owner.pid) && owner.pid>0) {
        try{process.kill(owner.pid,0);}catch(e){alive=(e as NodeJS.ErrnoException).code !== 'ESRCH';}
      }
      if(!alive && attempt===0){fs.unlinkSync(lock);continue;}
      throw new LibraryError(`c'è già una trascrizione in corso (da ${formatTranscriptionAge(Date.now()-(owner?.since ?? Date.now()))}): riprova quando finisce`,409);
    }
  }
  if(fd===undefined)throw new LibraryError('Trascrizione occupata',409);
  try {fs.writeFileSync(fd,JSON.stringify({pid:process.pid,since:Date.now()}));return await fn();}
  finally {fs.closeSync(fd);fs.rmSync(lock,{force:true});}
}
