import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { LibraryError } from "@/lib/errors";
import { jaccard, wordShingles } from "@/lib/rag/pipeline";
import { cards, domains } from "@/lib/db/schema";
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
  const existing = db.select({question:cards.question}).from(cards).where(eq(cards.domainId,domainId)).all().map(c=>c.question);
  let created = 0;
  for (const q of qs) {
    if (!q.question?.trim() || !q.answer?.trim()) continue;
    if (isDuplicateQuestion(q.question, existing)) continue;
    const sourceChunkId = sourceForAnswer(q.answer, chunks);
    await db.insert(cards).values({
      domainId,
      question: q.question,
      answer: q.answer,
      sourceChunkId,
    });
    existing.push(q.question);
    created++;
  }
  return { created };
}

/** Carte in scadenza (dueAt <= ora) nello scope del dominio: un macro include le carte dei figli. */
function dueIn(domainId: number) {
  return and(eq(cards.suspended,false), inArray(cards.domainId, resolveScope(domainId) ?? [domainId]), lte(cards.dueAt, new Date()));
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
  if (!card || card.suspended) return null;

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

export function listCards(domainId: number, filter: "due" | "all" = "all") {
  return db.select().from(cards).where(filter === "due" ? dueIn(domainId) : inArray(cards.domainId,resolveScope(domainId) ?? [domainId])).orderBy(asc(cards.dueAt),asc(cards.id)).all();
}

function requireCard(id: number) {
  const card = db.select().from(cards).where(eq(cards.id,id)).get();
  if (!card) throw new LibraryError("Carta non trovata",404);
  return card;
}
function cardText(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 10000) throw new LibraryError(`${name}: serve testo non vuoto di massimo 10000 caratteri`);
  return value.trim();
}
export function updateCard(id: number, values: {question: string; answer: string}) {
  requireCard(id);
  const question = cardText(values.question,"Domanda"), answer = cardText(values.answer,"Risposta");
  return db.update(cards).set({question,answer}).where(eq(cards.id,id)).returning().get();
}
export function deleteCard(id: number) { requireCard(id); db.delete(cards).where(eq(cards.id,id)).run(); }
export function suspendCard(id: number, suspended: boolean) {
  requireCard(id);
  if (typeof suspended !== "boolean") throw new LibraryError("suspended deve essere booleano");
  return db.update(cards).set({suspended}).where(eq(cards.id,id)).returning().get();
}
export function isDuplicateQuestion(question: string, existing: string[], threshold = 0.6): boolean {
  const normalized = (s:string) => (s.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
  return existing.some(q => normalized(q) === normalized(question) || jaccard(wordShingles(q),wordShingles(question)) >= threshold);
}
/** Attribuzione lessicale della risposta al passaggio più pertinente. */
export function sourceForAnswer(answer: string, chunks: {chunkId:number;content:string}[]): number | null {
  const words = (s:string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return chunks.map((c,i)=>({id:c.chunkId,score:jaccard(words(answer),words(c.content)),i})).sort((a,b)=>b.score-a.score || a.i-b.i)[0]?.id ?? null;
}
