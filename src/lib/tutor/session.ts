import { retrieve, asContext, toCitations, type Citation } from "@/lib/rag/pipeline";
import { rag } from "@/lib/config";
import { generateStream, generate, type ChatMessage, type GenerateOptions } from "@/lib/providers";
import { generateQuiz, normalizeOption, type QuizQuestion } from "./quiz";
import { gradeAnswer, type Grade } from "./grade";
import { gradingSource } from "./gradingSource";

export type TutorMode = "socratic" | "quiz" | "review";

/** Risultato di un turno del tutor. */
export interface TutorTurn {
  reply: string;
  citations?: Citation[];
  question?: QuizQuestion;
  grade?: Grade;
  source?: Citation; // passaggio usato dal giudice
}

/** Modalita' socratica: risponde con domande/indizi invece di dare la soluzione. */
export async function socraticTurn(
  history: ChatMessage[],
  userMessage: string,
  domainId?: number
): Promise<TutorTurn> {
  const chunks = await retrieve(buildRetrievalQuery(history, userMessage), domainId);
  const reply = await generate("chat", socraticOptions(history, userMessage, asContext(chunks)));
  return { reply, citations: toCitations(chunks) };
}

function socraticOptions(history: ChatMessage[], userMessage: string, context: string, signal?: AbortSignal): GenerateOptions {
  return {
    signal,
    system:
      "Sei un tutor socratico. Usa SOLO il contesto fornito. Invece di dare la risposta " +
      "completa, guida con domande e indizi progressivi. Cita i passaggi con [n].\n\n" +
      `Contesto:\n${context}`,
    temperature: 0.6,
    messages: [...history, { role: "user", content: userMessage }],
  };
}

/** Modalita' quiz: genera una domanda dal materiale di un argomento. */
export async function quizTurn(topic: string, domainId?: number): Promise<TutorTurn> {
  const chunks = await retrieve(topic, domainId);
  const [q] = await generateQuiz(asContext(chunks), 1, { topic });
  return {
    reply: q?.question ?? "Nessuna domanda generata.",
    question: q,
    citations: toCitations(chunks),
  };
}

/** Valuta la risposta a una domanda di quiz; le aperte col passaggio più pertinente come riferimento. */
export async function gradeTurn(q: QuizQuestion, studentAnswer: string, domainId?: number): Promise<TutorTurn> {
  if (q.type === "mcq" && q.options?.length) {
    const grade = gradeChoice(q, studentAnswer);
    return { reply: grade.feedback, grade };
  }
  const source = await gradingSource(q.question, null, domainId);
  const grade = await gradeAnswer(q.question, q.answer, studentAnswer, source?.text);
  return { reply: grade.feedback, grade, source: source?.citation };
}

/**
 * Le mcq hanno una sola risposta giusta: confronto esatto, niente LLM-as-judge
 * (che premiava opzioni sbagliate ma "concettualmente vicine"). Mai partial.
 */
export function gradeChoice(q: QuizQuestion, chosen: string): Grade {
  const correct = normalizeOption(chosen) === normalizeOption(q.answer);
  const why = q.rationale?.trim() ? ` ${q.rationale.trim()}` : "";
  const empty = { required: [], present: [], missing: [], errors: [] };
  return correct
    ? { verdict: "correct", ...empty, feedback: `Corretto.${why}` }
    : { verdict: "wrong", ...empty, feedback: `Non è corretta. Risposta giusta: «${q.answer}».${why}` };
}

/** Il seguito resta ancorato all'ultima domanda e risposta, senza una chiamata LLM. */
export function buildRetrievalQuery(history: ChatMessage[], message: string, excerptChars = rag.retrievalExcerptChars): string {
  if (!history.length) return message;
  const user = [...history].reverse().find((m) => m.role === "user");
  const assistant = [...history].reverse().find((m) => m.role === "assistant");
  return [user?.content.slice(0, excerptChars), assistant?.content.slice(0, excerptChars), message].filter(Boolean).join("\n");
}

export async function prepareSocraticStream(history: ChatMessage[], message: string, domainId?: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const chunks = await retrieve(buildRetrievalQuery(history, message), domainId);
  signal?.throwIfAborted();
  return {citations: toCitations(chunks), tokens: generateStream("chat", socraticOptions(history, message, asContext(chunks), signal))};
}
