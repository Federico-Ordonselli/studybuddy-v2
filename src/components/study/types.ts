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

export interface Grade { quality: number; correct: boolean; feedback: string }

export interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  tag?: string;
  grade?: Grade;
  question?: QuizQuestion;
}

export interface ReviewCard { id: number; question: string }
export interface ReviewResult { grade: Grade; expected: string; intervalDays: number; dueAt: number; remaining: number }

export interface SlideT { title: string; bullets: string[]; imagePrompt: string; image?: { format: string; content: string } }

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const sessionKey = (d: number) => `sb_session_${d}`;
