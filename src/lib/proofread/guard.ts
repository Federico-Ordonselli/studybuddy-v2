/**
 * Controllo "non hai riscritto": confronta le parole dell'originale e della correzione.
 * Un refuso corretto cambia una parola in una simile ("tecnhiche" → "tecniche"); una
 * riformulazione aggiunge, toglie o sostituisce parole diverse. Puro.
 *
 * Normalizzazione: minuscole e niente diacritici, così "e'" → "è", "perche" → "perché"
 * o "Computer" → "computer" non contano come modifiche.
 */

export interface ChangeReport {
  /** parole dell'originale */
  words: number;
  /** parole sostituite con una simile (refusi) */
  typoFixes: number;
  /** parole aggiunte, tolte o sostituite con una diversa (somma delle tre) */
  rewrites: number;
  /** di cui: parole tolte (escluse ripetizioni e lettere sole) e parole aggiunte */
  deleted: number;
  inserted: number;
  /** parole completate ("volat" → "volatile"): mai accettate */
  completions: number;
  /** tratto più lungo di parole consecutive tolte o aggiunte */
  longestGap: number;
  /** rewrites / words (0 se la sezione non ha parole) */
  rewriteRatio: number;
}

/** Sopra questa quota di parole riscritte la correzione si scarta. */
export const MAX_REWRITE_RATIO = 0.1;
/** Sotto le 20 parole una quota non dice molto: si tollerano fino a 2 parole riscritte. */
const MIN_ALLOWED_REWRITES = 2;
/**
 * Parole aggiunte: al massimo una (un articolo o una congiunzione mancante) più l'1% della
 * sezione. Parole tolte: nessuna, salvo ripetizioni ("il il") e lettere sole rimaste per
 * errore ("uscita.l"); togliere una parola vera cambia il contenuto.
 */
const MAX_INSERTED_RATIO = 0.01;

export function tokenize(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** Distanza di Levenshtein (parole brevi: va bene la versione quadratica). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** Due parole sono "la stessa con un refuso" se la distanza è piccola rispetto alla lunghezza. */
export function similarWords(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  const d = levenshtein(a, b);
  if (len <= 3) return d <= 1;
  return d <= Math.max(2, Math.ceil(len * 0.34));
}

/**
 * Allineamento per LCS sulle parole; i tratti non allineati si confrontano a coppie.
 * Una parola spezzata o unita ("in sieme" → "insieme") conta come refuso.
 */
export function compareWords(original: string, corrected: string): ChangeReport {
  const a = tokenize(original);
  const b = tokenize(corrected);
  const n = a.length, m = b.length;
  // tabella LCS a righe (n·m fino a ~1000×1000 per sezione: ok)
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let typoFixes = 0, rewrites = 0, deleted = 0, inserted = 0, longestGap = 0, completions = 0;
  let i = 0, j = 0;
  let gapA: string[] = [], gapB: string[] = [];
  let gapStart = 0;
  const flush = () => {
    const r = scoreGap(gapA, gapB, gapStart, a);
    typoFixes += r.typoFixes;
    rewrites += r.rewrites;
    deleted += r.deleted;
    inserted += r.inserted;
    completions += r.completions;
    longestGap = Math.max(longestGap, r.deleted, r.inserted);
    gapA = [];
    gapB = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++; j++;
    } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) gapB.push(b[j++]);
    else {
      if (!gapA.length) gapStart = i;
      gapA.push(a[i++]);
    }
  }
  flush();
  return { words: n, typoFixes, rewrites, deleted, inserted, completions, longestGap, rewriteRatio: n ? rewrites / n : rewrites ? 1 : 0 };
}

/**
 * Parola completata, non corretta: l'originale è l'inizio della correzione e mancano
 * almeno 3 lettere ("volat" → "volatile", la parola che stavi scrivendo). "programm" →
 * "programma" resta un refuso.
 */
export function isCompletion(original: string, corrected: string): boolean {
  return corrected.length - original.length >= 3 && corrected.startsWith(original);
}

/** Parola che si può togliere senza cambiare il contenuto: ripetuta accanto o lettera sola. */
function removable(all: string[], index: number): boolean {
  const w = all[index];
  return (w.length === 1 && !/\d/.test(w)) || all[index - 1] === w || all[index + 1] === w;
}

function scoreGap(a: string[], b: string[], start: number, all: string[]) {
  const none = { typoFixes: 0, rewrites: 0, deleted: 0, inserted: 0, completions: 0 };
  if (!a.length && !b.length) return none;
  // parole unite o spezzate: stesso testo senza spazi
  if (a.length !== b.length && a.join("") === b.join("")) return { ...none, typoFixes: Math.max(a.length, b.length) };
  let typoFixes = 0, swapped = 0, completions = 0;
  const pairs = Math.min(a.length, b.length);
  for (let k = 0; k < pairs; k++) {
    if (isCompletion(a[k], b[k])) completions++, swapped++;
    else if (similarWords(a[k], b[k])) typoFixes++;
    else swapped++;
  }
  let deleted = 0;
  for (let k = pairs; k < a.length; k++) if (!removable(all, start + k)) deleted++;
  const inserted = Math.max(0, b.length - a.length);
  return { typoFixes, rewrites: swapped + Math.max(0, a.length - b.length) + inserted, deleted, inserted, completions };
}

/**
 * Due o più parole consecutive tolte o aggiunte non sono un refuso: è una frase completata,
 * accorciata o inventata (anche una parola che stavi ancora scrivendo).
 */
const MAX_CONSECUTIVE = 1;

export function isAcceptable(r: ChangeReport): boolean {
  if (r.longestGap > MAX_CONSECUTIVE || r.completions > 0) return false;
  if (r.deleted > 0 || r.inserted > 1 + Math.floor(r.words * MAX_INSERTED_RATIO)) return false;
  return r.rewrites <= MIN_ALLOWED_REWRITES || r.rewriteRatio <= MAX_REWRITE_RATIO;
}

/** Motivo leggibile di uno scarto. */
export function rejectionReason(r: ChangeReport): string {
  if (r.completions > 0) return `parole completate (${r.completions}): forse le stavi ancora scrivendo`;
  if (r.longestGap > MAX_CONSECUTIVE) return `${r.longestGap} parole consecutive tolte o aggiunte`;
  if (r.deleted > 0) return `parole tolte (${r.deleted})`;
  if (r.inserted > 1 + Math.floor(r.words * MAX_INSERTED_RATIO)) return `parole aggiunte (${r.inserted})`;
  return `troppe parole cambiate (${r.rewrites} su ${r.words})`;
}

/**
 * Toglie i titoli Markdown inventati: una riga-titolo della correzione il cui testo non
 * corrisponde a nessuna riga dell'originale (es. "# Computer" sopra "Computer: …").
 * Trasformare una riga esistente in titolo resta permesso.
 */
export function dropInventedHeadings(original: string, corrected: string): string {
  const lines = new Set(original.split("\n").map((l) => tokenize(l).join(" ")).filter(Boolean));
  const known = (key: string) => {
    if (lines.has(key)) return true;
    for (const l of lines) {
      const r = compareWords(l, key);
      if (r.rewrites === 0) return true;
    }
    return false;
  };
  return corrected
    .split("\n")
    .filter((line, i, all) => {
      if (!/^#{1,6}\s/.test(line)) return true;
      if (known(tokenize(line).join(" "))) return true;
      // la riga vuota messa dopo il titolo inventato va via con lui
      if (all[i + 1] === "") all[i + 1] = "\0";
      return false;
    })
    .filter((line) => line !== "\0")
    .join("\n");
}
