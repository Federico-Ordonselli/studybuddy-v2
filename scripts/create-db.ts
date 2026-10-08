/**
 * Crea un DB nuovo con lo schema Drizzle (tabelle "normali"; vec0 e FTS5 le crea
 * l'app al primo uso). Rifiuta di toccare un file esistente.
 *
 *   DB_PATH=/percorso/nuovo.db npx tsx scripts/create-db.ts
 */
import fs from "node:fs";

async function main() {
  const target = process.env.DB_PATH;
  if (!target) throw new Error("DB_PATH richiesto");
  if (fs.existsSync(target)) throw new Error(`${target} esiste già: non lo tocco`);
  const { sqlite } = await import("@/lib/db");
  const schema = await import("@/lib/db/schema");
  const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import("drizzle-kit/api");
  const prev = await generateSQLiteDrizzleJson({});
  const cur = await generateSQLiteDrizzleJson({ ...schema });
  for (const stmt of await generateSQLiteMigration(prev, cur)) sqlite.exec(stmt);
  console.log(`Creato ${target}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
