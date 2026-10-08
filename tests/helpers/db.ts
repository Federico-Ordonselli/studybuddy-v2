import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * DB SQLite temporaneo con lo schema (lo crea `initSchema()` all'import di "@/lib/db").
 * Va chiamato PRIMA di importare
 * (dinamicamente) i moduli che usano "@/lib/db": quel modulo apre `DB_PATH` all'import.
 * `node --test` esegue ogni file in un processo a sé, quindi un DB per file di test.
 */
export async function useTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  const { sqlite } = await import("@/lib/db");
  return { dir, sqlite };
}
