/** Tipi condivisi dalle viste dell'area studio (spostati da app/page.tsx). */
export interface Citation {
  n: number;
  documentId: number;
  kind: string;
  label: string;
  snippet: string;
  startSec?: number;
  endSec?: number;
  video?: { path: string; startSec: number };
}

export interface QuizQuestion {
  type: "open" | "mcq";
  question: string;
  options?: string[];
  answer: string;
  rationale: string;
}

export type Verdict = "wrong" | "partial" | "correct";
export interface Grade { verdict: Verdict; required: string[]; present: string[]; missing: string[]; errors: string[]; feedback: string }
/** Il verdetto ha sempre testo e icona, non solo colore. */
export const VERDICT_LABEL: Record<Verdict, string> = { correct: "✓ Corretta", partial: "◐ Parziale", wrong: "✗ Sbagliata" };
export interface PlayingVideo { path: string; startSec: number; label: string }

export interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  tag?: string;
  grade?: Grade;
  source?: Citation;
  reviewQuiz?: QuizQuestion;
  addedToReview?: boolean;
  question?: QuizQuestion;
}

export interface ReviewCard { id: number; question: string }
/** Rating FSRS (1–4) con le etichette della UI. */
export type Rating = 1 | 2 | 3 | 4;
export const RATING_LABEL: Record<Rating, string> = { 1: "Di nuovo", 2: "Difficile", 3: "Bene", 4: "Facile" };
export interface ReviewResult { grade: Grade; expected: string; rating: Rating; dueAt: number; remaining: number; source?: Citation }
export interface OverrideResult { rating: Rating; dueAt: number; remaining: number }

export interface SlideT { title: string; bullets: string[]; imagePrompt: string; image?: { format: string; content: string } }

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const sessionKey = (d: number) => `sb_session_${d}`;
