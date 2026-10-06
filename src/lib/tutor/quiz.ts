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

/** Genera domande dal volo dal contesto recuperato. */
export async function generateQuiz(context: string, n = 3): Promise<QuizQuestion[]> {
  const raw = await generate("quiz", {
    system:
      "Sei un tutor. Genera domande di studio basate ESCLUSIVAMENTE sul contesto fornito. " +
      "Mescola domande aperte e a risposta multipla. Lingua: quella del contesto. " +
      "Per le domande 'mcq': fornisci 3-4 opzioni in `options` e metti in `answer` il " +
      "TESTO COMPLETO dell'opzione corretta (non una lettera), identico a una delle opzioni.",
    json: true,
    schema: SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.4,
    messages: [{ role: "user", content: `Contesto:\n${context}\n\nGenera ${n} domande (JSON).` }],
  });
  try {
    return (JSON.parse(raw).questions as QuizQuestion[]) ?? [];
  } catch {
    return [];
  }
}
