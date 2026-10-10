import { rag } from "@/lib/config";
import type { ChunkRecord } from "./store";

/** Stima grezza: ~4 char per token. Sostituibile con un tokenizer reale. */
const approxTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Spezza un blocco che da solo supera il budget: prima per righe, poi per frasi,
 * infine taglio secco. Serve per l'HTML (structuredText separa i blocchi con un
 * solo "\n", quindi una pagina intera è un unico "paragrafo") e per PDF senza a capo.
 */
function splitOversize(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  for (const sep of [/\n/, /(?<=[.!?;])\s+/, /\s+/]) {
    const parts = text.split(sep).filter(Boolean);
    if (parts.length < 2) continue;
    const joiner = sep.source === "\\n" ? "\n" : " ";
    const out: string[] = [];
    let buf = "";
    for (const part of parts.flatMap((p) => splitOversize(p, max))) {
      if (buf && buf.length + joiner.length + part.length > max) { out.push(buf); buf = part; }
      else buf = buf ? buf + joiner + part : part;
    }
    if (buf) out.push(buf);
    return out;
  }
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

/**
 * Chunking semplice e robusto: divide per paragrafi e accorpa fino a ~chunkTokens,
 * con overlap. I paragrafi troppo lunghi vengono spezzati (splitOversize).
 * TODO(claude-code): chunking strutturale (heading-aware) per i PDF.
 */
export function chunkText(text: string): string[] {
  // Spazio per l'overlap che viene anteposto al pezzo successivo.
  const max = Math.max(1, (rag.chunkTokens - rag.chunkOverlap) * 4 - 2);
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .flatMap((p) => splitOversize(p, max));
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
  const bounded = cues.flatMap(c => splitOversize(c.text, rag.chunkTokens * 4).map(text => ({...c,text})));
  for (const c of bounded) {
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
