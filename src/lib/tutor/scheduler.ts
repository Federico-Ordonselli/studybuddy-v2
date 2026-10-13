import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from "ts-fsrs";
import { srs } from "@/lib/config";
import type { Verdict } from "./grade";

/**
 * Scheduler FSRS: unico punto che importa ts-fsrs. Funzioni pure (niente DB): `cards.ts`
 * scrive il risultato, `db/index.ts` usa `convertSm2` per la conversione delle carte vecchie.
 */
export { Rating, State, type Grade };

const DAY = 86_400_000;
const f = fsrs({
  request_retention: srs.requestRetention,
  maximum_interval: srs.maximumInterval,
  enable_fuzz: srs.enableFuzz,
});

/** Stato FSRS di una carta, con i nomi delle colonne di `cards`. */
export interface FsrsFields {
  fsrsState: State;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  scheduledDays: number;
  lastReview: Date | null;
  dueAt: Date;
}

interface Sm2Fields {
  ease: number;
  intervalDays: number;
  repetitions: number;
  dueAt: Date | null;
}

/** Riga di `cards` per lo scheduler: i campi FSRS sono NULL finché la carta SM-2 non è convertita. */
export type SchedulerRow = Sm2Fields & { [K in Exclude<keyof FsrsFields, "dueAt">]: FsrsFields[K] | null };

/**
 * Carta SM-2 → FSRS (tabella 1.4 del piano). Mai ripassata: carta nuova con la stessa
 * scadenza. Ripassata (anche sbagliata): Review, con la stabilità dall'intervallo e la
 * difficoltà approssimata dall'ease; le review successive la correggono.
 */
export function convertSm2(row: Sm2Fields, now = new Date()): FsrsFields {
  const due = row.dueAt ?? now;
  if (row.repetitions === 0 && row.intervalDays === 0) return fromFsrsCard(createEmptyCard(due));
  return {
    fsrsState: State.Review,
    stability: Math.max(row.intervalDays, 1),
    difficulty: Math.min(10, Math.max(1, 5 + (2.5 - row.ease) * 4)),
    reps: row.repetitions,
    lapses: 0,
    learningSteps: 0,
    scheduledDays: row.intervalDays,
    lastReview: new Date(due.getTime() - row.intervalDays * DAY),
    dueAt: due,
  };
}

/** Stato FSRS della riga, convertendo al volo una carta SM-2 non ancora convertita. */
export function fsrsFields(row: SchedulerRow, now = new Date()): FsrsFields {
  if (row.fsrsState == null) return convertSm2(row, now);
  return {
    fsrsState: row.fsrsState,
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    reps: row.reps ?? 0,
    lapses: row.lapses ?? 0,
    learningSteps: row.learningSteps ?? 0,
    scheduledDays: row.scheduledDays ?? 0,
    lastReview: row.lastReview,
    dueAt: row.dueAt ?? now,
  };
}

export function toFsrsCard(s: FsrsFields): Card {
  return {
    due: s.dueAt,
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0, // deprecato: ts-fsrs lo ricalcola da last_review
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.fsrsState,
    last_review: s.lastReview ?? undefined,
  };
}

export function fromFsrsCard(c: Card): FsrsFields {
  return {
    fsrsState: c.state,
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    learningSteps: c.learning_steps,
    scheduledDays: c.scheduled_days,
    lastReview: c.last_review ?? null,
    dueAt: c.due,
  };
}

/** Review con `rating` al momento `now`: stato prima (per `review_logs.state_before`) e dopo. */
export function schedule(row: SchedulerRow, rating: Grade, now: Date): { before: FsrsFields; update: FsrsFields } {
  const before = fsrsFields(row, now);
  return { before, update: scheduleFrom(before, rating, now) };
}

/**
 * Review a partire da uno stato FSRS. La correzione del voto riparte da `state_before` invece di
 * `f.rollback()`: in ts-fsrs 5.4.2 il rollback perde il `last_review` precedente (lo sostituisce
 * con la vecchia scadenza), quindi la rischedulazione non coinciderebbe con la review giusta.
 */
export function scheduleFrom(before: FsrsFields, rating: Grade, now: Date): FsrsFields {
  return fromFsrsCard(f.next(toFsrsCard(before), now, rating).card);
}

/** Fiducia dichiarata prima della risposta: 1 «Non sicuro» · 2 «Abbastanza» · 3 «Sicuro». */
export type Confidence = 1 | 2 | 3;

/**
 * Verdetto del giudice (+ fiducia) → rating (tabella 6.2 del piano). Easy non viene mai dal giudice:
 * solo una risposta corretta data con «Sicuro». La fiducia non tocca partial e wrong.
 */
export function toRating(verdict: Verdict, confidence?: Confidence): Grade {
  if (verdict === "correct") return confidence === 3 ? Rating.Easy : Rating.Good;
  return verdict === "partial" ? Rating.Hard : Rating.Again;
}

export const isGrade = (r: unknown): r is Grade => r === 1 || r === 2 || r === 3 || r === 4;

/** Stato come JSON per `review_logs.state_before` (date in epoch ms). */
export function toSnapshot(s: FsrsFields) {
  return { ...s, lastReview: s.lastReview?.getTime() ?? null, dueAt: s.dueAt.getTime() };
}

/** Inverso di `toSnapshot`; null per gli snapshot SM-2 scritti prima di FSRS. */
export function fromSnapshot(json: unknown): FsrsFields | null {
  const s = json as Record<string, unknown> | null;
  if (!s || typeof s.fsrsState !== "number" || typeof s.dueAt !== "number") return null;
  return {
    fsrsState: s.fsrsState,
    stability: Number(s.stability),
    difficulty: Number(s.difficulty),
    reps: Number(s.reps),
    lapses: Number(s.lapses),
    learningSteps: Number(s.learningSteps),
    scheduledDays: Number(s.scheduledDays),
    lastReview: typeof s.lastReview === "number" ? new Date(s.lastReview) : null,
    dueAt: new Date(s.dueAt),
  };
}
