/**
 * Fase 4: il tutor non regala la soluzione. Qui il riconoscimento dei turni a rischio
 * (lo studente chiede la soluzione) e delle perdite (la risposta la dà comunque).
 * Solo i turni a rischio pagano il controllo: gli altri restano in streaming.
 */
import { generate } from "@/lib/providers";

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

export const RETRY_NOTE =
  "ATTENZIONE: la risposta precedente dava la soluzione. Dai solo il prossimo indizio: niente risposta finale, niente codice che risolve l'esercizio.";

export const FALLBACK_HINT =
  "Prima di un indizio: cosa hai già provato? Scrivi il tuo tentativo, anche parziale o sbagliato, e ti indico il passo successivo.";

export interface GuardResult { reply: string; blocked: number; fallback: boolean }
export interface GuardDeps {
  /** Genera la risposta; alla rigenerazione riceve `RETRY_NOTE`. */
  generate: (retryNote?: string) => Promise<string>;
  /** true = la risposta dà la soluzione. */
  judge: (reply: string) => Promise<boolean>;
}

/** Perdita → una sola rigenerazione con la nota; se perde ancora, indizio fisso di livello 1. */
export async function guardedReply(deps: GuardDeps): Promise<GuardResult> {
  let blocked = 0;
  for (const note of [undefined, RETRY_NOTE]) {
    const reply = await deps.generate(note);
    if (!codeLeak(reply) && !(await deps.judge(reply))) return { reply, blocked, fallback: false };
    blocked++;
  }
  return { reply: FALLBACK_HINT, blocked, fallback: true };
}

const LEAK_SCHEMA = {
  type: "object",
  properties: { reason: { type: "string" }, gives_solution: { type: "boolean" } },
  required: ["reason", "gives_solution"],
};

const LEAK_SYSTEM = [
  "Controlli un tutor che non deve dare la soluzione degli esercizi allo studente.",
  "Dati il problema, il materiale e la risposta del tutor, decidi se la risposta DÀ LA SOLUZIONE:",
  "la risposta finale, il codice che risolve l'esercizio, oppure tutti i passi in modo che basti copiarli.",
  "NON sono la soluzione: domande, indizi, il concetto in gioco, il solo passo successivo,",
  "un esempio svolto su un caso diverso (altri nomi, altri dati), la spiegazione di una definizione richiesta.",
  'Rispondi in JSON: {"reason": "una frase", "gives_solution": true|false}.',
].join("\n");

export function parseLeak(raw: string): boolean | null {
  try {
    const j = JSON.parse(raw);
    return typeof j?.gives_solution === "boolean" && typeof j.reason === "string" ? j.gives_solution : null;
  } catch { return null; }
}

/** Giudice delle perdite. Se non produce un giudizio valido (dopo un retry) non blocca: meglio un indizio in più che un turno fallito. */
export async function checkLeak(problem: string, context: string, reply: string, signal?: AbortSignal): Promise<boolean> {
  const content = [`Problema dello studente:\n"""\n${problem}\n"""`, `Materiale:\n"""\n${context}\n"""`, `Risposta del tutor:\n"""\n${reply}\n"""`, "Giudica (JSON)."].join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const leak = parseLeak(await generate("grade", {
      signal, system: LEAK_SYSTEM, json: true, schema: LEAK_SCHEMA, temperature: 0,
      messages: [{ role: "user", content }],
    }));
    if (leak !== null) return leak;
  }
  console.warn("[tutor guard] giudizio non valido: risposta lasciata passare");
  return false;
}
