/**
 * CLI di ingestion Coursera.
 *
 *   npm run ingest -- <cartella-corso> <nome-dominio> [--whisper]
 *
 * Trova (o crea) il dominio per nome e ci indicizza dentro la cartella indicata
 * via `ingestCourse`. Pensata per cartelle grandi: niente HTTP, gira in-process.
 * `--whisper` trascrive i video senza .srt/.vtt (richiede un backend Whisper).
 */
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { domains } from "@/lib/db/schema";
import { ingestCourse } from "@/lib/rag/sources/coursera";

async function main() {
  const argv = process.argv.slice(2);
  const whisper = argv.includes("--whisper");
  const positional = argv.filter((a) => !a.startsWith("--"));
  const [dir, ...rest] = positional;
  const domainName = rest.join(" ").trim();
  if (!dir || !domainName) {
    console.error("Uso: npm run ingest -- <cartella-corso> <nome-dominio> [--whisper]");
    process.exit(1);
  }

  const courseDir = path.resolve(dir);
  let [domain] = await db.select().from(domains).where(eq(domains.name, domainName));
  if (!domain) {
    [domain] = await db.insert(domains).values({ name: domainName }).returning();
    console.log(`Creato dominio "${domainName}" (id ${domain.id})`);
  } else {
    console.log(`Dominio esistente "${domainName}" (id ${domain.id})`);
  }

  console.log(`Ingestione di ${courseDir} ${whisper ? "(+whisper) " : ""}...`);
  const t0 = Date.now();
  const stats = await ingestCourse(courseDir, domain.id, { whisper });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(
    `\nFatto in ${secs}s:\n` +
      `  documenti indicizzati : ${stats.documents}\n` +
      `  chunk indicizzati     : ${stats.chunks}\n` +
      `  video trascritti      : ${stats.transcribed}\n` +
      `  file invariati saltati : ${stats.unchanged}\n` +
      `  documenti sostituiti  : ${stats.replaced}\n` +
      `  chunk duplicati saltati: ${stats.dedupedChunks}\n` +
      `  .txt gemelli saltati  : ${stats.skippedTxtTwins}\n` +
      `  file in errore        : ${stats.errors}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
