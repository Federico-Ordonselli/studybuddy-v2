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
import { comparePairs, exerciseDocument, levelConcepts, levelKeyOf, levelPropositions, pairKey, resolveSolution, stripProposal, type ExerciseDoc, type Solution, type SolutionRelation } from "@/lib/mapExerciseCore";
import { generate } from "@/lib/providers";
import { checkCard } from "@/lib/tutor/cardQuality";
import type { CardDraft } from "@/lib/tutor/cardGen";

export const PROMPT_VERSION = "maps-v3";
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
const toSolution = (p: BuildResult): Solution => ({
  concepts: p.concepts, relations: p.relations, ...(p.sourceChunkIds?.length ? { chunkIds: p.sourceChunkIds } : {}),
});

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

/** Fonde due soluzioni: concetti deduplicati per titolo, relazioni e chunk accodati senza duplicati. */
function merge(a: Solution, b: Solution): Solution {
  const seen = new Set(a.concepts.map((c) => titleKey(c.title)));
  const rel = (r: SolutionRelation) => `${titleKey(r.from)}|${titleKey(r.to)}|${r.label.trim().toLowerCase()}`;
  const rels = new Set(a.relations.map(rel));
  const chunkIds = [...new Set([...(a.chunkIds ?? []), ...(b.chunkIds ?? [])])];
  return {
    concepts: [...a.concepts, ...b.concepts.filter((c) => !seen.has(titleKey(c.title)) && seen.add(titleKey(c.title)))],
    relations: [...a.relations, ...b.relations.filter((r) => !rels.has(rel(r)) && rels.add(rel(r)))],
    ...(chunkIds.length ? { chunkIds } : {}),
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

const VERDICTS = ["valid", "imprecise", "wrong"] as const;
const PASSAGE_CHARS = 1500;
const PASSAGES_TOTAL = 10000;

/** `reference` = «A verbo B» della soluzione per la stessa coppia; `referenceLabel` = il suo solo verbo. */
export interface JudgeProposition { id: string; from: string; label: string; to: string; reference?: string; referenceLabel?: string }
export interface Judgement { id: string; reason: string; verdict: Verdict; fix: string }

/** Ordine delle proprietà = ordine di generazione: il motivo prima del verdetto. */
const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          reason: { type: "string" },
          verdict: { type: "string", enum: VERDICTS },
          fix: { type: "string" },
        },
        required: ["id", "reason", "verdict", "fix"],
      },
    },
  },
  required: ["items"],
} as const;

const JUDGE_SYSTEM = [
  "Valuti le proposizioni di una mappa concettuale costruita da uno studente. Ogni proposizione è «concetto A — verbo → concetto B».",
  "Giudica se il MATERIALE fornito sostiene il legame che la proposizione afferma, non se coincide con una mappa di riferimento.",
  "I concetti sono quelli elencati con la loro definizione: un concetto della mappa esiste anche se il suo titolo non compare alla lettera nel materiale. Se un titolo unisce più idee (es. «Accessibilità e Responsive Design»), basta che il legame valga per la parte pertinente.",
  "Per ogni proposizione, in quest'ordine:",
  "1. reason: una o due frasi in italiano: cosa dice il materiale sul legame fra A e B.",
  "2. verdict:",
  "- valid: il materiale sostiene ciò che la proposizione afferma, anche con altre parole, in forma parziale o semplificata, o fuori dalla formulazione di riferimento. Non esiste una sola mappa giusta e non si chiede più precisione di quella che la proposizione dichiara.",
  "- imprecise: A e B sono legati nel materiale (anche indirettamente), ma la proposizione lo dice male: verbo generico che non dice quale rapporto c'è (es. «è collegato a», «riguarda», «ha a che fare con»), tipo di rapporto sbagliato, oppure direzione invertita (B → A invece di A → B). Questi casi sono imprecise, MAI wrong.",
  "- wrong: la proposizione afferma qualcosa che il materiale contraddice, oppure lega due concetti che il materiale non mette in nessun rapporto.",
  "3. fix: per imprecise e wrong, una frase in italiano che enuncia la relazione corretta fra A e B secondo il materiale; vuoto per valid.",
  "La «formulazione di riferimento», quando c'è, è UNA formulazione possibile, non l'unica, ricavata dallo stesso materiale: dice che A e B sono legati. Una proposizione che dice la stessa cosa del riferimento, anche con altre parole, è valid salvo che il materiale la contraddica; non bocciare formulazioni diverse ma corrette.",
  "Valuta tutte le proposizioni, con lo stesso id.",
].join("\n");

/**
 * Verbo che non dice quale rapporto c'è («è collegato a», «riguarda»): per definizione la proposizione è
 * `imprecise` se la coppia è legata. Lo decide il codice, non il modello, che su questi verbi oscilla.
 */
