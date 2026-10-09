import type { TranscriptCue } from "@/lib/rag/chunk";

/** Parser SRT/VTT puro (niente DB): lo usano l'ingest dei corsi e la trascrizione. */
/** "00:01:23,456" o "00:01:23.456" -> secondi. */
function tsToSec(ts: string): number {
  const [h, m, s] = ts.replace(",", ".").split(":");
  return (+h) * 3600 + (+m) * 60 + parseFloat(s);
}

/** Parser SRT/VTT -> cue con timestamp. */
export function parseSubtitles(raw: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const blocks = raw.replace(/\r/g, "").split(/\n\n+/);
  const timeRe = /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/;
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() && l.trim() !== "WEBVTT");
    const tline = lines.find((l) => timeRe.test(l));
    if (!tline) continue;
    const m = tline.match(timeRe)!;
    const text = lines
      .filter((l) => !timeRe.test(l) && !/^\d+$/.test(l.trim()))
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text) cues.push({ startSec: tsToSec(m[1]), endSec: tsToSec(m[2]), text });
  }
  return cues;
}
