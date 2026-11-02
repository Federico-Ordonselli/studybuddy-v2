/**
 * Protegge le parti di una nota Markdown che il correttore non deve toccare: blocchi di
 * codice, codice inline, formule, wikilink/embed di Obsidian, URL dei link, URL nudi,
 * commenti HTML e tag. Al loro posto va un segnaposto `⟦n⟧`, poi `restore` li rimette.
 * Puro (niente DB né provider).
 */

export const PLACEHOLDER = /⟦(\d+)⟧/g;

/** Ordine importante: prima i blocchi (che possono contenere tutto il resto). */
const PATTERNS: RegExp[] = [
  /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, // blocchi recintati
  /\$\$[\s\S]+?\$\$/g,                          // formule a blocco
  /<!--[\s\S]*?-->/g,                           // commenti HTML
  /%%[\s\S]*?%%/g,                              // commenti Obsidian
  /`[^`\n]+`/g,                                 // codice inline
  /!?\[\[[^\]\n]+\]\]/g,                        // wikilink ed embed
  /(?<=\])\([^)\s]+(?:\s+"[^"\n]*")?\)/g,         // destinazione di un link Markdown (il testo resta correggibile)
  /<https?:\/\/[^>\s]+>/g,                      // autolink
  /https?:\/\/[^\s)>\]]+/g,                     // URL nudi
  /(?<![\p{L}\p{N}$])\$[^$\n]+\$(?![\p{N}])/gu, // formule inline $…$
  /<\/?[a-zA-Z][^>\n]*>/g,                      // tag HTML
  /(?<![\p{L}\p{N}_/])#[\p{L}\p{N}_/-]*[\p{L}_][\p{L}\p{N}_/-]*/gu, // #tag di Obsidian
];

export interface Protected {
  text: string;
  slots: string[];
}

/**
 * Con `trailingWord` anche l'ultima parola diventa un segnaposto, se il testo finisce con
 * una lettera senza a capo: è la parola che stai ancora scrivendo, non va completata.
 */
export function protect(text: string, opts: { trailingWord?: boolean } = {}): Protected {
  const slots: string[] = [];
  let out = text;
  for (const re of PATTERNS) {
    // ogni pattern gira sul testo già protetto: niente annidamenti fra segnaposto
    out = out.replace(re, (m) => {
      slots.push(m);
      return `⟦${slots.length - 1}⟧`;
    });
  }
  if (opts.trailingWord) {
    out = out.replace(/[\p{L}\p{N}'’-]*\p{L}$/u, (m) => {
      slots.push(m);
      return `⟦${slots.length - 1}⟧`;
    });
  }
  return { text: out, slots };
}

/**
 * Rimette i segnaposto. Restituisce null se il modello ne ha perso, duplicato o inventato
 * qualcuno: in quel caso la sezione corretta non è affidabile.
 */
export function restore(text: string, slots: string[]): string | null {
  const seen = new Map<number, number>();
  for (const m of text.matchAll(PLACEHOLDER)) {
    const n = Number(m[1]);
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  if (seen.size !== slots.length) return null;
  for (let i = 0; i < slots.length; i++) if (seen.get(i) !== 1) return null;
  return text.replace(PLACEHOLDER, (_, n) => slots[Number(n)]);
}

/** Frontmatter YAML iniziale: non si manda al modello. */
export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return m ? { frontmatter: m[0], body: text.slice(m[0].length) } : { frontmatter: "", body: text };
}