const GENERIC_VERB = /^(?:(?:è|sono)\s+)?(?:(?:collegat|legat|conness|associat|relativ)[oaie]\s+(?:a|con|ad)|riguard(?:a|ano)|(?:ha|hanno) a che fare con|si (?:collega|collegano|riferisce|riferiscono) a|is (?:related|connected|linked) to|relates? to|concerns?|involves?)$/i;
export const isGenericVerb = (label: string) => GENERIC_VERB.test(label.trim().replace(/\s+/g, " "));
const GENERIC_FIX = "Usa un verbo che dica che rapporto c'è fra i due concetti.";

/**
 * Coppia nella soluzione → imprecise; fuori soluzione un `valid` scende a imprecise, un `wrong` resta.
 * Se anche il riferimento ha un verbo generico non serve come correzione: si usa il consiglio generale.
 */
function capGeneric(j: Judgement, p: JudgeProposition): Judgement {
  if (!isGenericVerb(p.label)) return j;
  if (p.reference) {
    const fallback = p.referenceLabel && isGenericVerb(p.referenceLabel) ? GENERIC_FIX : p.reference;
    return { ...j, verdict: "imprecise", fix: j.verdict === "imprecise" && j.fix ? j.fix : fallback };
  }
  if (j.verdict === "valid") return { ...j, verdict: "imprecise", fix: GENERIC_FIX };
  return j;
}

const block = (label: string, text: string) => `${label}:\n"""\n${text}\n"""`;

/** Giudizi ben formati per gli id attesi; null se il JSON non è valido o manca `items`. */
export function parseJudgements(raw: string, ids: string[]): Judgement[] | null {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  const items = (data as { items?: unknown })?.items;
  if (!Array.isArray(items)) return null;
  const wanted = new Set(ids), out: Judgement[] = [];
  for (const it of items as Record<string, unknown>[]) {
    if (!it || typeof it.id !== "string" || !wanted.has(it.id)) continue;
    if (!(VERDICTS as readonly unknown[]).includes(it.verdict) || typeof it.reason !== "string") continue;
    const verdict = it.verdict as Verdict;
    out.push({ id: it.id, reason: it.reason.trim(), verdict, fix: verdict === "valid" ? "" : String(it.fix ?? "").trim() });
    wanted.delete(it.id);
  }
  return out;
}

/**
 * Una chiamata per tutte le proposizioni (massimo 15). Un retry su JSON invalido, poi errore:
 * nessun verdetto inventato. Le proposizioni senza voce restano «non valutate» per il chiamante.
 */
export async function judgePropositions(input: {
  focusQuestion: string; propositions: JudgeProposition[]; passages: string[]; concepts?: { title: string; definition: string }[];
}): Promise<Judgement[]> {
  const { focusQuestion, propositions, passages, concepts = [] } = input;
  if (!propositions.length) return [];
  if (propositions.length > MAX_PROPOSITIONS) throw new ExerciseError(`massimo ${MAX_PROPOSITIONS} proposizioni per verifica`);
  const content = [
    `Domanda focale della mappa: ${focusQuestion}`,
    ...(concepts.length ? ["Concetti della mappa:\n" + concepts.map((c) => `- «${c.title}»: ${c.definition || "(senza definizione)"}`).join("\n")] : []),
    block("Materiale", passages.length ? passages.map((p, i) => `[${i + 1}] ${p}`).join("\n\n") : "(nessun passaggio disponibile)"),
    "Proposizioni dello studente:\n" + propositions.map((p) =>
      `${p.id}: «${p.from}» — ${p.label} → «${p.to}»` +
      (p.reference ? `\n   formulazione di riferimento (una possibile, non l'unica): ${p.reference}` : "")).join("\n"),
    "Valuta ogni proposizione (JSON).",
  ].join("\n\n");
  const ids = propositions.map((p) => p.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generate("grade", {
      system: JUDGE_SYSTEM, json: true, schema: JUDGE_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0, messages: [{ role: "user", content }],
    });
    const parsed = parseJudgements(raw, ids);
    if (parsed) return parsed.map((j) => capGeneric(j, propositions.find((p) => p.id === j.id)!));
  }
  throw new Error("Il modello non ha prodotto una valutazione valida delle proposizioni. Riprova.");
}

/**
 * Tetto del materiale per il valutatore: ogni passaggio ≤ 1500 caratteri, ≤ 10 000 in tutto. Un
 * passaggio che sforerebbe il totale si salta, ma i successivi più corti possono ancora entrare.
 * Lo usano sia la verifica sia l'eval, così il contesto è lo stesso.
 */
export function capPassages(texts: string[]): string[] {
  const out: string[] = [];
  let total = 0;
  for (const t of texts) {
    const text = t.slice(0, PASSAGE_CHARS);
    if (total + text.length > PASSAGES_TOTAL) continue;
    out.push(text); total += text.length;
  }
  return out;
}

/**
 * Materiale del livello per il valutatore: i chunk usati per generarlo (`solution.chunkIds`, come
 * nell'eval); per le soluzioni salvate prima, i `sourceRefs` dei concetti della tela (per titolo).
 * Deduplicati e passati da `capPassages`.
 */
