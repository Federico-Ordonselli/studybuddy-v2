import { generate } from "@/lib/providers";

export interface QuizQuestion {
  type: "open" | "mcq";
  question: string;
  options?: string[];     // solo mcq
  answer: string;         // risposta attesa / opzione corretta
  rationale: string;      // perche', per il feedback
}

const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["open", "mcq"] },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["type", "question", "answer", "rationale"],
      },
    },
  },
  required: ["questions"],
} as const;

export interface QuizOptions {
  /** Argomento richiesto: senza, il modello pesca un passaggio qualsiasi del contesto. */
  topic?: string;
  /** "open" per le flashcard (allenano il richiamo e non salvano le opzioni). */
  kind?: "mixed" | "open";
}

/** Normalizza un testo per confronti esatti tra opzioni (spazi, maiuscole). */
export function normalizeOption(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Una mcq è valutabile in modo deterministico solo se `answer` è una delle opzioni.
 * Se il modello sbaglia formato, la domanda resta utile come domanda aperta.
 */
function ensureGradable(q: QuizQuestion): QuizQuestion {
  if (q.type !== "mcq") return q;
  const match = q.options?.find((o) => normalizeOption(o) === normalizeOption(q.answer ?? ""));
  if (match && (q.options?.length ?? 0) >= 2) return { ...q, answer: match };
  return { type: "open", question: q.question, answer: q.answer, rationale: q.rationale };
}

/**
 * Rete di sicurezza oltre al prompt: il modello a volte scrive "quale dei seguenti…"
 * o "secondo il testo…" anche quando gli si chiede di non farlo. Lo studente non vede
 * né il contesto né (nelle domande aperte) delle opzioni: la domanda va scartata.
 */
const REFERS_TO_HIDDEN = /\b(seguent[ie]|following|(nel|il|del|secondo il) (testo|contesto|passaggio)|(in|the) (text|context|passage))\b/i;

function isSelfContained(q: QuizQuestion): boolean {
  if (q.type === "mcq" && q.options?.length) return !/\b(testo|contesto|text|context|passage|passaggio)\b/i.test(q.question);
  return !REFERS_TO_HIDDEN.test(q.question);
}

/** Genera domande dal contesto recuperato, centrate sull'argomento richiesto. */
export async function generateQuiz(context: string, n = 3, opts: QuizOptions = {}): Promise<QuizQuestion[]> {
  const kind = opts.kind ?? "mixed";
  const types =
    kind === "open"
      ? "Genera SOLO domande aperte (type 'open'), con in `answer` una risposta attesa breve e precisa."
      : "Mescola domande aperte e a risposta multipla. Per le domande 'mcq': fornisci 3-4 opzioni in " +
        "`options` e metti in `answer` il TESTO COMPLETO dell'opzione corretta (non una lettera), " +
        "identico a una delle opzioni. Una sola opzione deve essere corretta.";
  const topic = opts.topic?.trim();
  const raw = await generate("quiz", {
    system:
      "Sei un tutor. Genera domande di studio basate ESCLUSIVAMENTE sul contesto fornito. " +
      (topic
        ? `Le domande devono riguardare l'argomento richiesto: usa solo i passaggi del contesto pertinenti e ignora gli altri. `
        : "") +
      `${types} Ogni domanda deve essere comprensibile da sola: lo studente non vede il contesto, ` +
      "quindi niente riferimenti a 'il testo', 'il contesto', 'i seguenti esempi' o opzioni non incluse. " +
      "Lingua: quella del contesto.",
    json: true,
    schema: SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.4,
    messages: [
      {
        role: "user",
        content:
          `Contesto:\n${context}\n\n` +
          (topic ? `Argomento richiesto: ${topic}\n\n` : "") +
          `Genera ${n} domande (JSON).`,
      },
    ],
  });
  try {
    const qs = (JSON.parse(raw).questions as QuizQuestion[]) ?? [];
    return qs
      .filter((q) => q?.question?.trim() && q.answer?.trim())
      .map((q) => (kind === "open" ? { ...q, type: "open" as const, options: undefined } : ensureGradable(q)))
      .filter(isSelfContained);
  } catch {
    return [];
  }
}
