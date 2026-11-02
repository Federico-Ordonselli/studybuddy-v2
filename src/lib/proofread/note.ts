/**
 * Correzione di una nota: refusi, ortografia, accenti, punteggiatura e formattazione
 * Markdown, senza cambiare il contenuto. Ogni sezione passa da `protect` (segnaposto per
 * codice, link, formule…), dal modello del task `proofread` e da `compareWords`: se la
 * correzione riscrive, toglie parole o perde un segnaposto si riprova una volta, poi
 * paragrafo per paragrafo; dove non va ancora si tiene l'originale e lo si segnala. Il generatore è iniettabile per i test.
 */
import { generate, type GenerateOptions } from "@/lib/providers";
import { protect, restore, splitFrontmatter } from "./protect";
import { splitParagraphs, splitSections } from "./split";
import { compareWords, dropInventedHeadings, isAcceptable, rejectionReason, type ChangeReport } from "./guard";

export const PROMPT_VERSION = "proofread-v1";

export const SYSTEM = `Sei un correttore di bozze di appunti di studio scritti in Markdown (Obsidian).
Correggi SOLO:
- refusi e lettere scambiate ("tecnhiche" → "tecniche", "isstema" → "sistema");
- ortografia, accenti e apostrofi ("e'" → "è", "perche" → "perché", "un pò" → "un po'", "qual'è" → "qual è");
- maiuscola a inizio frase, spazi doppi, spazi prima della punteggiatura, punteggiatura mancante a fine frase;
- formattazione Markdown: elenchi con lo stesso simbolo e la stessa indentazione, una riga vuota prima di un titolo o di un elenco;
- titoli: solo una riga breve, senza verbo e senza ":", che introduce il paragrafo che la segue (es. "il modello Von Neumann") può diventare un titolo Markdown (#, ##).

Le righe "Termine: definizione" restano UNA riga con i due punti, anche dentro un elenco:
"Porgramma: sere di istruzioni" → "Programma: serie di istruzioni" (mai "# Programma" seguito da "Serie di istruzioni");
"- hardware: dispositivi fisici" → "- hardware: dispositivi fisici" (mai "- Hardware" a capo "Dispositivi fisici").
Non spezzare né unire righe.

NON fare MAI:
- riformulare, riassumere, completare, spiegare o aggiungere frasi, parole o titoli nuovi;
- togliere contenuto, anche se ripetuto o impreciso: gli errori di contenuto restano;
- tradurre: ogni parte resta nella sua lingua, termini tecnici inglesi compresi;
- cambiare l'ordine delle righe.

I segnaposto come ⟦0⟧, ⟦1⟧ rappresentano codice, link o formule: lasciali identici, dove sono.
Rispondi solo con il testo corretto, senza commenti e senza racchiuderlo in un blocco di codice.`;

const RETRY_NOTE =
  "La correzione precedente cambiava troppe parole o perdeva dei segnaposto ⟦n⟧. Correggi di nuovo, toccando solo refusi, accenti, punteggiatura e formattazione: ogni altra parola resta identica.";

export type SectionStatus = "unchanged" | "corrected" | "rejected" | "skipped";

export interface SectionResult {
  status: SectionStatus;
  original: string;
  text: string;
  report?: ChangeReport;
  reason?: string;
}

export interface NoteResult {
  text: string;
  sections: SectionResult[];
}

export type Generator = (opts: GenerateOptions) => Promise<string>;

const defaultGenerator: Generator = (opts) => generate("proofread", opts);

/** Il modello a volte racchiude la risposta in ```markdown … ```: lo si toglie. */
export function unwrap(output: string): string {
  const m = output.trim().match(/^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/);
  return m ? m[1] : output.trim();
}

/** Rimette gli spazi bianchi iniziali e finali dell'originale (il modello li perde). */
function keepEdges(original: string, corrected: string): string {
  const lead = original.match(/^\s*/)![0];
  const trail = original.match(/\s*$/)![0];
  return lead + corrected.trim() + trail;
}

/** Un pezzo di testo: fino a due tentativi, poi l'originale. */
export async function proofreadPiece(original: string, gen: Generator = defaultGenerator, signal?: AbortSignal): Promise<SectionResult> {
  if (!/[\p{L}]/u.test(original)) return { status: "skipped", original, text: original };
  // finisce con una lettera e senza a capo: l'ultima parola la stai ancora scrivendo
  const typing = /\p{L}$/u.test(original);
  const { text, slots } = protect(original, { trailingWord: typing });
  const last = `⟦${slots.length - 1}⟧`;
  if (!/[\p{L}]{2}/u.test(text.replace(/⟦\d+⟧/g, ""))) return { status: "skipped", original, text: original };

  let reason = "";
  let report: ChangeReport | undefined;
  let previous = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: GenerateOptions["messages"] = [{ role: "user", content: text }];
    if (attempt) messages.push({ role: "assistant", content: previous }, { role: "user", content: RETRY_NOTE });
    const raw = await gen({
      system: SYSTEM,
      messages,
      temperature: 0,
      think: false,
      // l'uscita è lunga quanto l'ingresso: ~3 caratteri per token, più margine
      maxTokens: Math.max(512, Math.ceil(text.length / 2.5) + 256),
      signal,
    });
    previous = raw;
    let output = unwrap(raw);
    // niente punto aggiunto dopo la parola a metà
    if (typing && slots.length) output = output.replace(new RegExp(`${last}[.!?;:…]+$`), last);
    const restored = restore(output, slots);
    if (restored === null) {
      reason = "segnaposto persi o alterati";
      continue;
    }
    const corrected = keepEdges(original, dropInventedHeadings(original, restored));
    report = compareWords(original, corrected);
    if (!isAcceptable(report)) {
      reason = rejectionReason(report);
      continue;
    }
    return { status: corrected === original ? "unchanged" : "corrected", original, text: corrected, report };
  }
  return { status: "rejected", original, text: original, report, reason };
}

/**
 * Una sezione intera; se la correzione non è affidabile si riprova per paragrafi, poi per
 * righe, così un solo errore del modello non fa perdere le correzioni buone del resto.
 */
export async function proofreadSection(
  original: string,
  gen: Generator = defaultGenerator,
  signal?: AbortSignal,
  level = 0,
): Promise<SectionResult[]> {
  const whole = await proofreadPiece(original, gen, signal);
  if (whole.status !== "rejected" || level >= 2) return [whole];
  const parts = level === 0 ? splitParagraphs(original) : original.split(/(?<=\n)/);
  if (parts.length < 2) return level === 0 ? proofreadSection(original, gen, signal, 1) : [whole];
  const out: SectionResult[] = [];
  for (const p of parts) out.push(...(await proofreadSection(p, gen, signal, level + 1)));
  return out;
}

export async function proofreadNote(note: string, gen: Generator = defaultGenerator, signal?: AbortSignal): Promise<NoteResult> {
  const eol = note.includes("\r\n") ? "\r\n" : "\n";
  const { frontmatter, body } = splitFrontmatter(note.replace(/\r\n/g, "\n"));
  const sections: SectionResult[] = [];
  for (const s of splitSections(body)) sections.push(...(await proofreadSection(s, gen, signal)));
  const text = frontmatter + sections.map((s) => s.text).join("");
  return { text: eol === "\n" ? text : text.replace(/\n/g, "\r\n"), sections };
}
