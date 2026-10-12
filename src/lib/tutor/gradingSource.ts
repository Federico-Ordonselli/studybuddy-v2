import { retrieve, toCitations, type Citation } from "@/lib/rag/pipeline";
import { getChunk, type Retrieved } from "@/lib/rag/store";

/** Quanto del passaggio sorgente vede il giudice. */
export const SOURCE_CHARS = 1500;

export interface GradingSource {
  text: string;       // per il prompt del giudice
  citation: Citation; // per il link in UI (video al minuto se è una trascrizione)
}

/**
 * Il passaggio con cui giudicare una risposta: il chunk da cui è nata la carta, altrimenti
 * (carte da quiz, domande aperte del quiz) il primo risultato del retrieve sulla domanda.
 * Se il retrieve fallisce si giudica senza sorgente: non è un motivo per non valutare.
 */
export async function gradingSource(question: string, sourceChunkId: number | null | undefined, domainId: number | null | undefined): Promise<GradingSource | null> {
  let chunk: Retrieved | null | undefined = sourceChunkId ? getChunk(sourceChunkId) : null;
  if (!chunk) {
    try {
      [chunk] = await retrieve(question, domainId ?? undefined);
    } catch (e) {
      console.warn("[grade] sorgente non disponibile, giudizio senza passaggio:", e instanceof Error ? e.message : e);
    }
  }
  if (!chunk) return null;
  return { text: chunk.content.slice(0, SOURCE_CHARS), citation: toCitations([chunk])[0] };
}
