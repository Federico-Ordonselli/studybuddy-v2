/** Ricostruisce vec_chunks su una COPIA. Dry-run predefinito; --apply crea --target, mai sovrascrive. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { EMBED_DIM } from '../src/lib/config';

const args = process.argv.slice(2);
let from: string | undefined, target: string | undefined, apply = false;
for (let i=0;i<args.length;i++) {
  if (args[i] === '--apply') apply = true;
  else if (args[i] === '--from') from = args[++i];
  else if (args[i] === '--target') target = args[++i];
  else throw new Error(`Argomento sconosciuto: ${args[i]}`);
}
if (!from || !target) throw new Error('Uso: tsx scripts/migrate-vec-domain.ts --from <sorgente.db> --target <nuovo.db> [--apply]');
const destination = path.resolve(target);
if (fs.existsSync(destination)) throw new Error('Il target esiste già: non verrà sovrascritto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'sb-vec-migrate-'));
const work = path.join(dir,'copy.db');
let copy: Database.Database | undefined;
try {
  const source = new Database(path.resolve(from),{readonly:true,fileMustExist:true});
  try { await source.backup(work); } finally { source.close(); }
  copy = new Database(work);
  sqliteVec.load(copy);
  const rows = copy.prepare(`SELECT v.chunk_id, v.embedding, coalesce(d.domain_id,0) domain_id
    FROM vec_chunks v JOIN chunks c ON c.id=v.chunk_id JOIN documents d ON d.id=c.document_id`).all() as {chunk_id:number;embedding:Buffer;domain_id:number}[];
  copy.transaction(()=>{
    copy!.exec(`DROP TABLE vec_chunks; CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${EMBED_DIM}], domain_id INTEGER)`);
    const insert = copy!.prepare('INSERT INTO vec_chunks(chunk_id,embedding,domain_id) VALUES (?,?,?)');
    for (const row of rows) insert.run(BigInt(row.chunk_id),row.embedding,BigInt(row.domain_id));
  })();
  const total = (copy.prepare('SELECT count(*) n FROM vec_chunks').get() as {n:number}).n;
  if (total !== rows.length) throw new Error('Conteggio vettori non valido');
  console.log(`${apply ? 'Applicazione' : 'Dry-run'}: ${total} vettori ricostruiti con domain_id. Originale intatto.`);
  if (apply) {
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    // Backup della copia, poi pubblicazione esclusiva nello stesso filesystem del target.
    const pending = `${destination}.partial-${process.pid}`;
    if (fs.existsSync(pending)) throw new Error('File di lavoro già presente');
    try { await copy.backup(pending); fs.linkSync(pending,destination); }
    finally { fs.rmSync(pending,{force:true}); }
  }
} finally { copy?.close(); fs.rmSync(dir,{recursive:true,force:true}); }
