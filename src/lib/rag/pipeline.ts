import fs from "node:fs";
import path from "node:path";
import { rag } from "@/lib/config";
import { vectorSearch, ftsSearch, type Retrieved } from "./store";
import { rerank } from "./rerank";

/**
 * Reciprocal Rank Fusion: fonde più liste ordinate per posizione (non per score,
 * così non serve normalizzare cosine vs BM25). score(d) = Σ 1/(rrfK + rank_d).
 */
export function rrfFuse(lists: Retrieved[][], k: number): Retrieved[] {
  const score = new Map<number, number>();
  const byId = new Map<number, Retrieved>();
  for (const list of lists) {
    list.forEach((r, rank) => {
      score.set(r.chunkId, (score.get(r.chunkId) ?? 0) + 1 / (rag.rrfK + rank + 1));
      if (!byId.has(r.chunkId)) byId.set(r.chunkId, r);
    });
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => byId.get(id)!);
}

/** Recupera i candidati: hybrid (dense + BM25, fusi via RRF) oppure solo dense. */
export async function hybridSearch(query: string, k: number, domainId?: number): Promise<Retrieved[]> {
  const [dense, sparse] = await Promise.all([
    vectorSearch(query, k, domainId),
    Promise.resolve(ftsSearch(query, k, domainId)),
  ]);
  return rrfFuse([dense, sparse], k);
}

/** retrieve -> rerank. Restituisce i chunk migliori da usare come contesto. */
export async function retrieve(query: string, domainId?: number): Promise<Retrieved[]> {
  const candidates = rag.hybrid
    ? await hybridSearch(query, rag.topK, domainId)
    : await vectorSearch(query, rag.topK, domainId);
  const ranked = await rerank(query, candidates, candidates.length, true);
  return dedupChunks(ranked).slice(0, rag.topN);
}

export function asContext(chunks: Retrieved[]): string {
  return chunks.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n");
}

/** Citazione mostrata in UI: etichetta leggibile + (per le trascrizioni) deep-link al video. */
export interface Citation {
  n: number; // indice [n] usato nel testo / contesto
  documentId: number;
  kind: string;
  label: string;
  snippet: string;
  startSec?: number;
  endSec?: number;
  video?: { path: string; startSec: number };
}

const sec = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** Ricava il path del video per una trascrizione: il .mp4 gemello dell'srt, o il
 *  video stesso se la trascrizione viene da Whisper (source già .mp4). */
function videoFor(source: string | null | undefined): string | undefined {
  if (!source) return undefined;
  if (/\.(mp4|mkv|webm|mov)$/i.test(source)) return fs.existsSync(source) ? source : undefined;
  const mp4 = source.replace(/\.(en\.)?(srt|vtt)$/i, ".mp4");
  return mp4 !== source && fs.existsSync(mp4) ? mp4 : undefined;
}

/** Costruisce le citazioni dai chunk recuperati, numerate come in `asContext` ([n] = i+1). */
export function toCitations(chunks: Retrieved[]): Citation[] {
  return chunks.map((c, i) => {
    const dm = (c.docMeta ?? {}) as { crumbs?: string[] };
    const file = c.source ? path.basename(c.source) : `doc ${c.documentId}`;
    const label = [...(dm.crumbs ?? []), file].join(" › ");
    const startSec = sec(c.meta?.startSec);
    const mp4 = c.docKind === "transcript" ? videoFor(c.source) : undefined;
    return {
      n: i + 1,
      documentId: c.documentId,
      kind: c.docKind ?? "text",
      label,
      snippet: c.content.slice(0, 240),
      startSec,
      endSec: sec(c.meta?.endSec),
      video: mp4 ? { path: mp4, startSec: startSec ?? 0 } : undefined,
    };
  });
}

/** Shingle di tre parole, con fallback per i testi più corti. */
export function wordShingles(text: string): Set<string> {
  const words = text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const size = Math.min(3, words.length);
  return new Set(size ? Array.from({length: words.length - size + 1}, (_,i) => words.slice(i,i+size).join(" ")) : []);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Conserva l'ordine del reranker; una trascrizione sostituisce un duplicato senza timestamp. */
export function dedupChunks(chunks: Retrieved[], threshold = rag.dedupThreshold): Retrieved[] {
  const kept: Retrieved[] = [];
  for (const chunk of chunks) {
    const matches = kept.map((c,i) => jaccard(wordShingles(c.content), wordShingles(chunk.content)) >= threshold ? i : -1).filter(i => i >= 0);
    if (!matches.length) kept.push(chunk);
    else if (chunk.docKind === "transcript" && matches.every(i => kept[i].docKind !== "transcript")) {
      kept[matches[0]] = chunk;
      for (const i of matches.slice(1).reverse()) kept.splice(i,1);
    }
  }
  return kept;
}
