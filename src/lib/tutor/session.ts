import { retrieve, asContext, toCitations, type Citation } from "@/lib/rag/pipeline";
import { generate, type ChatMessage } from "@/lib/providers";
import { generateQuiz, type QuizQuestion } from "./quiz";
import { gradeAnswer, type Grade } from "./grade";

export type TutorMode = "socratic" | "quiz" | "review";

/**
 * Macchina a stati minimale del tutor.
 * TODO(claude-code): persistere lo stato in `sessions.state`, gestire la coda
 * delle carte SM-2 in modalita' "review", difficolta' adattiva.
 */
export interface TutorTurn {
  reply: string;
  citations?: Citation[];
  question?: QuizQuestion;
  grade?: Grade;
}

/** Modalita' socratica: risponde con domande/indizi invece di dare la soluzione. */
export async function socraticTurn(
  history: ChatMessage[],
  userMessage: string,
  domainId?: number
): Promise<TutorTurn> {
  const chunks = await retrieve(userMessage, domainId);
  const reply = await generate("chat", {
    system:
      "Sei un tutor socratico. Usa SOLO il contesto fornito. Invece di dare la risposta " +
      "completa, guida con domande e indizi progressivi. Cita i passaggi con [n].\n\n" +
      `Contesto:\n${asContext(chunks)}`,
    temperature: 0.6,
    messages: [...history, { role: "user", content: userMessage }],
  });
  return { reply, citations: toCitations(chunks) };
}

/** Modalita' quiz: genera una domanda dal materiale di un argomento. */
export async function quizTurn(topic: string, domainId?: number): Promise<TutorTurn> {
  const chunks = await retrieve(topic, domainId);
  const [q] = await generateQuiz(asContext(chunks), 1);
  return {
    reply: q?.question ?? "Nessuna domanda generata.",
    question: q,
    citations: toCitations(chunks),
  };
}

/** Valuta la risposta dello studente a una domanda di quiz. */
export async function gradeTurn(
  q: QuizQuestion,
  studentAnswer: string
): Promise<TutorTurn> {
  const grade = await gradeAnswer(q.question, q.answer, studentAnswer);
  return { reply: grade.feedback, grade };
}
