/**
 * Crea un DB nuovo (lo schema lo crea `initSchema()` all'apertura; vec0 e FTS5 le crea
 * l'app al primo uso). Rifiuta di toccare un file esistente.
 *
 *   DB_PATH=/percorso/nuovo.db npx tsx scripts/create-db.ts
 */
import fs from "node:fs";

async function main() {
  const target = process.env.DB_PATH;
  if (!target) throw new Error("DB_PATH richiesto");
  if (fs.existsSync(target)) throw new Error(`${target} esiste già: non lo tocco`);
  await import("@/lib/db"); // initSchema() crea lo schema sul file nuovo
  console.log(`Creato ${target}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
