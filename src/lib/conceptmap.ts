import { generate } from "@/lib/providers";
import { models } from "@/lib/config";
import { sqlite } from "@/lib/db";
import { hybridSearch, toCitations, type Citation } from "@/lib/rag/pipeline";
import type { Retrieved } from "@/lib/rag/store";
import { mapFromProposal } from "@/lib/mappe/proposte.js";
import type { MapDocument } from "@/lib/mappe/store";

/**
 * Mappe concettuali esplorabili. L'LLM propone concetti (con definizione,
 * spiegazione, esempi e fonti [n]) e relazioni per titolo; la conversione in
 * documento/comandi della mappa sta in `lib/mappe/proposte.js`.
 */
export interface SourceRef {
  documentId: string; documentRevision: string; chunkId: string;
  start?: number; end?: number; excerpt?: string;
}
export interface ProposedConcept {
  title: string; kind?: string; definition?: string; explanation?: string;
  examples?: string[]; sourceRefs?: SourceRef[]; verb?: string;
}
export interface Proposal { concepts: ProposedConcept[]; relations: { from: string; to: string; label: string }[] }

const CONCEPT = {
  type: "object",
  properties: {
    title: { type: "string" },
    kind: { type: "string", enum: ["concept", "definition", "example", "question", "note"] },
    definition: { type: "string" },
    explanation: { type: "string" },
    examples: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "integer" } },
    verb: { type: "string" },
  },
  required: ["title", "definition", "explanation", "sources", "verb"],
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    center: { ...CONCEPT, required: ["title", "definition", "explanation", "sources"] },
    concepts: { type: "array", items: CONCEPT },
    relations: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" } },
        required: ["from", "to", "label"],
      },
    },
  },
  required: ["center", "concepts", "relations"],
} as const;

const FIELDS =
  "Per ogni concetto: `title` breve (2-5 parole), `definition` in una frase, `explanation` di 2-4 frasi " +
  "che spieghi il concetto come farebbe un buon tutor, `examples` concreti dal materiale (anche codice o formule, se ci sono), " +
  "`sources` = numeri [n] dei passaggi usati, `verb` = verbo di 1-3 parole che lega `center` a questo concetto " +
  "(es. \"include\", \"si basa su\", \"produce\"): descrive il rapporto fra i due concetti, MAI un'istruzione " +
  "come \"Explain\" o \"Describe\". `relations`: archi ulteriori fra i concetti (non dal centro) " +
  "con `from`/`to` = titoli ESATTI e `label` = verbo di 1-3 parole. " +
  "Basati ESCLUSIVAMENTE sul materiale. Lingua: quella del materiale.";

const PASSAGE_CHARS = 2500;

/** Al massimo `perDoc` passaggi per documento: una mappa ha bisogno di ampiezza, non di 10 chunk dello stesso file. */
async function diverseSearch(query: string, k: number, domainId: number, perDoc = 3): Promise<Retrieved[]> {
  const count = new Map<number, number>();
  return (await hybridSearch(query, k * 3, domainId)).filter((c) => {
    const n = (count.get(c.documentId) ?? 0) + 1;
    count.set(c.documentId, n);
    return n <= perDoc;
  }).slice(0, k);
}

/**
 * Chiede la proposta all'LLM. `center` è il concetto attorno a cui si costruisce
 * il livello (l'argomento della mappa, o la bolla in cui si entra): gli archi
 * centro→concetto vengono dal campo `verb` di ciascun concetto.
 */
async function propose(system: string, user: string, found: Retrieved[], centerTitle?: string, centerName?: string): Promise<Proposal> {
  // Tetto per passaggio: alcuni chunk HTML sono enormi (fino a ~270k caratteri) e
  // sforerebbero num_ctx, che Ollama tronca in silenzio lasciando il JSON a metà.
  const ctx = found.map((c, i) => `[${i + 1}] ${c.content.slice(0, PASSAGE_CHARS)}`).join("\n\n");
  type Raw = ProposedConcept & { sources?: number[] };
  let parsed: { center?: Raw; concepts?: Raw[]; relations?: Proposal["relations"] } | undefined;
  // Un retry: con spiegazioni ed esempi di codice l'output può finire troncato a metà JSON.
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const raw = await generate("summarize", {
      system,
      json: true,
      schema: SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.3,
      maxTokens: 6000,
      messages: [{ role: "user", content: `${user}\n\nMateriale:\n${ctx}` }],
    });
    try { parsed = JSON.parse(raw); } catch { /* riprova */ }
  }
  if (!parsed) throw new Error("risposta del modello non valida (JSON), anche al secondo tentativo");
  const cites = toCitations(found);
  // Mappa nuova: il centro proposto apre l'elenco. Approfondimento: il centro è la bolla, già nella mappa.
  // Il centro di una mappa nuova prende il nome dell'argomento richiesto (non "X Summary" o simili).
  if (centerName && parsed.center) parsed.center.title = centerName;
  const center = centerTitle ?? parsed.center?.title?.trim();
  const list = [...(centerTitle || !parsed.center ? [] : [parsed.center]), ...(parsed.concepts ?? [])];
  const concepts = list.filter((c) => c?.title?.trim()).map(({ sources, ...c }) => ({
    ...c,
    sourceRefs: [...new Set(sources ?? [])]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= found.length)
      .map((n) => sourceRef(found[n - 1], cites[n - 1])),
  }));
  const relations = (parsed.relations ?? []).filter((r) => r?.from && r?.to);
  const linked = new Set(relations.flatMap((r) => [`${r.from}|${r.to}`, `${r.to}|${r.from}`].map((k) => k.toLowerCase())));
  if (center) for (const c of concepts) {
    if (c.title === center || linked.has(`${center}|${c.title}`.toLowerCase())) continue;
    const verb = c.verb?.trim() ?? "";
    relations.push({ from: center, to: c.title, label: verb && verb.length <= 40 && !/[/:]/.test(verb) ? verb : "include" });
  }
  return { concepts, relations };
}

