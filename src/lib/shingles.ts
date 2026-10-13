/** Confronti lessicali puri (niente DB né provider): usabili anche nel browser. */

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
