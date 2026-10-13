/**
 * Mappe «costruisci tu» (Fase 5), parte server: la soluzione generata resta in `map_exercises`
 * (per livello, per titolo) e il documento riceve solo i concetti. Nessuna funzione restituisce
 * la soluzione prima di `revealLevel`/`completeLevel`.
 */
import { sqlite } from "@/lib/db";
import { expandConcept, proposeMap, provenance, type BuildResult } from "@/lib/conceptmap";
import { getMap, saveMap, type MapDocument } from "@/lib/mappe/store";
import type { Retrieved } from "@/lib/rag/store";
import { titleKey } from "@/lib/mappe/proposte.js";
import { exerciseDocument, levelKeyOf, stripProposal, type ExerciseDoc, type Solution, type SolutionRelation } from "@/lib/mapExerciseCore";

export const PROMPT_VERSION = "maps-v1";
export const MAX_PROPOSITIONS = 15;

export class ExerciseError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type Verdict = "valid" | "imprecise" | "wrong";
export interface PropositionVerdict { relationId: string; sourceId: string; targetId: string; label: string; verdict: Verdict | "unrated"; reason: string; fix: string; inSolution: boolean }
export interface CheckResult { verdicts: PropositionVerdict[]; missing: { a: string; b: string }[]; checkedAt: number }
export interface LevelInfo { levelKey: string; focusQuestion: string; lastCheck: CheckResult | null; checkedAt: number | null; revealedAt: number | null; completedAt: number | null }

interface Row { map_id: string; level_key: string; focus_question: string; proposal: string; last_check: string | null; created_at: number; checked_at: number | null; revealed_at: number | null; completed_at: number | null }

const now = () => Math.floor(Date.now() / 1000);
const getRow = (mapId: string, levelKey: string) =>
  sqlite.prepare("SELECT * FROM map_exercises WHERE map_id = ? AND level_key = ?").get(mapId, levelKey) as Row | undefined;
const toSolution = (p: BuildResult): Solution => ({ concepts: p.concepts, relations: p.relations });

/** Esercizio nuovo: genera in modalità build, salva mappa spogliata e soluzione `root` insieme. */
export async function createExercise(domainId: number, topic: string, sourceChunks?: Retrieved[]): Promise<{ map: MapDocument }> {
  const p = await proposeMap(domainId, topic, sourceChunks, { build: true });
  const doc = exerciseDocument(topic, p, { seed: `${topic}|${Date.now()}`, provenance: provenance() });
  const map = sqlite.transaction(() => {
    const saved = saveMap(domainId, doc, 0);
    sqlite.prepare("INSERT INTO map_exercises (map_id, level_key, focus_question, proposal, created_at) VALUES (?, 'root', ?, ?, ?)")
      .run(saved.id, p.focusQuestion ?? "", JSON.stringify(toSolution(p)), now());
    return saved;
  })();
  return { map };
}

/** Fonde due soluzioni: concetti deduplicati per titolo, relazioni accodate senza duplicati. */
function merge(a: Solution, b: Solution): Solution {
  const seen = new Set(a.concepts.map((c) => titleKey(c.title)));
  const rel = (r: SolutionRelation) => `${titleKey(r.from)}|${titleKey(r.to)}|${r.label.trim().toLowerCase()}`;
  const rels = new Set(a.relations.map(rel));
  return {
    concepts: [...a.concepts, ...b.concepts.filter((c) => !seen.has(titleKey(c.title)) && seen.add(titleKey(c.title)))],
    relations: [...a.relations, ...b.relations.filter((r) => !rels.has(rel(r)) && rels.add(rel(r)))],
  };
}

/**
 * Sottolivello di una mappa-esercizio: genera in modalità build, salva (o fonde) la soluzione del
 * livello e restituisce al browser solo i concetti con la definizione, senza relazioni.
 */
export async function expandExercise(
  mapId: string, domainId: number, conceptId: string,
  req: { concept: { title: string; definition?: string }; path: string[]; existing: string[]; present: string[] },
  sourceChunks?: Retrieved[],
): Promise<Solution> {
  const found = getMap(mapId);
  if (!found) throw new ExerciseError("mappa inesistente", 404);
  if (found.domainId !== domainId) throw new ExerciseError("la mappa appartiene a un altro dominio", 409);
  if (!getRow(mapId, "root")) throw new ExerciseError("la mappa non è un esercizio", 409);
  if (!(found.doc as unknown as ExerciseDoc).concepts.some((c) => c.id === conceptId)) throw new ExerciseError("concetto inesistente", 404);
  const p = await expandConcept(domainId, req.concept, req.path, req.existing, req.present, { build: true, sourceChunks });
  const solution = toSolution(p);
  sqlite.transaction(() => {
    const row = getRow(mapId, conceptId);
    if (row) {
      sqlite.prepare("UPDATE map_exercises SET proposal = ? WHERE map_id = ? AND level_key = ?")
        .run(JSON.stringify(merge(JSON.parse(row.proposal), solution)), mapId, conceptId);
    } else {
      sqlite.prepare("INSERT INTO map_exercises (map_id, level_key, focus_question, proposal, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(mapId, conceptId, p.focusQuestion ?? "", JSON.stringify(solution), now());
    }
  }).immediate();
  return stripProposal(solution);
}

/** Stato dei livelli dell'esercizio, senza soluzione. Vuoto = mappa normale. */
export function exerciseLevels(mapId: string): LevelInfo[] {
  const rows = sqlite.prepare("SELECT * FROM map_exercises WHERE map_id = ? ORDER BY created_at, level_key").all(mapId) as Row[];
  return rows.map((r) => ({
    levelKey: r.level_key, focusQuestion: r.focus_question,
    lastCheck: r.last_check ? JSON.parse(r.last_check) as CheckResult : null,
    checkedAt: r.checked_at, revealedAt: r.revealed_at, completedAt: r.completed_at,
  }));
}

/** Mappa salvata + livello della tela + riga dell'esercizio, o ExerciseError 404. */
export function loadLevel(mapId: string, spaceId: string) {
  const found = getMap(mapId);
  if (!found) throw new ExerciseError("mappa inesistente", 404);
  const doc = found.doc as unknown as ExerciseDoc;
  let levelKey: string;
  try { levelKey = levelKeyOf(doc, spaceId); } catch { throw new ExerciseError("tela inesistente", 404); }
  const row = getRow(mapId, levelKey);
  if (!row) throw new ExerciseError("nessun esercizio su questo livello", 404);
  return { domainId: found.domainId, doc, levelKey, row, solution: JSON.parse(row.proposal) as Solution };
}

/** «Mostra soluzione»: le relazioni della soluzione per titolo. */
export function revealLevel(mapId: string, spaceId: string): { relations: SolutionRelation[] } {
  const { levelKey, row, solution } = loadLevel(mapId, spaceId);
  if (!row.revealed_at) sqlite.prepare("UPDATE map_exercises SET revealed_at = ? WHERE map_id = ? AND level_key = ?").run(now(), mapId, levelKey);
  return { relations: solution.relations };
}

/** «Completa la mappa»: la soluzione intera (relazioni e concetti con spiegazioni). */
export function completeLevel(mapId: string, spaceId: string): Solution {
  const { levelKey, solution } = loadLevel(mapId, spaceId);
  const t = now();
  sqlite.prepare("UPDATE map_exercises SET revealed_at = COALESCE(revealed_at, ?), completed_at = ? WHERE map_id = ? AND level_key = ?").run(t, t, mapId, levelKey);
  return solution;
}
