/**
 * Fase 4: il tutor non regala la soluzione. Qui il riconoscimento dei turni a rischio
 * (lo studente chiede la soluzione) e delle perdite (la risposta la dà comunque).
 * Solo i turni a rischio pagano il controllo: gli altri restano in streaming.
 */

/** Richieste esplicite della soluzione. Verbo + oggetto, non la parola da sola: «la mia soluzione è…» è un tentativo. */
const SOLUTION_REQUEST = [
  /\b(dammi|dimmi|mostrami|scrivimi|passami)\b[^.?!]{0,20}\b(soluzion[ei]|rispost[ae]|codice)\b/i,
  /\bqual\s*(è|e'|e)\s+la\s+(soluzione|risposta)\b/i,
  /\bscrivi(mi)?\s+(tu\s+)?il\s+codice\b/i,
  /\b(fammelo|risolvilo|fallo)\s+tu\b/i,
  /\bdimmelo\s+e\s+basta\b/i,
  /^\s*(la\s+)?soluzione\s*\??\s*$/i,
  /\b(give|tell|show|send)\s+me\s+(the\s+)?(answer|solution|code)\b/i,
  /\bwhat('s|\s+is)\s+the\s+(answer|solution)\b/i,
  /\bwrite\s+(me\s+)?the\s+code\b|\bwrite\s+the\s+code\s+for\s+me\b/i,
  /\bjust\s+tell\s+me\b/i,
  /\bsolve\s+it\s+for\s+me\b/i,
];

export function isSolutionRequest(message: string): boolean {
  return SOLUTION_REQUEST.some((re) => re.test(message));
}

/** Codice nel messaggio: blocco recintato, codice inline o una riga con la forma tipica del codice. */
export function hasCode(text: string): boolean {
  if (/```|`[^`\n]+`/.test(text)) return true;
  return /=>|[;{}]\s*$|\b(const|let|var|function|def|return)\s+\w|\w+\.\w+\([^)]*\)/m.test(text);
}

/** Perdita certa senza LLM: un blocco di codice recintato con più di `maxLines` righe non vuote. */
export function codeLeak(reply: string, maxLines = 6): boolean {
  for (const m of reply.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    if (m[1].split("\n").filter((l) => l.trim()).length > maxLines) return true;
  }
  return false;
}
