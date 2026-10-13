import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, sqlite } from "@/lib/db";
import { LibraryError } from "@/lib/errors";
import { cards, domains, reviewLogs } from "@/lib/db/schema";
import { retrieve } from "@/lib/rag/pipeline";
import { resolveScope } from "@/lib/rag/store";
import { generateCardDrafts, markDuplicates, type CardDraft } from "./cardGen";
import { isDuplicateQuestion } from "./cardQuality";
import { gradingSource } from "./gradingSource";
import type { Citation } from "@/lib/rag/pipeline";
import { gradeAnswer, PROMPT_VERSION, rationaleJson, type Grade } from "./grade";
import { models } from "@/lib/config";
import { fromSnapshot, isGrade, toRating, scheduleFrom, schedule, toSnapshot, type Confidence, type FsrsFields, type Grade as Rating } from "./scheduler";

/**
 * Carte di studio per lo spaced repetition. Le carte si generano dal materiale con il generatore
 * dedicato (`cardGen.ts`, un fatto per carta) e si persistono in `cards`; il ripasso le rischedula
 * con FSRS (`scheduler.ts`).
 */

export interface ReviewCard {
  id: number;
  question: string;
}

export interface ReviewResult {
  grade: Grade;
  expected: string;
  rating: Rating;    // 1 Again · 2 Hard · 3 Good · 4 Easy
  confidence?: Confidence; // fiducia dichiarata prima di rispondere
  dueAt: number;     // epoch ms della prossima scadenza
  remaining: number; // carte ancora in scadenza per il dominio
  source?: Citation; // passaggio usato dal giudice
}

/**
 * Bozze di carte su un argomento (anteprima, Fase 3): nessun salvataggio. Le carte con problemi
 * restano nella lista con il motivo, comprese quelle già presenti nel corso.
 */
export async function previewCards(domainId: number, topic: string, n = 5): Promise<CardDraft[]> {
  requireDomain(domainId);
  const chunks = await retrieve(topic, domainId);
  const drafts = await generateCardDrafts(chunks, { n, topic });
  return markDuplicates(drafts, existingQuestions(domainId));
}

/** Genera e salva subito solo le carte valide (mappa concettuale): niente anteprima. */
export async function generateCards(domainId: number, topic: string, n = 5): Promise<{ created: number; flagged: number }> {
  const drafts = await previewCards(domainId, topic, n);
  const valid = drafts.filter((d) => !d.issues.length).slice(0, n);
  const { created } = saveCards(domainId, valid);
  return { created, flagged: drafts.length - created };
}

export interface NewCard {
  question: string;
  answer: string;
  sourceChunkId?: number | null;
}

/**
 * Salva le carte scelte (dall'anteprima, eventualmente modificate, o dalla generazione automatica).
 * Salta i duplicati; una `sourceChunkId` fuori dal corso o inesistente diventa null.
 */
export function saveCards(domainId: number, items: NewCard[]): { created: number; skipped: number } {
  requireDomain(domainId);
  const scope = resolveScope(domainId) ?? [domainId];
  const inScope = sqlite.prepare(`SELECT 1 FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ? AND d.domain_id IN (${scope.map(() => "?").join(",")})`);
  const values = items.map((c) => ({
    question: cardText(c.question, "Domanda"),
    answer: cardText(c.answer, "Risposta"),
    sourceChunkId: Number.isSafeInteger(c.sourceChunkId) && inScope.get(c.sourceChunkId, ...scope) ? c.sourceChunkId! : null,
  }));
  let created = 0;
  sqlite.transaction(() => {
    const existing = existingQuestions(domainId);
    for (const v of values) {
      if (isDuplicateQuestion(v.question, existing)) continue;
      db.insert(cards).values({ domainId, ...v }).run();
      existing.push(v.question);
      created++;
    }
  })();
  return { created, skipped: values.length - created };
}

/** Domande delle carte del corso (figli inclusi se è un macro), per il controllo dei duplicati. */
function existingQuestions(domainId: number): string[] {
  return db.select({ question: cards.question }).from(cards).where(inArray(cards.domainId, resolveScope(domainId) ?? [domainId])).all().map((c) => c.question);
}

