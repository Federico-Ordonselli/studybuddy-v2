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

/** Accetta solo un Grade ben formato: un JSON valido ma incompleto non deve arrivare a SM-2. */
function parseGrade(raw: string): Grade | null {
  try {
    const g = JSON.parse(raw);
    if (!Number.isInteger(g?.quality) || g.quality < 0 || g.quality > 5) return null;
    if (typeof g.correct !== "boolean" || typeof g.feedback !== "string") return null;
    return { quality: g.quality, correct: g.correct, feedback: g.feedback };
  } catch {
    return null;
  }
}

/**
 * LLM-as-judge: valuta una risposta libera rispetto a quella attesa.
 * Se il modello non produce un giudizio valido (dopo un retry) lancia un errore
 * invece di restituire quality 0: per SM-2 lo 0 significa "non la sapevi" e
 * azzererebbe l'intervallo della carta per colpa del modello.
 */
export async function gradeAnswer(
  question: string,
  expected: string,
  studentAnswer: string
): Promise<Grade> {
  for (let attempt = 0; attempt < 2; attempt++) {
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
    const grade = parseGrade(raw);
    if (grade) return grade;
  }
  throw new Error("Il modello non ha prodotto una valutazione valida: la carta non è stata riprogrammata. Riprova.");
}
