/**
 * Genera `src/lib/db/schemaSql.ts`: lo SQL che crea lo schema Drizzle su un DB vuoto.
 * Serve a creare un DB nuovo senza drizzle-kit (devDependency, assente in Docker).
 * Le tabelle virtuali vec0/FTS5 le crea l'app al primo uso.
 *
 *   npm run db:schema
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function generateSchemaSql(): Promise<string[]> {
  const schema = await import("@/lib/db/schema");
  const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import("drizzle-kit/api");
  const prev = await generateSQLiteDrizzleJson({});
  const cur = await generateSQLiteDrizzleJson({ ...schema });
  return generateSQLiteMigration(prev, cur);
}

export function renderModule(stmts: string[]): string {
  return (
    "// Generato da `npm run db:schema` (scripts/schema-sql.ts): non modificare a mano.\n" +
    "// Lo esegue `initSchema()` in lib/db/index.ts solo su un DB senza tabelle.\n" +
    `export const SCHEMA_SQL: string[] = ${JSON.stringify(stmts, null, 2)};\n`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.resolve("src/lib/db/schemaSql.ts");
  generateSchemaSql()
    .then((s) => { fs.writeFileSync(out, renderModule(s)); console.log(`Scritto ${out} (${s.length} istruzioni)`); })
    .catch((e) => { console.error(e); process.exit(1); });
}