function requireDomain(domainId: number) {
  if (!db.select({ id: domains.id }).from(domains).where(eq(domains.id, domainId)).get()) throw new LibraryError("Corso non trovato", 404);
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
 * Valuta la risposta a una carta, riprogramma con FSRS e registra la review in `review_logs`. `scopeDomainId` è il dominio
 * selezionato in UI (può essere il macro): serve per contare le carte rimaste in coda. `confidence` (Fase 6) decide
 * Good/Easy sulle risposte corrette e resta nel log per la calibrazione in home.
 */
export async function reviewCard(cardId: number, answer: string, scopeDomainId?: number, confidence?: Confidence): Promise<ReviewResult | null> {
  const card = db.select().from(cards).where(eq(cards.id, cardId)).get();
  if (!card || card.suspended) return null;

  const source = await gradingSource(card.question, card.sourceChunkId, card.domainId);
  const grade = await gradeAnswer(card.question, card.answer, answer, source?.text);
  const rating = toRating(grade.verdict, confidence);
  // al secondo, come `reviewed_at`: la correzione del voto rischedula con la stessa ora (il fuzz ne dipende)
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const { before, update } = schedule(card, rating, now);
  // Carta e log insieme: niente review registrata senza riprogrammazione, né il contrario.
  sqlite.transaction(() => {
    db.update(cards).set(update).where(eq(cards.id, cardId)).run();
    db.insert(reviewLogs).values({
      cardId,
      reviewedAt: now,
      rating,
      confidence,
      answer,
      graderRationale: rationaleJson(grade),
      ...logState(before, update),
      graderModel: models.grade.model,
      promptVersion: PROMPT_VERSION,
    }).run();
  })();

  return { grade, expected: card.answer, rating, confidence, dueAt: update.dueAt.getTime(), remaining: remainingFor(scopeDomainId ?? card.domainId), source: source?.citation };
}

/**
 * Correzione manuale del voto dell'ultima review della carta: riparte dallo stato salvato in
 * `state_before` e rischedula con `rating` alla stessa ora, come se il giudice avesse dato quel voto.
 * Il log originale resta (con `overridden = 1`) e se ne aggiunge uno manuale: così il set di
 * valutazione del giudice ha i casi in cui ha sbagliato. Si può correggere di nuovo la correzione.
 */
export function overrideLastReview(cardId: number, rating: Rating, scopeDomainId?: number) {
  if (!isGrade(rating)) throw new LibraryError("rating: serve 1 (Again), 2 (Hard), 3 (Good) o 4 (Easy)");
  const card = requireCard(cardId);
  const last = db.select().from(reviewLogs).where(eq(reviewLogs.cardId, cardId)).orderBy(desc(reviewLogs.id)).limit(1).get();
  if (!last) throw new LibraryError("Nessuna review da correggere", 404);
  const before = fromSnapshot(last.stateBefore);
  if (!before) throw new LibraryError("Review precedente a FSRS: non si può correggere", 409);

  const update = scheduleFrom(before, rating, last.reviewedAt);
  sqlite.transaction(() => {
    db.update(cards).set(update).where(eq(cards.id, cardId)).run();
    db.update(reviewLogs).set({ overridden: 1 }).where(eq(reviewLogs.id, last.id)).run();
    db.insert(reviewLogs).values({
      cardId,
      reviewedAt: last.reviewedAt,
      rating,
      confidence: last.confidence,
      answer: last.answer,
      ...logState(before, update),
      graderModel: "manual",
    }).run();
  })();
  return { rating, dueAt: update.dueAt.getTime(), remaining: remainingFor(scopeDomainId ?? card.domainId) };
}

function logState(before: FsrsFields, after: FsrsFields) {
  return { stateBefore: toSnapshot(before), stability: after.stability, difficulty: after.difficulty, scheduledDays: after.scheduledDays };
}

const remainingFor = (domainId: number | null) => (domainId ? dueCount(domainId) : 0);

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
export { isDuplicateQuestion } from "./cardQuality";
export { sourceForAnswer } from "./cardGen";

/** Il quiz entra nel ripasso solo su richiesta esplicita dello studente. */
export function createCardFromQuiz(domainId: number, quiz: {question:string;answer:string}) {
  requireDomain(domainId);
  const question=cardText(quiz.question,'Domanda'), answer=cardText(quiz.answer,'Risposta');
  const existing=db.select().from(cards).where(eq(cards.domainId,domainId)).all();
  const duplicate=existing.find(c=>isDuplicateQuestion(question,[c.question]));
  if(duplicate) return {created:false,card:duplicate};
  const card=db.insert(cards).values({domainId,question,answer}).returning().get();
  return {created:true,card};
}
