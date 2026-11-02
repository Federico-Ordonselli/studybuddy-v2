/** Formato delle lezioni Full Studio (lesson.json, invariato rispetto alla pipeline) e di study.json. Puro: gira anche nel browser. */

export type Visual =
  | { kind: "table"; title: string; headers: string[]; rows: string[][] }
  | { kind: "list"; title: string; ordered: boolean; items: string[] };

export interface Segment {
  id: string;
  text: string;
  tts?: string;
  code?: { ref: string; highlight: [number, number] | null } | null;
  visual?: Visual | null;
  audio?: string;
  duration?: number;
}
export interface Section { id: string; title: string; group?: string | null; segments: Segment[] }
export interface QuizQuestion { q: string; options: string[]; answer: number; why: string }
export interface Chapter { id: string; title: string; sections: Section[]; quiz?: QuizQuestion[] }
export interface CodeBlock { lang: string; code: string; file?: string }
export interface Lesson {
  part: number;
  title: string;
  subtitle: string;
  voice?: string;
  rate?: string;
  chapters: Chapter[];
  codeBlocks: Record<string, CodeBlock>;
}

export interface StudyCard { q: string; a: string }
export interface StudySection { cards?: StudyCard[]; quiz?: QuizQuestion[] }
export interface Study { version: 1; sections: Record<string, StudySection> }

export interface StudioState {
  segmentId: string | null;
  offset: number;
  rate: number;
  completedSections: string[];
}

/** Riga dell'elenco lezioni (`/full-studio`). */
export interface StudioLessonSummary {
  id: number;
  title: string;
  subtitle: string;
  courseId: number;
  courseName: string;
  parentName: string | null;
  sections: number;
  completed: number;
  duration: number;
  cardsTotal: number;
  cardsUnlocked: number;
  quiz: number;
  updatedAt: number | null;
}

/** Domanda di quiz servita al client: opzioni già rimescolate, `answer` = indice nelle opzioni servite. */
export interface ServedQuestion extends QuizQuestion { sectionId: string; sectionTitle: string }
