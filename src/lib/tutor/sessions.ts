import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/providers";

/**
 * Persistenza dello stato del tutor in `sessions.state`.
 * Per la modalità socratica lo stato è la cronologia dei turni, così una sessione
 * può essere ripresa dopo un reload. La coda SM-2 (modalità review) è invece
 * implicita nella tabella `cards` (vedi `tutor/cards.ts`).
 */

export interface SocraticState {
  history: ChatMessage[];
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
  db.update(sessions).set({ state }).where(eq(sessions.id, sessionId)).run();
}
