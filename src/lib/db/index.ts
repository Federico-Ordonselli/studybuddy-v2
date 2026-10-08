import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { EMBED_DIM } from "@/lib/config";

const path = process.env.DB_PATH ?? "studybuddy.db";

export const sqlite = new Database(path);
sqlite.pragma("journal_mode = WAL");
sqliteVec.load(sqlite);

export const db = drizzle(sqlite, { schema });

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
