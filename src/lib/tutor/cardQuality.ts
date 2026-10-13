/**
 * Controllo in codice delle flashcard (Fase 3): segnala le carte non atomiche senza chiamare
 * l'LLM. Puro, quindi gira anche nel browser e ricontrolla la carta mentre la modifichi
 * nell'anteprima. Le carte segnalate non si buttano: si mostrano con il motivo.
 */

import { jaccard, wordShingles } from "@/lib/shingles";

export type IssueCode = "empty" | "long" | "enumeration" | "double" | "yesno" | "leak" | "context" | "cloze" | "duplicate";

export interface CardIssue {
  code: IssueCode;
  message: string;
}

/** Soglia di partenza del piano: da tarare con `npm run eval -- cards`. */
export const MAX_ANSWER_WORDS = 25;

/**
 * Domande che rimandano a qualcosa che lo studente non vede («secondo il testo», «quale dei seguenti»).
 * Condivisa con il quiz, che le scarta. Solo le forme che rimandano davvero: «il testo del post»,
 * «il testo tagliato», «the following siblings» o «il passaggio da C++ a Java» sono parole normali.
 */
export const REFERS_TO_HIDDEN = new RegExp([
  "\\b(?:secondo|in base a|come (?:indicato|descritto) nel|nel|dal) (?:il |al )?(?:testo|contesto|passaggio|brano)(?!\\s+(?:d[aei]|dal|dall[aoe']?|del|dell[aoe']?|degli|dei)\\b)",
  "\\bil (?:testo|contesto|passaggio|brano)\\s*(?:[?.,:;]|$)",
  "\\b(?:dei|delle|tra i|tra le|i|le) seguenti\\b",
  "\\bseguent[ie]\\s*[:?]",
  "(?:of|from) the following\\b",
  "\\bthe following\\s*[:?]",
  "\\b(?:in|from|according to) the (?:text|context|passage)\\b(?!\\s+(?:of|from)\\b)",
].join("|"), "i");

export const CLOZE_BLANK = "____";

const ENUM_QUESTION = /\b(elenca|elencare|enumera|quali sono (?:i|gli|le)|list|name the|what are the (?:\d+|two|three|four|five|six|seven|main|different))\b/i;
const YES_NO = /^(?:è vero che|è possibile|si può|is it|is there|are there|is|are|does|do|did|can|could|will|would|should|has|have|was|were)\s/i;
const TRUE_FALSE = /\b(vero o falso|true or false)\b/i;
/** Risposta che comincia con sì/no: la domanda era chiusa. */
const YES_NO_ANSWER = /^(?:sì|si|no|yes)(?![\p{L}\p{N}-])/iu; // «no-wrap» non è un «no»
/** Interrogativi IT/EN: una domanda con «?» che non ne contiene nessuno è chiusa (in italiano il sì/no non inverte l'ausiliare). */
const WH_WORD = /(?<![\p{L}\p{N}])(?:cosa|cos|che|come|perch[eé]|qual[ei]?|quant[oaie]|quando|dove|chi|what|why|how|which|when|where|who|whom|whose)(?![\p{L}\p{N}])/iu;
const SECOND_QUESTION = /\b(?:and|e|ed)\s+(?:how|why|what|when|where|which|who|come|perch[eé]|cosa|quando|dove|quale|quali|chi)(?![\p{L}\p{N}])/iu; // \b non vede la «é» di «perché»

const withoutCode = (s: string) => s.replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/`[^`\n]*`/g, " CODE ");
const tokens = (s: string) => s.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** 3+ righe puntate, o 3+ voci brevi separate da virgole («HTML, CSS e JavaScript»). */
function isList(answer: string): boolean {
  const lines = answer.split("\n").filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l));
  if (lines.length >= 3) return true;
  const parts = answer.split(/[,;\n]|\s(?:and|or|e|ed|o)\s/i).map((p) => tokens(p).length).filter((n) => n > 0);
  return parts.length >= 3 && parts.reduce((a, b) => a + b, 0) / parts.length <= 2.5;
}

/** Quota degli n-grammi della risposta già presenti nella domanda (n = 3, o meno per risposte corte). */
function leakRatio(question: string, answer: string): number {
  const a = tokens(answer), q = tokens(question);
  const n = Math.min(3, a.length);
  if (!n || q.length < n) return 0;
  const grams = (w: string[]) => new Set(Array.from({ length: w.length - n + 1 }, (_, i) => w.slice(i, i + n).join(" ")));
  const qa = grams(q), ga = grams(a);
  let shared = 0;
  for (const g of ga) if (qa.has(g)) shared++;
  return shared / ga.size;
}

export function checkCard(card: { question: string; answer: string }): CardIssue[] {
  const question = card.question.trim(), answer = card.answer.trim();
  if (!question || !answer) return [{ code: "empty", message: "Domanda o risposta vuota." }];
  const issues: CardIssue[] = [];
  const add = (code: IssueCode, message: string) => issues.push({ code, message });
  const q = withoutCode(question), a = withoutCode(answer);

  const n = tokens(a).length;
  if (n > MAX_ANSWER_WORDS) add("long", `Risposta di ${n} parole: una carta dovrebbe chiedere un fatto solo (al massimo ${MAX_ANSWER_WORDS}).`);
  if (ENUM_QUESTION.test(q) || isList(a)) add("enumeration", "Chiede un elenco: meglio una carta per elemento.");
  if ((q.match(/\?/g)?.length ?? 0) > 1 || SECOND_QUESTION.test(q)) add("double", "Contiene due domande.");
  const closed = q.includes("?") && !q.includes(CLOZE_BLANK) && !WH_WORD.test(q);
  if (YES_NO.test(q) || TRUE_FALSE.test(q) || closed || YES_NO_ANSWER.test(a)) add("yesno", "Domanda sì/no o vero/falso: si indovina.");
  if (leakRatio(q, a) > 0.5) add("leak", "La risposta è già scritta nella domanda.");
  if (REFERS_TO_HIDDEN.test(q)) add("context", "Rimanda a un testo che durante il ripasso non vedi.");
  if (question.split(CLOZE_BLANK).length > 2) add("cloze", "Ha più di uno spazio vuoto.");
  return issues;
}

/** Stessa domanda a meno di maiuscole/punteggiatura, o shingle molto simili. */
export function isDuplicateQuestion(question: string, existing: string[], threshold = 0.6): boolean {
  const normalized = (s: string) => tokens(s).join(" ");
  return existing.some((q) => normalized(q) === normalized(question) || jaccard(wordShingles(q), wordShingles(question)) >= threshold);
}
