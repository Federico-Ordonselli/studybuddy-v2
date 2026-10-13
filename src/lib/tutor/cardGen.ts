import { generate } from "@/lib/providers";
import { cleanTranscript } from "@/lib/rag/cleanTranscript";
import { jaccard } from "@/lib/shingles";
import { checkCard, CLOZE_BLANK, isDuplicateQuestion, type CardIssue } from "./cardQuality";

/**
 * Generatore dedicato delle flashcard (Fase 3): prima i fatti singoli, poi una carta per
 * fatto, con il passaggio da cui viene. Ogni carta passa da `checkCard`: chi la salva decide
 * cosa fare di quelle segnalate (l'anteprima le mostra, il salvataggio diretto le salta).
 */

/** Versione del prompt: finisce nei risultati di `npm run eval -- cards`. */
export const PROMPT_VERSION = "cards-v3";

export interface CardChunk {
  chunkId: number;
  content: string;
  docKind?: string;
}

export interface CardDraft {
  question: string;
  answer: string;
  type: "qa" | "cloze";
  fact: string;                 // il fatto da cui viene la carta ("" se il modello non l'ha indicato)
  sourceChunkId: number | null;
  issues: CardIssue[];          // vuoto = carta valida
}

export interface CardGenOptions {
  n: number;                    // carte richieste (il modello può darne meno)
  topic?: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    facts: { type: "array", items: { type: "string" } },
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fact: { type: "integer" },
          type: { type: "string", enum: ["qa", "cloze"] },
          question: { type: "string" },
          answer: { type: "string" },
          source: { type: "integer" },
        },
        required: ["fact", "type", "question", "answer", "source"],
      },
    },
  },
  required: ["facts", "cards"],
} as const;

const SYSTEM = [
  "Crei flashcard per il ripasso a intervalli, basate ESCLUSIVAMENTE sui passaggi forniti. Chi ripassa vuole imparare la materia.",
  "Procedi in due passi:",
  "1. facts: i fatti singoli della materia utili da ricordare, una frase ciascuno: concetti, definizioni, meccanismi, differenze, sintassi, comportamenti di uno strumento.",
  "   NON sono fatti della materia, quindi ignorali: la logistica del corso (moduli, lezioni, certificati, progetti, obiettivi didattici), statistiche e sondaggi citati per motivare, frasi promozionali (una tecnologia «veloce», «potente», «emergente», «che ridefinisce…»), le storie e i personaggi degli esempi (cosa fa Sarah o un team immaginario), i passi di una dimostrazione («apro il file», «salvo»).",
  "   Le introduzioni e i riepiloghi di un corso di solito annunciano argomenti senza spiegarli: da lì crea carte solo per i fatti spiegati davvero, spesso nessuno.",
  "   Riporta il fatto con le sue condizioni e eccezioni, senza generalizzare oltre ciò che dice il passaggio. Se un passaggio non contiene fatti della materia, non crearne.",
  "2. cards: una carta per fatto, con `fact` = indice (da 0) del fatto in facts. Meglio poche carte buone che il numero massimo.",
  "Regole delle carte:",
  "- Una carta = un fatto. Una lista di N elementi diventa N carte, oppure nessuna: mai «elenca» o «quali sono i…».",
  "- Una sola domanda per carta. Risposta precisa: una frase, un termine o un frammento di codice, mai vaga («quasi tutto», «vari modi»).",
  "- La domanda nomina sempre il suo soggetto (lo strumento, il linguaggio, la proprietà, il metodo): chi ripassa non vede i passaggi e non sa di quale video si parla. Niente «secondo il testo», «nel passaggio», «i seguenti».",
  "- Mescola definizioni («cos'è…») e meccanismi («perché…», «cosa succede se…»): i secondi allenano la comprensione.",
  "- Niente domande sì/no o vero/falso: si indovinano.",
  `- type "cloze": question = la frase del fatto con UNA parola chiave sostituita da ${CLOZE_BLANK}, answer = la parola tolta. Solo se la parola tolta non si deduce dal resto della frase; altrimenti type "qa".`,
  "- La risposta non deve comparire nella domanda.",
  "- source = il numero [n] del passaggio da cui viene il fatto.",
  "Lingua: scrivi fatti e carte in un italiano corretto e naturale; nomi di strumenti, proprietà, metodi e codice restano in originale. Un termine tecnico o si traduce tutto o resta tutto in originale («test di integrazione» o «integration testing», mai metà e metà).",
].join("\n");

