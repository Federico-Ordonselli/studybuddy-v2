import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {LibraryError} from './errors';

// Il boot ID distingue anche riavvii dell'host; starttime distingue il riuso del PID.
function processIdentity(pid: number): string | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    return `${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${start}`;
  } catch { return undefined; }
}
const identity = processIdentity(process.pid) ?? randomUUID();
const activeLocks = new Set<string>();

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
      let owner:{pid:number;since:number;identity?:string}|undefined;
      try {owner=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{}
      let alive=true;
      if(owner && Number.isSafeInteger(owner.pid) && owner.pid>0) {
        try{process.kill(owner.pid,0);}catch(e){alive=(e as NodeJS.ErrnoException).code !== 'ESRCH';}
      }
      const currentIdentity = owner ? (owner.pid === process.pid ? identity : processIdentity(owner.pid)) : undefined;
      const abandoned = !alive || (owner && currentIdentity !== undefined && owner.identity !== currentIdentity)
        || (owner?.pid === process.pid && owner.identity === identity && !activeLocks.has(lock));
      if(abandoned && attempt===0){fs.unlinkSync(lock);continue;}
      throw new LibraryError(`c'è già una trascrizione in corso (da ${formatTranscriptionAge(Date.now()-(owner?.since ?? Date.now()))}): riprova quando finisce`,409);
    }
  }
  if(fd===undefined)throw new LibraryError('Trascrizione occupata',409);
  activeLocks.add(lock);
  try {fs.writeFileSync(fd,JSON.stringify({pid:process.pid,since:Date.now(),identity}));return await fn();}
  finally {activeLocks.delete(lock);fs.closeSync(fd);fs.rmSync(lock,{force:true});}
}

/** Attesa riservata all'ingest; le route continuano a usare exclusive direttamente. */
export async function exclusiveWithRetry<T>(fn: () => Promise<T>, maxWaitMs = 30 * 60_000): Promise<T> {
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) throw new Error('Attesa lock non valida');
  const deadline = performance.now() + maxWaitMs;
  let delay = 1000;
  for (;;) {
    try { return await exclusive(fn); }
    catch (error) {
      if (!(error instanceof LibraryError) || error.status !== 409) throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(delay, remaining)));
      delay = Math.min(delay * 2, 30_000);
    }
  }
}
