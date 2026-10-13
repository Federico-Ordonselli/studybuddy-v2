import { hasCode, isSolutionRequest } from "./guard";

/**
 * Scala di indizi per gli esercizi (Fase 4). Lo stato vive in `sessions.state.hint`.
 * Il livello sale solo con un tentativo (euristica in codice, nessuna chiamata LLM);
 * il primo messaggio di un problema è l'enunciato, non un tentativo.
 */
export interface HintState {
  level: number;          // 1–4
  attempts: number;       // tentativi sul problema corrente
  turns: number;          // messaggi dello studente sul problema corrente
  leaksBlocked: number;   // perdite bloccate in tutta la sessione (per l'eval)
  solutionsShown: number; // «Mostra soluzione» usati nella sessione
}

/** Quello che serve alla UI. */
export interface PublicHint { level: number; attempts: number; canReveal: boolean }

export const LEVELS: Record<number, string> = {
  1: "chiedi cosa ha già provato o capito",
  2: "indica il concetto in gioco, con una citazione [n]",
  3: "indica il passo successivo, non quelli dopo",
  4: "mostra un esempio svolto su un caso analogo ma diverso",
};
export const MAX_LEVEL = 4;
export const REVEAL_AFTER = 2;

export const initialHint = (): HintState => ({ level: 1, attempts: 0, turns: 0, leaksBlocked: 0, solutionsShown: 0 });

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Tentativo: codice, oppure una proposta di almeno 8 parole che non è una domanda né una richiesta di soluzione. */
export function isAttempt(message: string): boolean {
  if (message.trim().endsWith("?") && !message.includes("`")) return false;
  if (isSolutionRequest(message)) return hasCode(message);
  if (hasCode(message)) return true;
  return words(message) >= 8 && !message.trim().endsWith("?");
}

export function nextHint(h: HintState, message: string): HintState {
  const attempt = h.turns > 0 && isAttempt(message);
  return {
    ...h,
    turns: h.turns + 1,
    attempts: h.attempts + (attempt ? 1 : 0),
    level: attempt ? Math.min(MAX_LEVEL, h.level + 1) : h.level,
  };
}

export const resetProblem = (h: HintState): HintState => ({ ...h, level: 1, attempts: 0, turns: 0 });
export const afterSolution = (h: HintState): HintState => ({ ...resetProblem(h), solutionsShown: h.solutionsShown + 1 });
export const canReveal = (h: HintState) => h.attempts >= REVEAL_AFTER;
export const publicHint = (h: HintState): PublicHint => ({ level: h.level, attempts: h.attempts, canReveal: canReveal(h) });
