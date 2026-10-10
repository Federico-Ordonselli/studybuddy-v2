import { eq } from "drizzle-orm";
import { db, sqlite, initVectorStore } from "@/lib/db";
import { chunks } from "@/lib/db/schema";
import { embed } from "@/lib/providers";

export interface ChunkRecord {
  content: string;
  meta?: Record<string, unknown>; // es. { startSec, endSec } per trascrizioni
}

export interface Retrieved {
  chunkId: number;
  documentId: number;
  content: string;
  distance: number;
  meta?: Record<string, unknown>;       // meta del chunk (es. startSec/endSec)
  source?: string | null;               // path/url del documento sorgente
  docKind?: string;                     // transcript | html | pdf | text
  docMeta?: Record<string, unknown>;    // meta del documento (course/crumbs/...)
}

/** Cancella i chunk di un documento (righe `chunks` + relativi embedding). */
export function deleteDocumentChunks(documentId: number) {
  initVectorStore();
  const rows = sqlite
    .prepare("SELECT id FROM chunks WHERE document_id = ?")
    .all(documentId) as Array<{ id: number }>;
  initFts();
  const delVec = sqlite.prepare("DELETE FROM vec_chunks WHERE chunk_id = ?");
  const delFts = sqlite.prepare("DELETE FROM chunks_fts WHERE rowid = ?");
  // Le carte puntano al chunk da cui sono nate (attribuzione best-effort): senza
  // sganciarle la FK fa fallire il re-ingest dei documenti che hanno carte.
  const unlinkCards = sqlite.prepare(
    "UPDATE cards SET source_chunk_id = NULL WHERE source_chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)"
  );
  // Tutto o niente: un errore a metà lascerebbe chunk senza vettori/FTS.
  sqlite.transaction(() => {
    for (const r of rows) {
      delVec.run(BigInt(r.id)); // sqlite-vec: PK come BigInt
      delFts.run(r.id);
    }
    unlinkCards.run(documentId);
    db.delete(chunks).where(eq(chunks.documentId, documentId)).run();
  })();
}

/** Salva i chunk (+ embedding) di un documento. */
export async function indexChunks(documentId: number, records: ChunkRecord[]) {
  initVectorStore();
  initFts();
  const vectors = await embed(records.map((r) => r.content));
  const insertVec = sqlite.prepare(
    "INSERT INTO vec_chunks(chunk_id, embedding, domain_id) VALUES (?, ?, ?)"
  );
  const document = sqlite.prepare("SELECT domain_id FROM documents WHERE id = ?").get(documentId) as {domain_id: number | null} | undefined;
  if (!document) throw new Error("Documento non trovato");
  const insertFts = sqlite.prepare(
    "INSERT INTO chunks_fts(rowid, content, document_id) VALUES (?, ?, ?)"
  );
  for (let i = 0; i < records.length; i++) {
    const [row] = await db
      .insert(chunks)
      .values({ documentId, ordinal: i, content: records[i].content, meta: records[i].meta ?? null })
      .returning({ id: chunks.id });
    // sqlite-vec vuole la primary key come BigInt: un JS `number` viene rifiutato
    // con "Only integers are allowed for primary key values".
    insertVec.run(BigInt(row.id), JSON.stringify(vectors[i]), BigInt(document.domain_id ?? 0));
    insertFts.run(row.id, records[i].content, documentId); // rowid = chunk id
  }
}

/**
 * Espande un dominio nel suo scope: un `macro` include tutti i micro-corsi figli.
 * Unica regola condivisa da retrieval, conteggi in UI e coda del ripasso.
 */
export function resolveScope(domainId?: number): number[] | null {
  if (domainId == null) return null;
  const kids = sqlite.prepare("SELECT id FROM domains WHERE parent_id = ?").all(domainId) as Array<{ id: number }>;
  return [domainId, ...kids.map((k) => k.id)];
}

// --- BM25 / FTS5 (sparse) ---------------------------------------------------

