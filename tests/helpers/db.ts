import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * DB SQLite temporaneo con lo schema Drizzle. Va chiamato PRIMA di importare
 * (dinamicamente) i moduli che usano "@/lib/db": quel modulo apre `DB_PATH` all'import.
 * `node --test` esegue ogni file in un processo a sé, quindi un DB per file di test.
 */
export async function useTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  const { sqlite } = await import("@/lib/db");
  const schema = await import("@/lib/db/schema");
  const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import("drizzle-kit/api");
  const prev = await generateSQLiteDrizzleJson({});
  const cur = await generateSQLiteDrizzleJson({ ...schema });
  for (const stmt of await generateSQLiteMigration(prev, cur)) sqlite.exec(stmt);
  return { dir, sqlite };
}
