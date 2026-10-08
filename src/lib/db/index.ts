import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { EMBED_DIM } from "@/lib/config";
import { SCHEMA_SQL } from "./schemaSql";

const path = process.env.DB_PATH ?? "studybuddy.db";

export const sqlite = new Database(path);
sqlite.pragma("journal_mode = WAL");
sqliteVec.load(sqlite);

export const db = drizzle(sqlite, { schema });

/**
 * DB nuovo (nessuna tabella): crea lo schema Drizzle da `schemaSql.ts`, così il primo
 * avvio funziona anche dove drizzle-kit non c'è (Docker). Su un DB che ha già tabelle
 * non fa nulla: le aggiunte successive le fanno le `ensure*Schema()`.
 */
export function initSchema() {
  // Controllo e creazione nella stessa transazione IMMEDIATE: `next build` apre il DB da
  // più worker in parallelo, e su un file nuovo il check fuori dalla transazione corre.
  sqlite.transaction(() => {
    const n = (sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
    if (n > 0) return;
    for (const stmt of SCHEMA_SQL) sqlite.exec(stmt);
  }).immediate();
}

/**
 * Aggiorna un DB già esistente alle aggiunte della Libreria (`domains.areas`,
 * `ingested_files`) senza `db:push`, che non conosce vec_chunks/chunks_fts.
 * Idempotente; su un DB vuoto non fa nulla (lo schema lo crea drizzle).
 */
export function ensureLibrarySchema() {
  const cols = sqlite.prepare("PRAGMA table_info(domains)").all() as { name: string }[];
  if (!cols.length) return;
  if (!cols.some((c) => c.name === "areas")) {
    sqlite.exec("ALTER TABLE domains ADD COLUMN areas text DEFAULT '[]' NOT NULL");
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS ingested_files (
    domain_id integer NOT NULL REFERENCES domains(id),
    source text NOT NULL,
    file_hash text NOT NULL,
    PRIMARY KEY (domain_id, source)
  )`);
}
initSchema();
ensureLibrarySchema();

/** Crea la virtual table degli embedding. Idempotente. */
export function initVectorStore() {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[${EMBED_DIM}]
    );
  `);
}
