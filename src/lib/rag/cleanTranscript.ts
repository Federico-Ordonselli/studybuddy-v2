/**
 * Pulizia del parlato trascritto prima di generare carte (Fase 3): toglie riempitivi, frasi
 * di servizio («welcome back», «nel prossimo video») e ripetizioni consecutive. Si usa solo
 * per generare, mai per l'indice: le citazioni devono restare fedeli al video.
 */

const FILLERS = /\b(?:u+m+|u+h+|erm|ehm)\b,?\s*/gi;
const YOU_KNOW = /,\s*you know\s*,|\byou know,\s*/gi;   // solo come inciso: «do you know what…» resta
const SO_BASICALLY = /\bso basically,?\s*/gi;

/** Frasi che parlano del corso invece che della materia. */
const SERVICE = new RegExp([
  "welcome back", "thanks for watching", "let'?s get started", "let'?s dive in", "see you (?:in the next|next time)",
  "in (?:this|the next|the previous|the last|an upcoming|a later) (?:video|lesson|module|reading|course)",
  "bentornat[oie]", "grazie per (?:la visione|l'attenzione)", "ci vediamo", "iniziamo subito",
  "(?:in|nel(?:la)?) (?:questo|questa|prossim[oa]|precedente) (?:video|lezione|modulo)",
].map((p) => `\\b${p}\\b`).join("|"), "i");

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
const capitalize = (s: string) => s.replace(/^\p{Ll}/u, (c) => c.toUpperCase());

export function cleanTranscript(text: string): string {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  for (const raw of sentences) {
    if (SERVICE.test(raw)) continue;
    const s = capitalize(raw
      .replace(YOU_KNOW, " ")
      .replace(FILLERS, "")
      .replace(SO_BASICALLY, "")
      .replace(/\b(\p{L}[\p{L}\p{N}']*)(?:\s+\1\b)+/giu, "$1")   // «the the» → «the»
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim());
    if (!words(s)) continue;
    if (out.length && words(out[out.length - 1]) === words(s)) continue; // frase ripetuta
    out.push(s);
  }
  return out.join(" ");
}