function sourceRef(c: Retrieved, cite: Citation): SourceRef {
  const hash = (c.docMeta as { fileHash?: string } | undefined)?.fileHash;
  const ref: SourceRef = {
    documentId: String(c.documentId),
    documentRevision: (hash ?? "1").slice(0, 120),
    chunkId: String(c.chunkId),
    excerpt: cite.label.slice(0, 300),
  };
  if (cite.startSec != null) {
    ref.start = Math.floor(cite.startSec);
    ref.end = Math.max(ref.start, Math.floor(cite.endSec ?? cite.startSec));
  }
  return ref;
}

const provenance = () => ({ origin: "llm", model: models.summarize.model, createdAt: new Date().toISOString() });

/** Mappa nuova su un argomento: il primo concetto è il centro, poi 6-10 concetti chiave. */
export async function generateMap(domainId: number, topic: string): Promise<MapDocument> {
  const found = await diverseSearch(topic, 14, domainId);
  if (!found.length) throw new Error("nessun materiale trovato per questo argomento");
  const proposal = await propose(
    "Costruisci una mappa concettuale di studio dal materiale fornito. `center` = il concetto centrale " +
      "dell'argomento richiesto. `concepts` = ALMENO 6 (massimo 10) concetti chiave concreti: i rami principali " +
      "dell'argomento, non dettagli minuti (quelli si esplorano dopo entrando nelle bolle) e non elementi " +
      "marginali solo perché compaiono nel materiale. " + FIELDS,
    `Argomento: ${topic}`,
    found,
    undefined,
    topic
  );
  if (!proposal.concepts.length) throw new Error("il modello non ha estratto concetti");
  return mapFromProposal(topic, proposal, { provenance: provenance() }) as MapDocument;
}

/**
 * Approfondimento di una bolla: i sotto-concetti di `concept` (componenti,
 * proprietà, formule, esempi...) nel contesto del percorso. I concetti già
 * presenti nella mappa vengono richiamati con lo stesso titolo, così diventano
 * collegamenti fra livelli invece di duplicati.
 */
export async function expandConcept(
  domainId: number,
  concept: { title: string; definition?: string },
  path: string[],
  existing: string[],
  present: string[] = []
): Promise<Proposal> {
  const query = [concept.title, concept.definition].filter(Boolean).join(" — ");
  const found = await diverseSearch(query, 12, domainId);
  if (!found.length) throw new Error("nessun materiale trovato su questo concetto");
  const known = existing.filter((t) => t !== concept.title).slice(0, 150);
  return propose(
    `Stai aiutando a studiare il concetto «${concept.title}» entrando nel dettaglio. ` +
      `\`center\` = «${concept.title}» stesso. \`concepts\`: 4-8 sotto-concetti o aspetti di questo concetto presenti ` +
      "nel materiale (componenti, proprietà, passaggi, formule, sintassi, varianti, esempi, errori comuni). " +
      "Nelle `relations` collega i sotto-concetti fra loro e, quando il materiale lo giustifica, a concetti già " +
      "nella mappa usando il loro titolo identico. " + FIELDS,
    `Concetto: ${concept.title}${concept.definition ? `\nDefinizione: ${concept.definition}` : ""}` +
      `\nPercorso nella mappa: ${[...path, concept.title].join(" › ")}` +
      (known.length ? `\nConcetti già nella mappa: ${known.join("; ")}` : "") +
      (present.length ? `\nGià in questo livello (proponi aspetti DIVERSI da questi): ${present.join("; ")}` : ""),
    found,
    concept.title
  );
}

/** Citazione di un singolo chunk (per aprire la fonte di una bolla: video al minuto, file). */
export function chunkCitation(chunkId: number): Citation | null {
  const row = sqlite
    .prepare(
      `SELECT c.id AS chunkId, c.document_id AS documentId, c.content, c.meta, d.source, d.kind AS docKind, d.meta AS docMeta
       FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ?`
    )
    .get(chunkId) as { chunkId: number; documentId: number; content: string; meta: string | null; source: string | null; docKind: string; docMeta: string | null } | undefined;
  if (!row) return null;
  const [cite] = toCitations([{
    ...row,
    distance: 0,
    meta: row.meta ? JSON.parse(row.meta) : undefined,
    docMeta: row.docMeta ? JSON.parse(row.docMeta) : undefined,
  }]);
  return { ...cite, snippet: row.content };
}
