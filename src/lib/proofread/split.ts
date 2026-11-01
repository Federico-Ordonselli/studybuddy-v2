/**
 * Divide il corpo di una nota in sezioni da correggere una alla volta: per titolo
 * (`#`…`######`), poi per paragrafi se una sezione supera il budget. Concatenare le
 * sezioni restituisce esattamente il testo di partenza (gli a capo restano dove sono).
 */

export const SECTION_BUDGET = 5000; // caratteri: ~1500 token in ingresso, altrettanti in uscita

export function splitSections(body: string, budget = SECTION_BUDGET): string[] {
  if (!body) return [];
  // taglio prima di ogni riga-titolo (fuori dai blocchi di codice)
  const parts: string[] = [];
  let current = "";
  let fence: string | null = null;
  for (const line of body.split(/(?<=\n)/)) {
    const marker = line.match(/^(`{3,}|~{3,})/)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) fence = fence ? null : marker;
    if (!fence && !marker && /^#{1,6}\s/.test(line) && current.trim()) {
      parts.push(current);
      current = "";
    }
    current += line;
  }
  if (current) parts.push(current);
  return merge(parts.flatMap((p) => (p.length > budget ? byParagraph(p, budget) : [p])), budget);
}

/** Paragrafi (righe vuote come separatore); un paragrafo enorme si taglia per righe. */
function byParagraph(text: string, budget: number): string[] {
  const paras = text.split(/(?<=\n[ \t]*\n)/);
  return merge(paras.flatMap((p) => (p.length > budget ? p.split(/(?<=\n)/) : [p])), budget);
}

/** Riunisce i pezzi piccoli finché stanno nel budget: meno chiamate al modello. */
function merge(pieces: string[], budget: number): string[] {
  const out: string[] = [];
  for (const p of pieces) {
    if (out.length && out[out.length - 1].length + p.length <= budget) out[out.length - 1] += p;
    else out.push(p);
  }
  return out;
}

/** Paragrafi separati da righe vuote, senza riunirli (ripiego quando una sezione è scartata). */
export function splitParagraphs(text: string): string[] {
  return text.split(/(?<=\n[ \t]*\n)/).filter((p) => p.length);
}
