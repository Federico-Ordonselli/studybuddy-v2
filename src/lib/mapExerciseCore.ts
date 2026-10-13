/**
 * Mappe «costruisci tu» (Fase 5), parte pura: documento-esercizio, confronto delle coppie,
 * sovrapposizione della soluzione e comandi di completamento. Gira anche nel browser: niente DB.
 * Usa il motore delle mappe solo tramite le sue esportazioni (comandi atomici, proposte).
 */
import { mapFromProposal, titleKey } from "@/lib/mappe/proposte.js";
import { applyMapCommands } from "@/lib/mappe/comandi.js";
import { createMapDocument, createPlacement, createRelation } from "@/lib/mappe/modello.js";

export interface SourceRefLike {
  documentId: string; documentRevision: string; chunkId: string;
  start?: number; end?: number; excerpt?: string;
}
export interface SolutionConcept {
  title: string; kind?: string; definition?: string; explanation?: string;
  examples?: string[]; sourceRefs?: SourceRefLike[]; verb?: string;
}
export interface SolutionRelation { from: string; to: string; label: string }
export interface Solution { concepts: SolutionConcept[]; relations: SolutionRelation[] }

export interface DocConcept { id: string; title: string; definition: string; explanation: string; examples: string[]; sourceRefs: SourceRefLike[] }
export interface DocRelation { id: string; sourceConceptId: string; targetConceptId: string; predicate: string; label: string; directed: boolean }
interface DocPlacement { id: string; spaceId: string; conceptId: string; x: number; y: number; width: number; height: number; childSpaceId?: string }
interface DocSpace { id: string; title: string; ownerConceptId?: string }
export interface ExerciseDoc {
  id: string; title: string; revision: number; rootSpaceId: string;
  concepts: DocConcept[]; spaces: DocSpace[]; placements: DocPlacement[]; relations: DocRelation[];
  [key: string]: unknown;
}
export interface ResolvedRelation { sourceId: string; targetId: string; label: string }
export type MapCommand = Record<string, unknown> & { type: string };

const BUBBLE = { width: 220, height: 110 };
const GAP = { x: 60, y: 70 };
const COLUMNS = 4;

/** La proposta che può vedere chi studia: definizione e fonti, niente spiegazioni, esempi né relazioni. */
export function stripProposal(p: Solution): Solution {
  return {
    concepts: p.concepts.map((c) => ({
      title: c.title, kind: c.kind, definition: c.definition ?? "",
      explanation: "", examples: [], sourceRefs: c.sourceRefs ?? [],
    })),
    relations: [],
  };
}

/** PRNG deterministico (mulberry32) dal seme: stesso seme, stessa disposizione (per i test). */
function random(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    const t = (h ^= h >>> 16) >>> 0;
    return t / 4294967296;
  };
}

/**
 * Documento dell'esercizio: i concetti della proposta con la sola definizione, nessun arco,
 * tutte le bolle della stessa misura in una griglia rimescolata. La disposizione radiale e la
 * bolla grande del centro tradirebbero quale concetto è l'hub.
 */
export function exerciseDocument(title: string, p: Solution, opts: { seed?: string; provenance?: Record<string, unknown> } = {}): ExerciseDoc {
  const base = mapFromProposal(title, stripProposal(p), opts.provenance ? { provenance: opts.provenance as { origin: string } } : {}) as ExerciseDoc;
  const placements = base.placements.filter((pl) => pl.spaceId === base.rootSpaceId);
  const next = random(opts.seed ?? title);
  const order = placements.map((pl) => ({ pl, k: next() })).sort((a, b) => a.k - b.k).map((x) => x.pl);
  const cols = Math.min(COLUMNS, order.length);
  const width = cols * BUBBLE.width + (cols - 1) * GAP.x;
  const commands = order.map((pl, i) => ({
    type: "updatePlacement", id: pl.id,
    changes: {
      x: (i % COLUMNS) * (BUBBLE.width + GAP.x) - width / 2,
      y: Math.floor(i / COLUMNS) * (BUBBLE.height + GAP.y),
      width: BUBBLE.width, height: BUBBLE.height,
    },
  }));
  return applyMapCommands(base, commands) as ExerciseDoc;
}

/** Chiave del livello di una tela: `root` per la tela iniziale, altrimenti il concetto proprietario. */
export function levelKeyOf(doc: ExerciseDoc, spaceId: string): string {
  const space = doc.spaces.find((s) => s.id === spaceId);
  if (!space) throw new Error("Tela inesistente");
  if (spaceId === doc.rootSpaceId) return "root";
  if (!space.ownerConceptId) throw new Error("Tela senza concetto proprietario");
  return space.ownerConceptId;
}

function visibleIds(doc: ExerciseDoc, spaceId: string): Set<string> {
  return new Set(doc.placements.filter((p) => p.spaceId === spaceId).map((p) => p.conceptId));
}