/** Crea la full-text table (idempotente). `rowid` = chunk id, così è in sync col dense. */
export function initFts() {
  sqlite.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
       content, document_id UNINDEXED,
       tokenize='porter unicode61 remove_diacritics 2'
     );`
  );
}

/** Ricostruisce l'indice FTS dai chunk esistenti (usato per backfill/reindex). */
export function reindexFts() {
  initFts();
  sqlite.exec("DELETE FROM chunks_fts;");
  const ins = sqlite.prepare("INSERT INTO chunks_fts(rowid, content, document_id) VALUES (?, ?, ?)");
  const rows = sqlite.prepare("SELECT id, content, document_id FROM chunks").all() as Array<{
    id: number; content: string; document_id: number;
  }>;
  sqlite.transaction((rs: typeof rows) => { for (const r of rs) ins.run(r.id, r.content, r.document_id); })(rows);
}

/** Backfill una tantum se la FTS è vuota ma ci sono già chunk indicizzati. */
function ensureFts() {
  initFts();
  const fts = (sqlite.prepare("SELECT count(*) AS c FROM chunks_fts").get() as { c: number }).c;
  if (fts === 0) {
    const total = (sqlite.prepare("SELECT count(*) AS c FROM chunks").get() as { c: number }).c;
    if (total > 0) reindexFts();
  }
}

/** Query utente → espressione FTS5 (termini quotati in OR, per recall). */
function toFtsQuery(q: string): string | null {
  const terms = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => t.length >= 2)
    .slice(0, 16);
  if (!terms.length) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

/** Ricerca lessicale BM25. Ritorna i chunk ordinati per pertinenza (più rilevante prima). */
export function ftsSearch(query: string, k: number, domainId?: number): Retrieved[] {
  ensureFts();
  const match = toFtsQuery(query);
  if (!match) return [];
  const scope = resolveScope(domainId);
  const domClause = scope ? `AND d.domain_id IN (${scope.map(() => "?").join(",")})` : "";
  const rows = sqlite
    .prepare(
      `SELECT f.rowid AS chunkId, bm25(chunks_fts) AS distance,
              c.content AS content, c.document_id AS documentId, c.meta AS meta,
              d.source AS source, d.kind AS docKind, d.meta AS docMeta
       FROM chunks_fts f
       JOIN chunks c ON c.id = f.rowid
       JOIN documents d ON d.id = c.document_id
       WHERE chunks_fts MATCH ? ${domClause}
       ORDER BY bm25(chunks_fts) LIMIT ?`
    )
    .all(match, ...(scope ?? []), k) as Array<Omit<VecRow, "domainId">>;

  return rows.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    content: r.content,
    distance: r.distance,
    meta: r.meta ? JSON.parse(r.meta) : undefined,
    source: r.source,
    docKind: r.docKind,
    docMeta: r.docMeta ? JSON.parse(r.docMeta) : undefined,
  }));
}

interface VecRow {
  chunkId: number;
  distance: number;
  content: string;
  documentId: number;
  meta: string | null;
  source: string | null;
  docKind: string;
  docMeta: string | null;
  domainId: number | null;
}

/** kNN sul vector store. Se `domainId` è dato, limita ai chunk di quel dominio. */
export async function vectorSearch(query: string, k: number, domainId?: number): Promise<Retrieved[]> {
  initVectorStore();
  const [qv] = await embed([query]);
  return vectorSearchByEmbedding(qv, k, domainId);
}

/** Ricerca con embedding pronto, testabile senza provider. */
export function vectorSearchByEmbedding(qv: number[], k: number, domainId?: number): Retrieved[] {
  initVectorStore();
  const scope = resolveScope(domainId);

  const domClause = scope ? `AND v.domain_id IN (${scope.map(() => "?").join(",")})` : "";
  const rows = sqlite
    .prepare(
      `SELECT v.chunk_id AS chunkId, v.distance AS distance,
              c.content AS content, c.document_id AS documentId, c.meta AS meta,
              d.source AS source, d.kind AS docKind, d.meta AS docMeta, d.domain_id AS domainId
       FROM vec_chunks v
       JOIN chunks c ON c.id = v.chunk_id
       JOIN documents d ON d.id = c.document_id
       WHERE v.embedding MATCH ? AND k = ? ${domClause} ORDER BY v.distance`
    )
    .all(JSON.stringify(qv), k, ...(scope ?? []).map(BigInt)) as VecRow[];

  return rows.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    content: r.content,
    distance: r.distance,
    meta: r.meta ? JSON.parse(r.meta) : undefined,
    source: r.source,
    docKind: r.docKind,
    docMeta: r.docMeta ? JSON.parse(r.docMeta) : undefined,
  }));
}
