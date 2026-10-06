import { rag } from "@/lib/config";
import type { ChunkRecord } from "./store";

/** Stima grezza: ~4 char per token. Sostituibile con un tokenizer reale. */
const approxTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Chunking semplice e robusto: divide per paragrafi e accorpa fino a ~chunkTokens,
 * con overlap. TODO(claude-code): chunking strutturale (heading-aware) per i PDF.
 */
export function chunkText(text: string): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (approxTokens(buf + "\n\n" + p) > rag.chunkTokens && buf) {
      out.push(buf);
      const tail = buf.slice(-rag.chunkOverlap * 4);
      buf = tail + "\n\n" + p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export interface TranscriptCue {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Chunking per trascrizioni: accorpa i cue (con timestamp) in finestre di ~chunkTokens,
 * conservando lo startSec del primo cue per linkare al punto del video.
 */
export function chunkTranscript(cues: TranscriptCue[]): ChunkRecord[] {
  const out: ChunkRecord[] = [];
  let buf = "";
  let start = cues[0]?.startSec ?? 0;
  let end = start;
  for (const c of cues) {
    if (approxTokens(buf + " " + c.text) > rag.chunkTokens && buf) {
      out.push({ content: buf.trim(), meta: { startSec: start, endSec: end } });
      buf = c.text;
      start = c.startSec;
    } else {
      buf = buf ? buf + " " + c.text : c.text;
    }
    end = c.endSec;
  }
  if (buf) out.push({ content: buf.trim(), meta: { startSec: start, endSec: end } });
  return out;
}
