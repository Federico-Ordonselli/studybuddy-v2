import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";
import { retrieve, asContext } from "@/lib/rag/pipeline";
import { resolveScope } from "@/lib/rag/store";
import { generateQuiz } from "./quiz";
import { gradeAnswer, type Grade } from "./grade";
import { sm2, nextDue } from "./sm2";

/**
 * Carte di studio per lo spaced repetition. Le domande si generano dal materiale
 * (riuso di `generateQuiz`) e si persistono in `cards`; il ripasso applica SM-2.
 */

export interface ReviewCard {
  id: number;
  question: string;
}

export interface ReviewResult {
  grade: Grade;
  expected: string;
  intervalDays: number;
  dueAt: number;     // epoch ms della prossima scadenza
  remaining: number; // carte ancora in scadenza per il dominio
}

/** Genera e persiste fino a `n` carte (Q/A) dal materiale di un dominio. */
export async function generateCards(domainId: number, topic: string, n = 5): Promise<{ created: number }> {
  const chunks = await retrieve(topic, domainId);
  if (!chunks.length) return { created: 0 };

  const qs = await generateQuiz(asContext(chunks), n, { topic, kind: "open" });
  const sourceChunkId = chunks[0]?.chunkId ?? null; // attribuzione best-effort
  let created = 0;
  for (const q of qs) {
    if (!q.question?.trim() || !q.answer?.trim()) continue;
    await db.insert(cards).values({
      domainId,
      question: q.question,
      answer: q.answer,
      sourceChunkId,
    });
    created++;
  }
  return { created };
}

/** Carte in scadenza (dueAt <= ora) nello scope del dominio: un macro include le carte dei figli. */
function dueIn(domainId: number) {
  return and(inArray(cards.domainId, resolveScope(domainId) ?? [domainId]), lte(cards.dueAt, new Date()));
}

/** Numero di carte attualmente in scadenza per il dominio (figli inclusi). */
export function dueCount(domainId: number): number {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(cards)
    .where(dueIn(domainId))
    .get();
  return row?.c ?? 0;
}

/** Prossima carta da ripassare (la più scaduta), o null se la coda è vuota. */
export function nextDueCard(domainId: number): ReviewCard | null {
  const row = db
    .select({ id: cards.id, question: cards.question })
    .from(cards)
    .where(dueIn(domainId))
    .orderBy(asc(cards.dueAt))
    .limit(1)
    .get();
  return row ?? null;
}

/**
 * Valuta la risposta a una carta e riprogramma con SM-2. `scopeDomainId` è il dominio
 * selezionato in UI (può essere il macro): serve per contare le carte rimaste in coda.
 */
export async function reviewCard(cardId: number, answer: string, scopeDomainId?: number): Promise<ReviewResult | null> {
  const card = db.select().from(cards).where(eq(cards.id, cardId)).get();
  if (!card) return null;

  const grade = await gradeAnswer(card.question, card.answer, answer);
  const next = sm2(
    { ease: card.ease, intervalDays: card.intervalDays, repetitions: card.repetitions },
    grade.quality
  );
  const due = nextDue(next.intervalDays);
  db.update(cards)
    .set({ ease: next.ease, intervalDays: next.intervalDays, repetitions: next.repetitions, dueAt: due })
    .where(eq(cards.id, cardId))
    .run();

  const scope = scopeDomainId ?? card.domainId;
  return {
    grade,
    expected: card.answer,
    intervalDays: next.intervalDays,
    dueAt: due.getTime(),
    remaining: scope ? dueCount(scope) : 0,
  };
}
