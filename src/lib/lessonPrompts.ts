import { generate } from "@/lib/providers";
import { REFERS_TO_HIDDEN } from "@/lib/tutor/cardQuality";

export const PROMPT_VERSION = "cornell-v1";
export const SUMMARY_PROMPT_VERSION = "cornell-summary-v2";
export const SUMMARY_QUESTION = "Riassumi i concetti centrali trattati nelle domande guida.";
export interface GuideQuestion { question: string; answer: string; source: number }
export interface LessonPassage { chunkId: number; content: string }

/** Mantiene l'ordine e distribuisce il budget sull'intera lezione, senza leggere altri documenti. */
export function lessonPassages(chunks: LessonPassage[], budget = 24000): { passages: LessonPassage[]; partial: boolean } {
  const nonempty = chunks.filter((c) => c.content.trim());
  const total = nonempty.reduce((n, c) => n + c.content.length, 0);
  if (total <= budget) return { passages: nonempty, partial: false };
  const count = Math.min(nonempty.length, 16);
  const allowance = Math.floor(budget / count);
  return { passages: Array.from({ length: count }, (_, i) => {
    const c = nonempty[Math.floor(i * (nonempty.length - 1) / Math.max(count - 1, 1))];
    return { ...c, content: c.content.slice(0, allowance) };
  }), partial: true };
}

export const passageContext = (passages: LessonPassage[]) => passages.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n");

export function parseGuide(raw: string, passages: LessonPassage[]): GuideQuestion[] | null {
  try {
    const qs: unknown = JSON.parse(raw).questions;
    if (!Array.isArray(qs) || qs.length < 5 || qs.length > 8) return null;
    const seen = new Set<string>();
    const out: GuideQuestion[] = [];
    for (const q of qs) {
      if (!q || typeof q.question !== "string" || typeof q.answer !== "string" ||
        !q.question.trim() || !q.answer.trim() || q.question.length > 500 || q.answer.length > 1500 ||
        !Number.isInteger(q.source) || q.source < 1 || q.source > passages.length || REFERS_TO_HIDDEN.test(q.question)) return null;
      const question = q.question.trim();
      const key = question.toLocaleLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) return null;
      seen.add(key);
      const answer = q.answer.replace(/\[\d+\]/g, "").trim();
      if (!answer) return null;
      out.push({ question, answer, source: q.source });
    }
    return out;
  } catch { return null; }
}

/** Le risposte restano sul server: servono per verificare il riassunto e proporre carte dopo gli appunti. */
export async function generateGuide(passages: LessonPassage[]): Promise<GuideQuestion[]> {
  const schema = { type: "object", properties: { questions: { type: "array", minItems: 5, maxItems: 8,
    items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" }, source: { type: "integer" } },
      required: ["question", "answer", "source"] } } }, required: ["questions"] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generate("quiz", {
      system: "Prepara da 5 a 8 domande guida per appunti Cornell su UNA lezione. Usa esclusivamente i passaggi forniti. " +
        "Copri i concetti centrali spiegati nella lezione: definizioni, meccanismi, differenze e applicazioni. " +
        "Ignora saluti, promozione, logistica e annunci di argomenti senza spiegazione. " +
        "Ogni domanda nomina il suo soggetto ed è comprensibile senza vedere i passaggi; niente riferimenti al testo, " +
        "alla lezione o a opzioni non incluse. Domande aperte, diverse fra loro, non sì/no; non anticipare la risposta nella domanda. " +
        "answer è una risposta di riferimento breve e precisa, fondata sul passaggio source (numero [n]). " +
        "Non inventare fatti per raggiungere il numero: se il materiale è insufficiente restituisci questions vuoto. " +
        "Scrivi in italiano naturale mantenendo nomi tecnici e codice in originale.",
      messages: [{ role: "user", content: `Passaggi della lezione:\n${passageContext(passages)}\n\nGenera le domande guida (JSON).` }],
      schema, json: true, temperature: 0.3,
    });
    const guide = parseGuide(raw, passages);
    if (guide) return guide;
  }
  throw new Error("Non è stato possibile creare 5–8 domande guida valide. La lezione potrebbe contenere troppo poco materiale: scegli un'altra lezione o riprova.");
}