/** Passaggi numerati [n]; le trascrizioni ripulite dal parlato (solo per generare, l'indice resta com'è). */
export function buildCardContext(chunks: CardChunk[]): string {
  return chunks.map((c, i) => `[${i + 1}] ${c.docKind === "transcript" ? cleanTranscript(c.content) : c.content}`).join("\n\n");
}

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** Attribuzione lessicale della risposta al passaggio più pertinente. */
export function sourceForAnswer(answer: string, chunks: { chunkId: number; content: string }[]): number | null {
  return chunks.map((c, i) => ({ id: c.chunkId, score: jaccard(words(answer), words(c.content)), i })).sort((a, b) => b.score - a.score || a.i - b.i)[0]?.id ?? null;
}

/** Quota delle parole significative di `text` presenti nel passaggio. */
function coverage(text: string, passage: string): number {
  const own = [...words(text)].filter((w) => w.length >= 3);
  if (!own.length) return 0;
  const p = words(passage);
  return own.filter((w) => p.has(w)).length / own.length;
}

/** Sotto questa copertura la fonte dichiarata dal modello non è credibile: si usa l'attribuzione lessicale. */
const MIN_SOURCE_COVERAGE = 0.25;

function resolveSource(declared: unknown, text: string, chunks: CardChunk[]): number | null {
  const chunk = Number.isInteger(declared) ? chunks[(declared as number) - 1] : undefined;
  if (chunk && coverage(text, chunk.content) >= MIN_SOURCE_COVERAGE) return chunk.chunkId;
  return sourceForAnswer(text, chunks);
}

/** Output del modello → bozze. Scarta solo ciò che non è una carta; il resto lo giudica `checkCard`. */
export function parseCardOutput(raw: string, chunks: CardChunk[]): CardDraft[] {
  let out: { facts?: unknown; cards?: unknown };
  try { out = JSON.parse(raw); } catch { return []; }
  const facts = Array.isArray(out?.facts) ? out.facts.map((f) => (typeof f === "string" ? f.trim() : "")) : [];
  if (!Array.isArray(out?.cards)) return [];
  const drafts: CardDraft[] = [];
  for (const c of out.cards as Record<string, unknown>[]) {
    const question = typeof c?.question === "string" ? c.question.trim() : "";
    const answer = typeof c?.answer === "string" ? c.answer.trim() : "";
    if (!question || !answer) continue;
    const fact = Number.isInteger(c.fact) ? facts[c.fact as number] ?? "" : "";
    const type = c.type === "cloze" && question.includes(CLOZE_BLANK) ? "cloze" : "qa";
    drafts.push({ question, answer, type, fact, sourceChunkId: resolveSource(c.source, `${fact} ${answer}`, chunks), issues: checkCard({ question, answer }) });
  }
  return drafts;
}

/** Segna come duplicate le carte già presenti nel corso o già proposte nella stessa generazione. */
export function markDuplicates(drafts: CardDraft[], existing: string[]): CardDraft[] {
  const seen = [...existing];
  return drafts.map((d) => {
    const duplicate = isDuplicateQuestion(d.question, seen);
    seen.push(d.question);
    return duplicate ? { ...d, issues: [...d.issues, { code: "duplicate" as const, message: "C'è già una carta con questa domanda." }] } : d;
  });
}

/** Bozze di carte dai passaggi (un retry se il JSON non è valido). Nessun salvataggio. */
export async function generateCardDrafts(chunks: CardChunk[], opts: CardGenOptions): Promise<CardDraft[]> {
  if (!chunks.length) return [];
  const topic = opts.topic?.trim();
  const content = [
    `Passaggi:\n${buildCardContext(chunks)}`,
    ...(topic ? [`Argomento richiesto: ${topic}. Usa solo i passaggi pertinenti e ignora gli altri.`] : []),
    `Crea al massimo ${opts.n} carte (JSON).`,
  ].join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generate("quiz", {
      system: SYSTEM,
      json: true,
      schema: SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.3,
      messages: [{ role: "user", content }],
    });
    try { JSON.parse(raw); } catch { continue; }
    return parseCardOutput(raw, chunks);
  }
  return [];
}
