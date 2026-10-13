import { retrieve, asContext, toCitations, type Citation } from "@/lib/rag/pipeline";
import { rag } from "@/lib/config";
import { generateStream, generate, type ChatMessage, type GenerateOptions } from "@/lib/providers";
import { generateQuiz, normalizeOption, type QuizQuestion } from "./quiz";
import { gradeAnswer, type Grade } from "./grade";
import { gradingSource } from "./gradingSource";
import { checkLeak, guardedReply, isSolutionRequest, type GuardResult } from "./guard";
import { LEVELS, type HintState } from "./hints";

export type TutorMode = "socratic" | "quiz" | "review";

/** Risultato di un turno del tutor. */
export interface TutorTurn {
  reply: string;
  citations?: Citation[];
  question?: QuizQuestion;
  grade?: Grade;
  source?: Citation; // passaggio usato dal giudice
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

/** Versione del prompt socratico (eval: `npm run eval -- tutor`). */
export const PROMPT_VERSION = "tutor-v4";

const SYSTEM = [
  "Sei un tutor che aiuta a imparare, non a copiare. Usa SOLO il contesto fornito e cita i passaggi con [n], solo con i numeri presenti nel contesto.",
  "",
  "Prima capisci che tipo di messaggio è:",
  "- Domanda di spiegazione (\"cos'è X\", \"che differenza c'è tra X e Y\", \"perché succede Z\"): rispondi subito, in breve (al massimo 6 frasi), con citazioni [n], poi fai UNA domanda di verifica.",
  "- Esercizio o problema (codice da scrivere, la risposta di un quiz, un calcolo, \"come risolvo\", \"dammi la soluzione\"): NON dare la soluzione. Dai solo l'indizio del livello corrente, uno per turno.",
  "È un esercizio anche quando suona come una spiegazione se lo studente deve rispondere a una domanda assegnata: un messaggio con \"Quiz\" o \"Esercizio\", con opzioni (A, B, C), con consegne come \"indica\", \"elenca\", \"quale scegli\", oppure la richiesta della risposta a una domanda posta prima nella conversazione. Nel dubbio, trattalo come esercizio.",
  "",
  "Livelli di indizio per gli esercizi:",
  ...Object.entries(LEVELS).map(([n, what]) => `${n}. ${what[0].toUpperCase()}${what.slice(1)}.`),
  "",
  "Regole fisse: mai la risposta finale dell'esercizio; mai codice che risolve l'esercizio; al massimo 5 righe di codice, solo per l'esempio analogo del livello 4.",
  "Il concetto in gioco non è la risposta: se la domanda chiede quale proprietà, metodo, simbolo, strumento o opzione usare, non nominarli.",
  "Non dare nemmeno una parte della risposta (uno degli elementi di un elenco richiesto) e non citare né parafrasare la frase del materiale che la contiene: indica solo dove cercarla.",
  "Se lo studente propone un tentativo, digli cosa funziona e cosa no, senza correggerlo al posto suo.",
  "Rispondi nella lingua dello studente.",
].join("\n");

const SOLUTION_SYSTEM = [
  "Sei un tutor. Lo studente ha già provato almeno due volte e ha chiesto la soluzione: ora dagliela completa.",
  "Usa SOLO il contesto fornito e cita i passaggi con [n]. Procedi per passi, e chiudi con l'errore da evitare guardando i suoi tentativi nella conversazione.",
  "Rispondi nella lingua dello studente.",
].join("\n");

export function socraticOptions(history: ChatMessage[], userMessage: string, context: string, level: number, signal?: AbortSignal, retryNote?: string): GenerateOptions {
  return {
    signal,
    system: `${SYSTEM}\n\nLivello di indizio corrente per gli esercizi: ${level} (${LEVELS[level]}).` +
      (retryNote ? `\n\n${retryNote}` : "") + `\n\nContesto:\n${context}`,
    temperature: 0.6,
    messages: [...history, { role: "user", content: userMessage }],
  };
}

export function solutionOptions(history: ChatMessage[], userMessage: string, context: string, signal?: AbortSignal): GenerateOptions {
  return { signal, system: `${SOLUTION_SYSTEM}\n\nContesto:\n${context}`, temperature: 0.3, messages: [...history, { role: "user", content: userMessage }] };
}

/** Turno a rischio: genera senza streaming e controlla la risposta (vedi `guard.ts`). */
export function guardedSocratic(history: ChatMessage[], message: string, context: string, level: number, signal?: AbortSignal, problem?: string): Promise<GuardResult> {
  return guardedReply({
    generate: (note) => generate("chat", socraticOptions(history, message, context, level, signal, note)),
    judge: (reply) => checkLeak(problem ? `${problem}\n${buildRetrievalQuery(history, message)}` : buildRetrievalQuery(history, message), context, reply, signal),
  });
}

export type Prepared =
  | { citations: Citation[]; guarded: false; tokens: AsyncIterable<string> }
  | { citations: Citation[]; guarded: true; reply: () => Promise<GuardResult> };

/** Retrieval e scelta del percorso: soluzione in streaming, turno a rischio controllato, altrimenti streaming. */
export async function prepareSocratic(history: ChatMessage[], message: string, domainId: number | undefined, hint: HintState, action: "reply" | "solution", signal?: AbortSignal, stream = true, problem?: string): Promise<Prepared> {
  signal?.throwIfAborted();
  const chunks = await retrieve(buildRetrievalQuery(history, message), domainId);
  signal?.throwIfAborted();
  const context = asContext(chunks);
  const citations = toCitations(chunks);
  // senza streaming (route JSON) la risposta arriva intera, come prima di questa fase
  const tokens = (o: GenerateOptions): AsyncIterable<string> =>
    stream ? generateStream("chat", o) : (async function* () { yield await generate("chat", o); })();
  if (action === "solution") return { citations, guarded: false, tokens: tokens(solutionOptions(history, message, context, signal)) };
  if (isSolutionRequest(message)) return { citations, guarded: true, reply: () => guardedSocratic(history, message, context, hint.level, signal, problem) };
  return { citations, guarded: false, tokens: tokens(socraticOptions(history, message, context, hint.level, signal)) };
}

/** Turno socratico senza SSE (route JSON). */
export async function socraticTurn(history: ChatMessage[], message: string, hint: HintState, domainId?: number, action: "reply" | "solution" = "reply", problem?: string) {
  const p = await prepareSocratic(history, message, domainId, hint, action, undefined, false, problem);
  if (p.guarded) {
    const r = await p.reply();
    return { reply: r.reply, citations: p.citations, guarded: true, blocked: r.blocked };
  }
  let reply = "";
  for await (const t of p.tokens) reply += t;
  return { reply, citations: p.citations, guarded: false, blocked: 0 };
}