/** Concetti con una bolla nella tela. */
export function levelConcepts(doc: ExerciseDoc, spaceId: string): DocConcept[] {
  const ids = visibleIds(doc, spaceId);
  return doc.concepts.filter((c) => ids.has(c.id));
}

/** Le proposizioni dello studente nella tela: relazioni fra due concetti visibili, distinti. */
export function levelPropositions(doc: ExerciseDoc, spaceId: string): DocRelation[] {
  const ids = visibleIds(doc, spaceId);
  return doc.relations.filter((r) => r.sourceConceptId !== r.targetConceptId && ids.has(r.sourceConceptId) && ids.has(r.targetConceptId));
}

/** Coppia non ordinata: la direzione non conta nel confronto. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Relazioni della soluzione tradotte negli id dei concetti della tela; i titoli irrisolvibili si ignorano. */
export function resolveSolution(doc: ExerciseDoc, spaceId: string, solution: Solution): ResolvedRelation[] {
  const byTitle = new Map(levelConcepts(doc, spaceId).map((c) => [titleKey(c.title), c.id]));
  const out: ResolvedRelation[] = [];
  for (const r of solution.relations) {
    const sourceId = byTitle.get(titleKey(r.from)), targetId = byTitle.get(titleKey(r.to));
    if (sourceId && targetId && sourceId !== targetId) out.push({ sourceId, targetId, label: r.label });
  }
  return out;
}

/** Confronto in codice: coppie in comune, solo dello studente, mancanti (una per coppia). */
export function comparePairs(doc: ExerciseDoc, spaceId: string, solution: Solution) {
  const mine = new Set(levelPropositions(doc, spaceId).map((r) => pairKey(r.sourceConceptId, r.targetConceptId)));
  const theirs = new Map<string, ResolvedRelation>();
  for (const r of resolveSolution(doc, spaceId, solution)) {
    const k = pairKey(r.sourceId, r.targetId);
    if (!theirs.has(k)) theirs.set(k, r);
  }
  return {
    common: [...mine].filter((k) => theirs.has(k)),
    extra: [...mine].filter((k) => !theirs.has(k)),
    missing: [...theirs].filter(([k]) => !mine.has(k)).map(([, r]) => r),
  };
}

const predicate = (label: string) => label.trim().slice(0, 120) || "è collegato a";

/**
 * Vista «Mostra soluzione»: documento a livello singolo (mai salvato) con i concetti della tela,
 * le proposizioni dello studente e le coppie mancanti come archi non direzionali (la tela li
 * tratteggia). `mount()` parte sempre dalla tela radice, quindi un sotto-livello va «appiattito».
 */
export function overlayDocument(doc: ExerciseDoc, spaceId: string, solution: Solution): ExerciseDoc {
  const title = doc.spaces.find((s) => s.id === spaceId)?.title ?? doc.title;
  const view = createMapDocument(title) as ExerciseDoc;
  const commands: MapCommand[] = [];
  for (const pl of doc.placements.filter((x) => x.spaceId === spaceId)) {
    const concept = doc.concepts.find((c) => c.id === pl.conceptId);
    if (!concept) continue;
    commands.push({
      type: "addConcept", concept,
      placement: createPlacement(view.rootSpaceId, concept.id, { x: pl.x, y: pl.y, width: pl.width, height: pl.height }),
    });
  }
  for (const r of levelPropositions(doc, spaceId)) commands.push({ type: "addRelation", relation: r });
  for (const m of comparePairs(doc, spaceId, solution).missing) {
    commands.push({
      type: "addRelation",
      relation: createRelation(m.sourceId, m.targetId, predicate(m.label), { directed: false, provenance: { origin: "llm" } }),
    });
  }
  return applyMapCommands(view, commands) as ExerciseDoc;
}

/** «Completa la mappa»: archi mancanti e spiegazioni/esempi dei concetti della tela che li hanno vuoti. */
export function completionCommands(doc: ExerciseDoc, spaceId: string, solution: Solution): MapCommand[] {
  const commands: MapCommand[] = comparePairs(doc, spaceId, solution).missing.map((m) => ({
    type: "addRelation",
    relation: createRelation(m.sourceId, m.targetId, predicate(m.label), { provenance: { origin: "llm" } }),
  }));
  const full = new Map(solution.concepts.map((c) => [titleKey(c.title), c]));
  for (const c of levelConcepts(doc, spaceId)) {
    const s = full.get(titleKey(c.title));
    if (!s) continue;
    const changes: Record<string, unknown> = {};
    if (!c.explanation.trim() && s.explanation?.trim()) changes.explanation = s.explanation.trim().slice(0, 8000);
    if (!c.examples.length && s.examples?.length) changes.examples = s.examples.map((e) => e.trim().slice(0, 500)).filter(Boolean).slice(0, 8);
    if (Object.keys(changes).length) commands.push({ type: "updateConcept", id: c.id, changes });
  }
  return commands;
}