export function levelPassages(solution: Solution, titles: string[]): string[] {
  const ids: number[] = [];
  const push = (n: number) => { if (Number.isSafeInteger(n) && !ids.includes(n)) ids.push(n); };
  if (solution.chunkIds?.length) solution.chunkIds.forEach(push);
  else {
    const keys = new Set(titles.map(titleKey));
    for (const c of solution.concepts) {
      if (!keys.has(titleKey(c.title))) continue;
      for (const r of c.sourceRefs ?? []) push(Number(r.chunkId));
    }
  }
  const get = sqlite.prepare("SELECT content FROM chunks WHERE id = ?");
  const texts = ids.map((id) => (get.get(id) as { content: string } | undefined)?.content).filter((t): t is string => t !== undefined);
  return capPassages(texts);
}

/** Verifica del livello: confronto delle coppie in codice + una chiamata LLM; l'esito resta in `last_check`. */
export async function evaluateLevel(mapId: string, spaceId: string): Promise<CheckResult> {
  const { doc, levelKey, row, solution } = loadLevel(mapId, spaceId);
  const props = levelPropositions(doc, spaceId);
  if (!props.length) throw new ExerciseError("nessuna proposizione da verificare: aggiungine almeno una");
  if (props.length > MAX_PROPOSITIONS) throw new ExerciseError(`massimo ${MAX_PROPOSITIONS} proposizioni per verifica: togline qualcuna`);
  const title = new Map(doc.concepts.map((c) => [c.id, c.title]));
  const reference = new Map<string, { text: string; label: string }>();
  for (const r of resolveSolution(doc, spaceId, solution)) {
    const k = pairKey(r.sourceId, r.targetId);
    if (!reference.has(k)) reference.set(k, { text: `${title.get(r.sourceId)} ${r.label} ${title.get(r.targetId)}`, label: r.label });
  }
  const propositions: JudgeProposition[] = props.map((r, i) => {
    const ref = reference.get(pairKey(r.sourceConceptId, r.targetConceptId));
    return {
      id: `P${i + 1}`, from: title.get(r.sourceConceptId) ?? "", label: r.label || r.predicate, to: title.get(r.targetConceptId) ?? "",
      reference: ref?.text, referenceLabel: ref?.label,
    };
  });
  const passages = levelPassages(solution, levelConcepts(doc, spaceId).map((c) => c.title));
  const judged = new Map((await judgePropositions({ focusQuestion: row.focus_question, propositions, passages, concepts: levelConcepts(doc, spaceId).map(({ title, definition }) => ({ title, definition })) })).map((j) => [j.id, j]));
  const result: CheckResult = {
    verdicts: props.map((r, i) => {
      const j = judged.get(`P${i + 1}`);
      return {
        relationId: r.id, sourceId: r.sourceConceptId, targetId: r.targetConceptId, label: r.label || r.predicate,
        verdict: j?.verdict ?? "unrated", reason: j?.reason ?? "", fix: j?.fix ?? "",
        inSolution: reference.has(pairKey(r.sourceConceptId, r.targetConceptId)),
      };
    }),
    missing: comparePairs(doc, spaceId, solution).missing.map((m) => ({ a: title.get(m.sourceId) ?? "", b: title.get(m.targetId) ?? "" })),
    checkedAt: Math.floor(Date.now() / 1000),
  };
  sqlite.prepare("UPDATE map_exercises SET last_check = ?, checked_at = ? WHERE map_id = ? AND level_key = ?")
    .run(JSON.stringify(result), result.checkedAt, mapId, levelKey);
  return result;
}

/**
 * Bozza di carta da una proposizione sbagliata la cui coppia è nella soluzione: «Che relazione c'è
 * tra X e Y?», risposta dalla soluzione. Fuori soluzione non c'è una risposta di riferimento (la
 * correzione del modello non è verificata): 409. Passa da checkCard.
 */
export function relationCardDraft(mapId: string, spaceId: string, relationId: string): CardDraft {
  const { doc, solution } = loadLevel(mapId, spaceId);
  const rel = doc.relations.find((r) => r.id === relationId);
  if (!rel) throw new ExerciseError("relazione inesistente", 404);
  const title = new Map(doc.concepts.map((c) => [c.id, c.title]));
  const a = title.get(rel.sourceConceptId) ?? "", b = title.get(rel.targetConceptId) ?? "";
  const k = pairKey(rel.sourceConceptId, rel.targetConceptId);
  const ref = resolveSolution(doc, spaceId, solution).find((r) => pairKey(r.sourceId, r.targetId) === k);
  if (!ref) throw new ExerciseError("questa coppia non è nella soluzione: nessuna carta da creare", 409);
  const answer = `${title.get(ref.sourceId)} ${ref.label} ${title.get(ref.targetId)}`;
  const keys = new Set([titleKey(a), titleKey(b)]);
  const chunk = solution.concepts.filter((c) => keys.has(titleKey(c.title))).flatMap((c) => c.sourceRefs ?? [])
    .map((r) => Number(r.chunkId)).find((n) => Number.isSafeInteger(n));
  const question = `Che relazione c'è tra «${a}» e «${b}»?`;
  return { question, answer, type: "qa", fact: answer, sourceChunkId: chunk ?? null, issues: checkCard({ question, answer }) };
}
