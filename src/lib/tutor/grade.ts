import { generate } from "@/lib/providers";

export interface Grade {
  quality: number;   // 0-5 per SM-2
  correct: boolean;
  feedback: string;  // spiegazione per lo studente
}

const SCHEMA = {
  type: "object",
  properties: {
    quality: { type: "integer", minimum: 0, maximum: 5 },
    correct: { type: "boolean" },
    feedback: { type: "string" },
  },
  required: ["quality", "correct", "feedback"],
} as const;

/** LLM-as-judge: valuta una risposta libera rispetto a quella attesa. */
export async function gradeAnswer(
  question: string,
  expected: string,
  studentAnswer: string
): Promise<Grade> {
  const raw = await generate("grade", {
    system:
      "Sei un valutatore equo. Confronta la risposta dello studente con quella attesa. " +
      "Premia la comprensione concettuale, non il match letterale. " +
      "quality: 5 perfetta, 3 sufficiente, 0 errata/vuota. Feedback breve e costruttivo.",
    json: true,
    schema: SCHEMA as unknown as Record<string, unknown>,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: `Domanda: ${question}\nAttesa: ${expected}\nStudente: ${studentAnswer}\n\nValuta (JSON).`,
      },
    ],
  });
  try {
    return JSON.parse(raw) as Grade;
  } catch {
    return { quality: 0, correct: false, feedback: "Impossibile valutare la risposta." };
  }
}
