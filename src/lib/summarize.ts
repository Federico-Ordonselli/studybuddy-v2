import { and, eq, sql } from "drizzle-orm";
import { generate } from "@/lib/providers";
import { db } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";
import { vectorSearch } from "@/lib/rag/store";

/**
 * Riassunti map-reduce sui chunk di un argomento o di un intero modulo.
 * map: riassunti parziali a blocchi; reduce: sintesi finale strutturata.
 */
const BATCH = 6;

async function summarizeBatch(texts: string[], topic: string, partial: boolean): Promise<string> {
  const body = texts.map((t, i) => `[${i + 1}] ${t}`).join("\n\n");
  const system = partial
    ? "Riassumi i passaggi in pochi punti concisi, conservando i concetti chiave. Rispondi solo col riassunto."
    : "Sei un tutor. Scrivi un riassunto chiaro e strutturato in markdown (titoletti brevi + elenchi puntati) " +
      "basato ESCLUSIVAMENTE sui passaggi forniti. Niente preamboli. Lingua: quella dei passaggi.";
  return generate("summarize", {
    system: topic ? `${system}\nTema: ${topic}` : system,
    temperature: 0.3,
    maxTokens: 1200,
    messages: [{ role: "user", content: body }],
  });
}

/** Map-reduce su una lista di testi. */
export async function mapReduceSummary(texts: string[], topic = ""): Promise<string> {
  if (!texts.length) return "_Nessun materiale trovato per questo argomento._";
  if (texts.length <= BATCH) return summarizeBatch(texts, topic, false);

  const partials: string[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    partials.push(await summarizeBatch(texts.slice(i, i + BATCH), topic, true));
  }
  return summarizeBatch(partials, topic, false);
}

/** Riassunto di un argomento (recupero per similarità nel dominio). */
export async function summarizeTopic(domainId: number, topic: string): Promise<string> {
  const found = await vectorSearch(topic, 20, domainId);
  return mapReduceSummary(found.map((c) => c.content), topic);
}

/** Riassunto di un intero modulo (tutti i suoi chunk, vero map-reduce). */
export async function summarizeModule(domainId: number, module: string): Promise<string> {
  const rows = db
    .select({ content: chunks.content })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(eq(documents.domainId, domainId), sql`json_extract(${documents.meta}, '$.module') = ${module}`))
    .all();
  return mapReduceSummary(rows.map((r) => r.content), module);
}
