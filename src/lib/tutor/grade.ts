import { generate } from "@/lib/providers";

/** Versione del prompt del giudice: finisce in review_logs e nei risultati di `npm run eval`. */
export const PROMPT_VERSION = "grade-v2";

export const VERDICTS = ["wrong", "partial", "correct"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Giudizio su una risposta: cosa chiede la domanda, cosa c'è, cosa manca, cosa è falso, verdetto. */
export interface Grade {
  verdict: Verdict;
  required: string[]; // ciò che la domanda chiede
  present: string[];
  missing: string[];
  errors: string[];   // affermazioni false nella risposta
  feedback: string;   // per lo studente
}

const list = { type: "array", items: { type: "string" } } as const;
/** Ordine delle proprietà = ordine di generazione di Ollama: il verdetto arriva dopo il ragionamento. */
const SCHEMA = {
  type: "object",
  properties: {
    required: list,
    present: list,
    missing: list,
    errors: list,
    verdict: { type: "string", enum: VERDICTS },
    feedback: { type: "string" },
  },
  required: ["required", "present", "missing", "errors", "verdict", "feedback"],
} as const;

const SYSTEM = [
  "Sei un valutatore di risposte di studio. Si valuta ciò che la DOMANDA chiede, non tutto ciò che contiene la risposta attesa.",
  "Procedi in quest'ordine:",
  "1. required: gli elementi che la domanda chiede (da 1 a 4, brevi). Usa la risposta attesa e il passaggio sorgente solo per sapere qual è il contenuto giusto di quegli elementi: un dettaglio dell'attesa che la domanda non chiede NON è richiesto.",
  "2. present: gli elementi di required che la risposta dello studente contiene, anche con parole diverse o in un'altra lingua.",
  "3. missing: gli elementi di required assenti dalla risposta.",
  "4. errors: le affermazioni false della risposta, comprese le aggiunte sbagliate attribuite a ciò che è chiesto. Una risposta più lunga non vale di più.",
  "5. verdict:",
  "- correct: risponde a ciò che è chiesto, anche con parole diverse o in un'altra lingua; un dettaglio secondario omesso non impedisce correct.",
  "- partial: manca, o è sbagliato, un elemento richiesto (anche un'aggiunta falsa su ciò che è chiesto). Negli elenchi e negli abbinamenti una parte giusta vale partial.",
  "- wrong: sbaglia la proprietà centrale di ciò che è chiesto, oppure è vuota o «non so».",
  "6. feedback: 2-3 frasi in italiano per lo studente: cosa manca o è sbagliato e perché conta; se è corretta, cosa ha colto.",
  "Se la risposta attesa e il passaggio sorgente non coincidono, vale il passaggio sorgente.",
].join("\n");

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Accetta solo un giudizio ben formato. Un `correct` con mancanze o errori elencati è incoerente:
 * vale `partial` (rete contro le risposte lunghe e sbagliate promosse a corrette).
 */
export function parseGrade(raw: string): Grade | null {
  try {
    const g = JSON.parse(raw);
    if (!(VERDICTS as readonly unknown[]).includes(g?.verdict) || typeof g.feedback !== "string") return null;
    if (![g.required, g.present, g.missing, g.errors].every(strings)) return null;
    const verdict: Verdict = g.verdict === "correct" && (g.missing.length || g.errors.length) ? "partial" : g.verdict;
    return { verdict, required: g.required, present: g.present, missing: g.missing, errors: g.errors, feedback: g.feedback };
  } catch {
    return null;
  }
}

/** Il giudizio per `review_logs.grader_rationale` (il verdetto è già nel rating). */
export function rationaleJson({ required, present, missing, errors, feedback }: Grade): string {
  return JSON.stringify({ required, present, missing, errors, feedback });
}

const block = (label: string, text: string) => `${label}:\n"""\n${text}\n"""`;

/**
 * LLM-as-judge: verdetto sulla risposta libera, con il passaggio sorgente (se c'è) come riferimento.
 * Se il modello non produce un giudizio valido (dopo un retry) lancia un errore invece di
 * inventare un verdetto: un `wrong` finto rischedulerebbe la carta come dimenticata.
 */
export async function gradeAnswer(question: string, expected: string, studentAnswer: string, source?: string): Promise<Grade> {
  const content = [
    `Domanda: ${question}`,
    `Risposta attesa: ${expected}`,
    ...(source?.trim() ? [block("Passaggio sorgente", source.trim())] : []),
    block("Risposta dello studente", studentAnswer.trim()),
    "Valuta (JSON).",
  ].join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generate("grade", {
      system: SYSTEM,
      json: true,
      schema: SCHEMA as unknown as Record<string, unknown>,
      temperature: 0,
      messages: [{ role: "user", content }],
    });
    const grade = parseGrade(raw);
    if (grade) return grade;
  }
  throw new Error("Il modello non ha prodotto una valutazione valida: la carta non è stata riprogrammata. Riprova.");
}
