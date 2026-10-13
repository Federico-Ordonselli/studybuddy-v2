import { rag } from "@/lib/config";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/providers";
import type { Citation } from "@/lib/rag/pipeline";
import { LibraryError } from "@/lib/errors";
import { afterSolution, canReveal, initialHint, nextHint, REVEAL_AFTER, type HintState } from "./hints";

/**
 * Persistenza dello stato del tutor in `sessions.state`.
 * Per la modalità socratica lo stato è la cronologia dei turni, così una sessione
 * può essere ripresa dopo un reload. La coda SM-2 (modalità review) è invece
 * implicita nella tabella `cards` (vedi `tutor/cards.ts`).
 */

export type SocraticAction = "reply" | "solution";
/** Messaggio dello studente salvato quando chiede la soluzione col pulsante. */
export const SOLUTION_MESSAGE = "Mostra la soluzione";

/** Turno salvato: le risposte dell'assistente tengono le citazioni (e l'etichetta, es. «Soluzione») per la ripresa. */
export interface TutorMessage extends ChatMessage {
  citations?: Citation[];
  tag?: string;
}

export interface SocraticState {
  history: TutorMessage[];
  hint?: HintState; // assente nelle sessioni salvate prima della Fase 4
}

export function appendTurn(history: TutorMessage[], message: string, reply: string, citations: Citation[] = [], tag?: string): TutorMessage[] {
  return [...history, { role: "user", content: message }, { role: "assistant", content: reply, citations, ...(tag ? { tag } : {}) }];
}

/** Livello di indizio da usare per questo turno. La soluzione si sblocca solo dopo `REVEAL_AFTER` tentativi. */
export function beginTurn(state: SocraticState | null, message: string, action: SocraticAction): HintState {
  const before = state?.hint ?? initialHint();
  if (action === "reply") return nextHint(before, message);
  if (!canReveal(before)) throw new LibraryError(`La soluzione si sblocca dopo ${REVEAL_AFTER} tentativi.`, 409);
  return before;
}

/** Stato dopo un turno riuscito: dopo la soluzione si riparte dal livello 1. */
export function endTurn(state: SocraticState | null, hint: HintState, action: SocraticAction, message: string, reply: string, citations: Citation[], blocked: number): SocraticState {
  return {
    history: appendTurn(state?.history ?? [], message, reply, citations, action === "solution" ? "Soluzione" : undefined),
    hint: action === "solution" ? afterSolution(hint) : { ...hint, leaksBlocked: hint.leaksBlocked + blocked },
  };
}

/** Al modello vanno solo i turni: le citazioni sono per la UI. */
export function forModel(history: TutorMessage[], turns = rag.historyTurns, budget = rag.historyChars): ChatMessage[] {
  const selected: ChatMessage[] = [];
  let used = 0;
  for (const { role, content } of history.slice(-Math.max(0, turns) * 2).reverse()) {
    if (turns <= 0 || budget <= used) break;
    const text = content.slice(0, budget - used);
    selected.push({ role, content: text });
    used += text.length;
  }
  const ordered = selected.reverse();
  // Non iniziare con una risposta orfana se il budget ha escluso la domanda.
  while (ordered[0]?.role === "assistant") ordered.shift();
  return ordered;
}

export interface SessionRow {
  id: number;
  domainId: number | null;
  mode: string;
  state: SocraticState | null;
}

/** Carica una sessione esistente per id, o ne crea una nuova. */
export async function getOrCreateSession(
  mode: string,
  domainId?: number,
  sessionId?: number
): Promise<SessionRow> {
  if (sessionId) {
    const found = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (found) return found as SessionRow;
  }
  const [created] = await db
    .insert(sessions)
    .values({ domainId, mode, state: { history: [] } satisfies SocraticState })
    .returning();
  return created as SessionRow;
}

/** Restituisce lo stato serializzato di una sessione (per ripresa lato UI). */
export function loadSession(sessionId: number): SessionRow | null {
  const row = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  return (row as SessionRow) ?? null;
}

export function saveState(sessionId: number, state: SocraticState) {
  db.update(sessions).set({ state, updatedAt: new Date() }).where(eq(sessions.id, sessionId)).run();
}
