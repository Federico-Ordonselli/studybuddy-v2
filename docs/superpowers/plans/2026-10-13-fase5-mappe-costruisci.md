# Fase 5 — Mappe «costruisci tu»: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** modalità esercizio delle mappe concettuali: lo studente vede concetti e domanda focale, traccia le relazioni da un pannello, un valutatore (codice + una chiamata LLM) le giudica, poi «Mostra soluzione» e «Completa la mappa».

**Architecture:** la soluzione generata (stessa `propose()` di oggi, in modalità build) resta sul server nella tabella `map_exercises`, una riga per livello e per titolo. Il documento della mappa riceve solo i concetti con la definizione. La logica pura (documento-esercizio, confronto coppie, sovrapposizione, completamento) sta in `src/lib/mapExerciseCore.ts`; DB e LLM in `src/lib/mapExercise.ts`; le API sono thin wrapper; la UI è un pannello React (`MapExercise.tsx`) accanto all'editor esistente. Il motore PolyForm non si tocca.

**Tech Stack:** Next 16, React 19, TypeScript 7, better-sqlite3, drizzle (solo schema), Ollama `gemma4:12b` via `generate()`, `node:test` via tsx.

**Spec:** `docs/superpowers/specs/2026-10-13-fase5-mappe-costruisci-design.md`

## Global Constraints

- Lingua di codice, commenti, messaggi e commit: **italiano** (identificatori come nel resto del codice: inglese per le funzioni TS nuove, come `cards.ts`/`grade.ts`).
- Commit con `git add` di **file espliciti**, mai `-A` o `.`; messaggio che finisce con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Mai toccare il DB reale** (`data/studybuddy.db`): test con `tests/helpers/db.ts`; `npm run build` solo con `DB_PATH=<file temporaneo>`; eval con `DB_PATH=<file temporaneo>` davanti al comando (Node `--env-file` non sovrascrive variabili già impostate).
- **Mai modificare** `src/components/mappe/*.js` né `src/lib/mappe/*.js` (motore PolyForm). Si usano solo le loro esportazioni.
- Ogni chiamata LLM passa da `generate(task, opts)` di `@/lib/providers`.
- Colori: solo token esistenti (`var(--success-soft)`, `var(--on-success-soft)`, `var(--warning-soft)`, `var(--on-warning-soft)`, `var(--danger-soft)`, `var(--on-danger-soft)`, `var(--panel)`, `var(--panel-2)`, `var(--border)`, `var(--muted)`, `var(--text)`, `var(--accent-2)`, `var(--button-ink)`, `var(--color-danger)`); niente hex, `rgb()` o colori Tailwind di default. Stati sempre con testo o icona.
- Le route API: `export const runtime = "nodejs"`, errori `{ error }`.
- `PROMPT_VERSION = "maps-v1"`, massimo **15** proposizioni per verifica, passaggi ≤ **1500** caratteri l'uno e ≤ **10 000** in tutto.
- Il prompt della modalità normale delle mappe (`generateMap`/`expandConcept` senza `build`) deve restare **identico byte per byte**.

## Review Focus

1. **Bolla rinominata durante l'esercizio** → le sue coppie della soluzione non si risolvono: devono essere ignorate (niente crash, niente coppie mancanti fantasma). Test in Task 2 (`comparePairs` con titolo irrisolvibile).
2. **Verifica senza salvataggio** → il server valuta il documento salvato: il pannello salva prima (`await editor.save()` se `dirty`). Coperto in Task 7; test server in Task 5 (proposizioni lette dal documento salvato).
3. **Soluzione che trapela** → nessuna API restituisce `proposal` prima di `revealLevel`/`completeLevel`; `expandExercise` restituisce `relations: []` e concetti senza spiegazione. Test in Task 4.
4. **Livello senza esercizio** (bolla approfondita prima di convertire, o tela creata a mano) → `evaluateLevel` risponde 404 con messaggio chiaro, il pannello mostra «Nessun esercizio su questo livello». Test in Task 5.
5. **Risposta LLM parziale** (manca una proposizione, id inventati, verdetti fuori enum) → voci mancanti `unrated`, id sconosciuti scartati, `fix` svuotato sui `valid`; JSON invalido due volte → errore. Test in Task 5.

---

### Task 1: Tabella `map_exercises` e store delle mappe

**Files:**
- Modify: `src/lib/db/schema.ts` (dopo `conceptMaps`, ~riga 155)
- Modify: `src/lib/db/schemaSql.ts` (rigenerato con `npm run db:schema`, non a mano)
- Modify: `src/lib/db/index.ts:115-123` (`ensureHubSchema`)
- Modify: `src/lib/mappe/store.ts` — **eccezione consapevole**: è un file TS dell'app (non del motore PolyForm), già in `lib/mappe/` per storia; si toccano solo `listMaps` e `deleteMap`.
- Test: `tests/hubSchemaMapExercises.test.ts`, `tests/mapStore.test.ts`

**Interfaces:**
- Produces: tabella `map_exercises(map_id text NOT NULL, level_key text NOT NULL, focus_question text NOT NULL, proposal text NOT NULL, last_check text, created_at integer NOT NULL, checked_at integer, revealed_at integer, completed_at integer, PRIMARY KEY(map_id, level_key))`; `MapSummary` con `exercise: boolean`; `deleteMap(id)` che cancella anche le righe `map_exercises`.

- [ ] **Step 1: test che falliscono**

`tests/hubSchemaMapExercises.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "@/lib/db/schemaSql";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-f5-"));
const file = path.join(dir, "pre-f5.db");

// DB «di ieri»: tutto lo schema tranne map_exercises.
const old = new Database(file);
for (const s of SCHEMA_SQL.filter((s) => !s.includes("`map_exercises`"))) old.exec(s);
old.close();
process.env.DB_PATH = file;

test("DB esistente: map_exercises creata all'avvio, chiave (map_id, level_key), idempotente", async () => {
  const { sqlite, ensureHubSchema } = await import("@/lib/db");
  const cols = (sqlite.prepare("PRAGMA table_info(map_exercises)").all() as { name: string }[]).map((c) => c.name);
  assert.deepEqual(cols, ["map_id", "level_key", "focus_question", "proposal", "last_check", "created_at", "checked_at", "revealed_at", "completed_at"]);
  const ins = sqlite.prepare("INSERT INTO map_exercises (map_id, level_key, focus_question, proposal, created_at) VALUES ('m', 'root', 'D?', '{}', 1)");
  ins.run();
  assert.throws(() => ins.run(), /UNIQUE|PRIMARY KEY/);
  ensureHubSchema();
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'map_exercises'").get() as { n: number }).n, 1);
});
```

`tests/mapStore.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

const { sqlite } = await useTempDb();
const { saveMap, listMaps, deleteMap } = await import("@/lib/mappe/store");
const { createMapDocument } = await import("@/lib/mappe/modello.js");

sqlite.prepare("INSERT INTO domains (id, name) VALUES (1, 'Corso')").run();

test("listMaps segnala le mappe-esercizio, deleteMap cancella anche le righe dell'esercizio", () => {
  const a = saveMap(1, createMapDocument("Normale"), 0);
  const b = saveMap(1, createMapDocument("Esercizio"), 0);
  sqlite.prepare("INSERT INTO map_exercises (map_id, level_key, focus_question, proposal, created_at) VALUES (?, 'root', 'D?', '{}', 1)").run(b.id);
  const byId = new Map(listMaps(1).map((m) => [m.id, m.exercise]));
  assert.equal(byId.get(a.id), false);
  assert.equal(byId.get(b.id), true);
  deleteMap(b.id);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM map_exercises WHERE map_id = ?").get(b.id) as { n: number }).n, 0);
  assert.deepEqual(listMaps(1).map((m) => m.id), [a.id]);
});
```

Se la tabella `domains` richiede altre colonne NOT NULL, guarda `schema.ts` (`domains`) e aggiungile all'INSERT.

- [ ] **Step 2: verifica che falliscano**

Run: `npx tsx --test tests/hubSchemaMapExercises.test.ts tests/mapStore.test.ts`
Expected: FAIL (`map_exercises` assente / `exercise` undefined).

- [ ] **Step 3: schema Drizzle**

In `src/lib/db/schema.ts`, subito dopo `conceptMaps`:

```ts
/**
 * Esercizi «costruisci tu» sulle mappe (Fase 5): una riga per livello (`root` o l'id del concetto
 * proprietario della tela). `proposal` è la soluzione generata, per titolo: non va mai al browser
 * prima di «Mostra soluzione». `last_check` = esito dell'ultima verifica. Date in secondi.
 */
export const mapExercises = sqliteTable("map_exercises", {
  mapId: text("map_id").notNull(),
  levelKey: text("level_key").notNull(),
  focusQuestion: text("focus_question").notNull(),
  proposal: text("proposal").notNull(),
  lastCheck: text("last_check"),
  createdAt: integer("created_at").notNull(),
  checkedAt: integer("checked_at"),
  revealedAt: integer("revealed_at"),
  completedAt: integer("completed_at"),
}, (t) => [primaryKey({ columns: [t.mapId, t.levelKey] })]);
```

Poi `npm run db:schema` e controlla con `git diff src/lib/db/schemaSql.ts` che compaia un solo `CREATE TABLE \`map_exercises\`` con `PRIMARY KEY(\`map_id\`, \`level_key\`)` dentro lo statement.

- [ ] **Step 4: `ensureHubSchema`**

In `src/lib/db/index.ts`, dentro `ensureHubSchema()` dopo `ensureTable("review_logs");` aggiungi `ensureTable("map_exercises");` e nel commento JSDoc sopra la funzione aggiungi `map_exercises` all'elenco delle tabelle create.

- [ ] **Step 5: store**

In `src/lib/mappe/store.ts`:

```ts
export interface MapSummary { id: string; title: string; revision: number; updatedAt: number; exercise: boolean }

export function listMaps(domainId: number): MapSummary[] {
  ensureTable();
  const rows = sqlite
    .prepare(`SELECT id, title, revision, updated_at AS updatedAt,
        EXISTS (SELECT 1 FROM map_exercises e WHERE e.map_id = concept_maps.id) AS exercise
      FROM concept_maps WHERE domain_id = ? ORDER BY updated_at DESC`)
    .all(domainId) as (Omit<MapSummary, "exercise"> & { exercise: number })[];
  return rows.map((r) => ({ ...r, exercise: r.exercise === 1 }));
}

/** Elimina la mappa e le righe del suo esercizio, insieme. */
export function deleteMap(id: string) {
  ensureTable();
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM map_exercises WHERE map_id = ?").run(id);
    sqlite.prepare("DELETE FROM concept_maps WHERE id = ?").run(id);
  })();
}
```

In `src/components/mappe/MapStudio.tsx` l'interfaccia locale `MapSummary` riceve `exercise?: boolean` (solo il tipo, l'uso arriva in Task 7).

- [ ] **Step 6: test verdi e suite**

Run: `npx tsx --test tests/hubSchemaMapExercises.test.ts tests/mapStore.test.ts tests/schemaSql.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: commit**

```bash
git add src/lib/db/schema.ts src/lib/db/schemaSql.ts src/lib/db/index.ts src/lib/mappe/store.ts src/components/mappe/MapStudio.tsx tests/hubSchemaMapExercises.test.ts tests/mapStore.test.ts
git commit -m "Tabella map_exercises: soluzioni degli esercizi sulle mappe per livello

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Nucleo puro `mapExerciseCore.ts`

**Files:**
- Create: `src/lib/mapExerciseCore.ts`
- Test: `tests/mapExerciseCore.test.ts`

**Interfaces:**
- Consumes: `mapFromProposal`, `titleKey` da `@/lib/mappe/proposte.js`; `applyMapCommands` da `@/lib/mappe/comandi.js`; `createRelation` da `@/lib/mappe/modello.js`.
- Produces (tutte esportate):
  - tipi `SourceRefLike`, `SolutionConcept`, `SolutionRelation`, `Solution`, `ExerciseDoc`, `DocConcept`, `DocRelation`, `ResolvedRelation = { sourceId: string; targetId: string; label: string }`, `MapCommand = Record<string, unknown> & { type: string }`
  - `stripProposal(p: Solution): Solution`
  - `exerciseDocument(title: string, p: Solution, opts?: { seed?: string; provenance?: Record<string, unknown> }): ExerciseDoc`
  - `levelKeyOf(doc: ExerciseDoc, spaceId: string): string` (lancia `Error("Tela inesistente")` / `Error("Tela senza concetto proprietario")`)
  - `levelConcepts(doc, spaceId): DocConcept[]`
  - `levelPropositions(doc, spaceId): DocRelation[]`
  - `pairKey(a: string, b: string): string`
  - `resolveSolution(doc, spaceId, solution): ResolvedRelation[]`
  - `comparePairs(doc, spaceId, solution): { common: string[]; extra: string[]; missing: ResolvedRelation[] }`
  - `overlayDocument(doc, spaceId, solution): ExerciseDoc`
  - `completionCommands(doc, spaceId, solution): MapCommand[]`

Il file non importa nulla che tocchi il DB (gira nel browser).

- [ ] **Step 1: test che falliscono**

`tests/mapExerciseCore.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMapDocument } from "@/lib/mappe/formato-mappa.js";
import { applyMapCommands } from "@/lib/mappe/comandi.js";
import { createRelation } from "@/lib/mappe/modello.js";
import {
  comparePairs, completionCommands, exerciseDocument, levelConcepts, levelKeyOf, levelPropositions,
  overlayDocument, pairKey, resolveSolution, stripProposal, type ExerciseDoc, type Solution,
} from "@/lib/mapExerciseCore";

const ref = (chunkId: string) => ({ documentId: "1", documentRevision: "h", chunkId });
const SOLUTION: Solution = {
  concepts: [
    { title: "Rendering", definition: "Disegno dell'interfaccia.", explanation: "React disegna.", examples: ["<App/>"], sourceRefs: [ref("10")] },
    { title: "State", definition: "Dati che cambiano.", explanation: "Lo state vive nel componente.", examples: ["useState"], sourceRefs: [ref("11")] },
    { title: "Props", definition: "Dati dal genitore.", explanation: "Le props scendono.", examples: [], sourceRefs: [ref("12")] },
    { title: "Virtual DOM", definition: "Copia in memoria.", explanation: "Confronto prima di aggiornare.", examples: [], sourceRefs: [] },
  ],
  relations: [
    { from: "State", to: "Rendering", label: "provoca" },
    { from: "Rendering", to: "Props", label: "riceve" },
    { from: "Rendering", to: "Virtual DOM", label: "usa" },
  ],
};

const idOf = (doc: ExerciseDoc, title: string) => doc.concepts.find((c) => c.title === title)!.id;
const withRelations = (doc: ExerciseDoc, rels: [string, string, string][]) =>
  applyMapCommands(doc, rels.map(([a, label, b]) => ({ type: "addRelation", relation: createRelation(idOf(doc, a), idOf(doc, b), label) }))) as ExerciseDoc;

test("stripProposal: solo definizione e fonti, niente spiegazioni, esempi né relazioni", () => {
  const s = stripProposal(SOLUTION);
  assert.equal(s.relations.length, 0);
  assert.deepEqual(s.concepts.map((c) => [c.title, c.definition, c.explanation, c.examples]), SOLUTION.concepts.map((c) => [c.title, c.definition, "", []]));
  assert.deepEqual(s.concepts[1].sourceRefs, [ref("11")]);
});

test("exerciseDocument: documento valido, nessun arco, bolle uguali in griglia senza sovrapposizioni, deterministico", () => {
  const doc = exerciseDocument("React", SOLUTION, { seed: "s1" });
  assertMapDocument(doc);
  assert.equal(doc.relations.length, 0);
  assert.equal(doc.concepts.length, 4);
  assert.ok(doc.concepts.every((c) => c.explanation === "" && c.examples.length === 0 && c.definition));
  const ps = doc.placements.filter((p) => p.spaceId === doc.rootSpaceId);
  assert.equal(ps.length, 4);
  assert.ok(ps.every((p) => p.width === 220 && p.height === 110));
  for (const a of ps) for (const b of ps) if (a !== b) assert.ok(Math.abs(a.x - b.x) >= 220 || Math.abs(a.y - b.y) >= 110, "sovrapposte");
  const again = exerciseDocument("React", SOLUTION, { seed: "s1" });
  const order = (d: ExerciseDoc) => d.placements.map((p) => [d.concepts.find((c) => c.id === p.conceptId)!.title, p.x, p.y]);
  assert.deepEqual(order(again), order(doc));
});

test("levelKeyOf: root per la tela iniziale, concetto proprietario per le altre", () => {
  const doc = exerciseDocument("React", SOLUTION, { seed: "s1" });
  assert.equal(levelKeyOf(doc, doc.rootSpaceId), "root");
  assert.throws(() => levelKeyOf(doc, "nessuna"), /Tela inesistente/);
});

test("levelPropositions e levelConcepts: solo ciò che sta nella tela", () => {
  const doc = withRelations(exerciseDocument("React", SOLUTION, { seed: "s1" }), [["State", "causa", "Rendering"]]);
  assert.equal(levelConcepts(doc, doc.rootSpaceId).length, 4);
  assert.deepEqual(levelPropositions(doc, doc.rootSpaceId).map((r) => r.label), ["causa"]);
});

test("comparePairs: direzione ignorata, comuni, solo tue, mancanti senza etichetta per la UI", () => {
  const doc = withRelations(exerciseDocument("React", SOLUTION, { seed: "s1" }), [
    ["Rendering", "dipende da", "State"],   // coppia della soluzione, direzione opposta
    ["State", "contiene", "Props"],          // solo dello studente
  ]);
  const r = comparePairs(doc, doc.rootSpaceId, SOLUTION);
  assert.deepEqual(r.common, [pairKey(idOf(doc, "State"), idOf(doc, "Rendering"))]);
  assert.deepEqual(r.extra, [pairKey(idOf(doc, "State"), idOf(doc, "Props"))]);
  assert.deepEqual(r.missing.map((m) => [m.sourceId, m.targetId].sort()).sort(), [
    [idOf(doc, "Rendering"), idOf(doc, "Props")].sort(), [idOf(doc, "Rendering"), idOf(doc, "Virtual DOM")].sort(),
  ].sort());
});

test("resolveSolution/comparePairs: un titolo rinominato non si risolve e viene ignorato", () => {
  const base = exerciseDocument("React", SOLUTION, { seed: "s1" });
  const renamed = applyMapCommands(base, [{ type: "updateConcept", id: idOf(base, "Props"), changes: { title: "Proprietà" } }]) as ExerciseDoc;
  assert.equal(resolveSolution(renamed, renamed.rootSpaceId, SOLUTION).length, 2);
  assert.equal(comparePairs(renamed, renamed.rootSpaceId, SOLUTION).missing.length, 2);
});

test("titoli confrontati con titleKey: maiuscole e accenti non contano", () => {
  const doc = exerciseDocument("React", SOLUTION, { seed: "s1" });
  const sol: Solution = { concepts: [], relations: [{ from: "state", to: "RENDERING", label: "provoca" }] };
  assert.equal(resolveSolution(doc, doc.rootSpaceId, sol).length, 1);
});

test("overlayDocument: aggiunge solo le coppie mancanti, non direzionali, documento valido", () => {
  const doc = withRelations(exerciseDocument("React", SOLUTION, { seed: "s1" }), [["State", "causa", "Rendering"]]);
  const view = overlayDocument(doc, doc.rootSpaceId, SOLUTION);
  assertMapDocument(view);
  const added = view.relations.filter((r) => !doc.relations.some((d) => d.id === r.id));
  assert.equal(added.length, 2);
  assert.ok(added.every((r) => r.directed === false));
  assert.equal(doc.relations.length, 1, "l'originale non cambia");
});

test("completionCommands: archi mancanti direzionali + spiegazioni ed esempi solo dove vuoti", () => {
  const doc = withRelations(exerciseDocument("React", SOLUTION, { seed: "s1" }), [["State", "causa", "Rendering"]]);
  const edited = applyMapCommands(doc, [{ type: "updateConcept", id: idOf(doc, "Props"), changes: { explanation: "Mia nota." } }]) as ExerciseDoc;
  const done = applyMapCommands(edited, completionCommands(edited, edited.rootSpaceId, SOLUTION)) as ExerciseDoc;
  assert.equal(done.relations.length, 3);
  assert.ok(done.relations.every((r) => r.directed));
  const c = (t: string) => done.concepts.find((x) => x.title === t)!;
  assert.equal(c("State").explanation, "Lo state vive nel componente.");
  assert.deepEqual(c("State").examples, ["useState"]);
  assert.equal(c("Props").explanation, "Mia nota.");
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx tsx --test tests/mapExerciseCore.test.ts`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: implementazione**

`src/lib/mapExerciseCore.ts`:

```ts
/**
 * Mappe «costruisci tu» (Fase 5), parte pura: documento-esercizio, confronto delle coppie,
 * sovrapposizione della soluzione e comandi di completamento. Gira anche nel browser: niente DB.
 * Usa il motore delle mappe solo tramite le sue esportazioni (comandi atomici, proposte).
 */
import { mapFromProposal, titleKey } from "@/lib/mappe/proposte.js";
import { applyMapCommands } from "@/lib/mappe/comandi.js";
import { createRelation } from "@/lib/mappe/modello.js";

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
  const base = mapFromProposal(title, stripProposal(p), opts.provenance ? { provenance: opts.provenance } : {}) as ExerciseDoc;
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

/** Vista «Mostra soluzione»: le coppie mancanti come archi non direzionali (la tela li tratteggia). Mai salvata. */
export function overlayDocument(doc: ExerciseDoc, spaceId: string, solution: Solution): ExerciseDoc {
  const commands = comparePairs(doc, spaceId, solution).missing.map((m) => ({
    type: "addRelation",
    relation: createRelation(m.sourceId, m.targetId, predicate(m.label), { directed: false, provenance: { origin: "llm" } }),
  }));
  return applyMapCommands(doc, commands) as ExerciseDoc;
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
```

Se il typecheck si lamenta dei tipi impliciti dei moduli JS (`mapFromProposal` ecc.), usa cast `as ExerciseDoc` come fa già `conceptmap.ts` (`as MapDocument`), senza toccare i `.js`.

- [ ] **Step 4: test verdi**

Run: `npx tsx --test tests/mapExerciseCore.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/lib/mapExerciseCore.ts tests/mapExerciseCore.test.ts
git commit -m "Nucleo puro degli esercizi sulle mappe: documento, confronto coppie, soluzione e completamento

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Modalità build in `conceptmap.ts`

**Files:**
- Modify: `src/lib/conceptmap.ts`
- Test: `tests/conceptmapBuild.test.ts`

**Interfaces:**
- Consumes: `withJudge` da `tests/helpers/judge.ts` (Ollama finto: le risposte chat in ordine, i corpi in `bodies`).
- Produces:
  - `export interface BuildResult extends Proposal { focusQuestion?: string }`
  - `export async function proposeMap(domainId: number, topic: string, sourceChunks?: Retrieved[], opts?: { build?: boolean }): Promise<BuildResult>`
  - `generateMap(domainId, topic, sourceChunks?)` invariata nel comportamento (usa `proposeMap` senza build).
  - `expandConcept(domainId, concept, path, existing, present = [], opts: { build?: boolean } = {}): Promise<BuildResult>`
  - In modalità build: lo schema JSON ha in più `focus_question` (stringa, ultima proprietà, in `required`) e il system prompt finisce con `BUILD_NOTE`; `focusQuestion` = `focus_question` ripulito, o fallback `Come si collegano fra loro i concetti di «<centro>»?` se vuoto.

- [ ] **Step 1: test che falliscono**

`tests/conceptmapBuild.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import { withJudge } from "./helpers/judge";

await useTempDb();
const { generateMap, proposeMap, expandConcept } = await import("@/lib/conceptmap");

const chunk = (id: number, content: string) => ({ chunkId: id, documentId: 1, content, distance: 0, source: null, docKind: "text", docMeta: { fileHash: "h" } });
const FOUND = [chunk(10, "Lo state provoca il rendering."), chunk(11, "Le props arrivano dal genitore.")];
const reply = (extra: Record<string, unknown> = {}) => JSON.stringify({
  center: { title: "React", definition: "Libreria UI.", explanation: "x", sources: [1] },
  concepts: [
    { title: "State", definition: "Dati locali.", explanation: "y", sources: [1], verb: "gestisce" },
    { title: "Props", definition: "Dati dal genitore.", explanation: "z", sources: [2], verb: "riceve" },
  ],
  relations: [{ from: "State", to: "Props", label: "differisce da" }],
  ...extra,
});

test("modalità normale: schema e prompt senza focus_question", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withJudge([reply()], () => generateMap(1, "React", FOUND), bodies);
  const body = JSON.stringify(bodies[0]);
  assert.ok(!body.includes("focus_question"));
});

test("modalità build: schema con focus_question e domanda focale restituita", async () => {
  const bodies: Record<string, unknown>[] = [];
  const r = await withJudge([reply({ focus_question: "  Come decide React quando ridisegnare?  " })], () => proposeMap(1, "React", FOUND, { build: true }), bodies);
  assert.equal(r.focusQuestion, "Come decide React quando ridisegnare?");
  assert.ok(JSON.stringify(bodies[0]).includes("focus_question"));
  assert.ok(r.relations.some((x) => x.from === "React" && x.to === "State" && x.label === "gestisce"));
  assert.equal(r.concepts[0].title, "React");
});

test("modalità build: domanda focale vuota → fallback", async () => {
  const r = await withJudge([reply({ focus_question: "" })], () => proposeMap(1, "React", FOUND, { build: true }));
  assert.equal(r.focusQuestion, "Come si collegano fra loro i concetti di «React»?");
});

test("expandConcept in modalità build: focusQuestion presente; senza build assente", async () => {
  // expandConcept cerca il materiale con hybridSearch: con Ollama finto l'embed risponde 503.
  // Se hybridSearch non regge l'embed assente, il test va adattato passando dal DB temporaneo
  // un chunk FTS (vedi tests/tutorGuard.test.ts o tests/grading-source.test.ts per il pattern).
  const r = await withJudge([reply({ focus_question: "Di cosa è fatto lo state?" })], () =>
    expandConcept(1, { title: "State" }, [], [], [], { build: true })).catch((e) => e);
  if (r instanceof Error) assert.match(r.message, /materiale/); // nessun chunk nel DB temporaneo
  else assert.equal(r.focusQuestion, "Di cosa è fatto lo state?");
});
```

Nota per l'implementatore: l'ultimo test copre il passaggio dell'opzione; se nel DB temporaneo `hybridSearch` non trova nulla, `expandConcept` lancia «nessun materiale trovato…» prima di chiamare il modello: è un esito accettato dal test. Se vuoi un test forte, inserisci un documento e un chunk nel DB temporaneo (con `indexChunks` di `rag/store.ts` o l'INSERT diretto + `reindexFts`) seguendo `tests/grading-source.test.ts`.

- [ ] **Step 2: verifica che falliscano**

Run: `npx tsx --test tests/conceptmapBuild.test.ts`
Expected: FAIL (`proposeMap` non esportata).

- [ ] **Step 3: implementazione**

In `src/lib/conceptmap.ts`:

1. Dopo `SCHEMA` aggiungi:

```ts
/** Modalità «costruisci tu» (Fase 5): stesso schema più la domanda focale, chiesta per ultima (dopo i concetti). */
const BUILD_SCHEMA = {
  ...SCHEMA,
  properties: { ...SCHEMA.properties, focus_question: { type: "string" } },
  required: [...SCHEMA.required, "focus_question"],
} as const;

const BUILD_NOTE =
  " `focus_question`: una domanda, per chi studia, a cui questa mappa risponde (es. \"Come decide React quando " +
  "ridisegnare un componente?\"); una sola frase, nella lingua del materiale.";

export interface BuildResult extends Proposal { focusQuestion?: string }
```

2. Cambia la firma di `propose` aggiungendo in fondo `build = false` e il tipo di ritorno `Promise<BuildResult>`:
   - `parsed` acquisisce il campo opzionale `focus_question?: string`;
   - nella chiamata a `generate` usa `system: build ? system + BUILD_NOTE : system` e `schema: (build ? BUILD_SCHEMA : SCHEMA) as unknown as Record<string, unknown>`;
   - prima del `return`, calcola
     ```ts
     const focusQuestion = build
       ? (parsed.focus_question?.trim() || `Come si collegano fra loro i concetti di «${centerName ?? centerTitle ?? center ?? ""}»?`)
       : undefined;
     return focusQuestion === undefined ? { concepts, relations } : { concepts, relations, focusQuestion };
     ```
   In modalità normale l'oggetto restituito e il corpo della richiesta restano identici a prima.

3. Sostituisci `generateMap` con:

```ts
/** Proposta per una mappa nuova su un argomento: il primo concetto è il centro, poi 6-10 concetti chiave. */
export async function proposeMap(domainId: number, topic: string, sourceChunks?: Retrieved[], opts: { build?: boolean } = {}): Promise<BuildResult> {
  const found = sourceChunks ?? await diverseSearch(topic, 14, domainId);
  if (!found.length) throw new Error("nessun materiale trovato per questo argomento");
  const proposal = await propose(
    "Costruisci una mappa concettuale di studio dal materiale fornito. `center` = il concetto centrale " +
      "dell'argomento richiesto. `concepts` = ALMENO 6 (massimo 10) concetti chiave concreti: i rami principali " +
      "dell'argomento, non dettagli minuti (quelli si esplorano dopo entrando nelle bolle) e non elementi " +
      "marginali solo perché compaiono nel materiale. " + FIELDS,
    `Argomento: ${topic}`,
    found,
    undefined,
    topic,
    opts.build
  );
  if (!proposal.concepts.length) throw new Error("il modello non ha estratto concetti");
  return proposal;
}

/** Mappa nuova su un argomento (modalità normale). */
export async function generateMap(domainId: number, topic: string, sourceChunks?: Retrieved[]): Promise<MapDocument> {
  const proposal = await proposeMap(domainId, topic, sourceChunks);
  return mapFromProposal(topic, proposal, { provenance: provenance() }) as MapDocument;
}
```

(Il testo del system prompt va copiato **identico** da quello attuale.)

4. `expandConcept`: aggiungi il parametro `opts: { build?: boolean } = {}` dopo `present`, tipo di ritorno `Promise<BuildResult>`, e passa `opts.build` come sesto argomento a `propose` (dopo `concept.title`).

5. Esporta `provenance` (serve a `mapExercise.ts`): `export const provenance = () => (...)`.

- [ ] **Step 4: test verdi e regressione**

Run: `npx tsx --test tests/conceptmapBuild.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/lib/conceptmap.ts tests/conceptmapBuild.test.ts
git commit -m "Mappe: modalità build con domanda focale (prompt normale invariato)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `mapExercise.ts` — creazione, approfondimenti, livelli, soluzione

**Files:**
- Create: `src/lib/mapExercise.ts`
- Test: `tests/mapExercise.test.ts`

**Interfaces:**
- Consumes: Task 1 (tabella, `saveMap`, `getMap`), Task 2 (core), Task 3 (`proposeMap`, `expandConcept`, `provenance`, `BuildResult`).
- Produces:
  - `export const PROMPT_VERSION = "maps-v1"; export const MAX_PROPOSITIONS = 15;`
  - `export class ExerciseError extends Error { constructor(message: string, readonly status = 400) }`
  - `export interface LevelInfo { levelKey: string; focusQuestion: string; lastCheck: CheckResult | null; checkedAt: number | null; revealedAt: number | null; completedAt: number | null }`
  - `export interface CheckResult` (definito in Task 5, dichiaralo già qui):
    ```ts
    export type Verdict = "valid" | "imprecise" | "wrong";
    export interface PropositionVerdict { relationId: string; sourceId: string; targetId: string; label: string; verdict: Verdict | "unrated"; reason: string; fix: string; inSolution: boolean }
    export interface CheckResult { verdicts: PropositionVerdict[]; missing: { a: string; b: string }[]; checkedAt: number }
    ```
  - `createExercise(domainId: number, topic: string, sourceChunks?: Retrieved[]): Promise<{ map: MapDocument }>`
  - `expandExercise(mapId: string, domainId: number, conceptId: string, req: { concept: { title: string; definition?: string }; path: string[]; existing: string[]; present: string[] }): Promise<Solution>` (proposta spogliata)
  - `exerciseLevels(mapId: string): LevelInfo[]`
  - `revealLevel(mapId: string, spaceId: string): { relations: SolutionRelation[] }`
  - `completeLevel(mapId: string, spaceId: string): Solution`
  - helper interni: `loadLevel(mapId, spaceId) → { domainId, doc: ExerciseDoc, levelKey, row }` che lancia `ExerciseError("mappa inesistente", 404)`, `ExerciseError("tela inesistente", 404)`, `ExerciseError("nessun esercizio su questo livello", 404)`.

- [ ] **Step 1: test che falliscono**

`tests/mapExercise.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import { withJudge } from "./helpers/judge";

const { sqlite } = await useTempDb();
const ex = await import("@/lib/mapExercise");
const { getMap } = await import("@/lib/mappe/store");

sqlite.prepare("INSERT INTO domains (id, name) VALUES (1, 'Corso')").run();
const chunk = (id: number, content: string) => ({ chunkId: id, documentId: 1, content, distance: 0, source: null, docKind: "text", docMeta: { fileHash: "h" } });
const FOUND = [chunk(10, "Lo state provoca il rendering."), chunk(11, "Le props arrivano dal genitore.")];
const MAP_REPLY = JSON.stringify({
  center: { title: "React", definition: "Libreria UI.", explanation: "Spiega React.", sources: [1] },
  concepts: [
    { title: "State", definition: "Dati locali.", explanation: "Lo state cambia.", examples: ["useState"], sources: [1], verb: "gestisce" },
    { title: "Props", definition: "Dati dal genitore.", explanation: "Le props scendono.", sources: [2], verb: "riceve" },
  ],
  relations: [{ from: "State", to: "Props", label: "differisce da" }],
  focus_question: "Come passano i dati in React?",
});

test("createExercise: mappa senza archi né spiegazioni, riga root con la soluzione completa", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React", FOUND));
  assert.equal(map.relations.length, 0);
  assert.ok((map.concepts as { explanation: string }[]).every((c) => c.explanation === ""));
  assert.ok(getMap(map.id));
  const levels = ex.exerciseLevels(map.id);
  assert.deepEqual(levels.map((l) => [l.levelKey, l.focusQuestion, l.lastCheck]), [["root", "Come passano i dati in React?", null]]);
  assert.ok(!("proposal" in levels[0]), "la soluzione non esce da exerciseLevels");
  const row = sqlite.prepare("SELECT proposal FROM map_exercises WHERE map_id = ?").get(map.id) as { proposal: string };
  const solution = JSON.parse(row.proposal);
  assert.ok(solution.relations.length >= 3);
  assert.equal(solution.concepts.find((c: { title: string }) => c.title === "State").explanation, "Lo state cambia.");
});

test("revealLevel e completeLevel: restituiscono la soluzione e segnano le date", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React2", FOUND));
  const { relations } = ex.revealLevel(map.id, map.rootSpaceId);
  assert.ok(relations.some((r) => r.from === "State" && r.to === "Props"));
  assert.ok(ex.exerciseLevels(map.id)[0].revealedAt);
  const full = ex.completeLevel(map.id, map.rootSpaceId);
  assert.ok(full.concepts.some((c) => c.explanation === "Lo state cambia."));
  assert.ok(ex.exerciseLevels(map.id)[0].completedAt);
});

test("livello senza esercizio, tela o mappa inesistenti: ExerciseError 404", async () => {
  assert.throws(() => ex.revealLevel("nessuna", "x"), (e: unknown) => e instanceof ex.ExerciseError && e.status === 404);
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React3", FOUND));
  assert.throws(() => ex.revealLevel(map.id, "tela-che-non-c-e"), (e: unknown) => e instanceof ex.ExerciseError && e.status === 404);
});
```

(I test di `expandExercise` richiedono materiale nel DB per `hybridSearch`: inserisci un documento + chunk + FTS come in `tests/grading-source.test.ts`, oppure — se il pattern è troppo oneroso — aggiungi a `expandExercise` un parametro facoltativo `found?: Retrieved[]` passato a una variante `expandConcept(..., { build: true, sourceChunks })`. Scegli la prima strada se il DB temporaneo supporta FTS senza embed; il test deve verificare: (a) la proposta restituita ha `relations: []` e concetti con `explanation: ""`; (b) la riga `level_key = conceptId` esiste con la soluzione completa; (c) una seconda chiamata **fonde** (concetti deduplicati per `titleKey`, relazioni accodate senza duplicati); (d) mappa non-esercizio → `ExerciseError` 409 «la mappa non è un esercizio»; (e) concetto non nella mappa → 404.)

- [ ] **Step 2: verifica che falliscano**

Run: `npx tsx --test tests/mapExercise.test.ts`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: implementazione**

`src/lib/mapExercise.ts`:

```ts
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
): Promise<Solution> {
  const found = getMap(mapId);
  if (!found) throw new ExerciseError("mappa inesistente", 404);
  if (found.domainId !== domainId) throw new ExerciseError("la mappa appartiene a un altro dominio", 409);
  if (!getRow(mapId, "root")) throw new ExerciseError("la mappa non è un esercizio", 409);
  if (!(found.doc as unknown as ExerciseDoc).concepts.some((c) => c.id === conceptId)) throw new ExerciseError("concetto inesistente", 404);
  const p = await expandConcept(domainId, req.concept, req.path, req.existing, req.present, { build: true });
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
```

Nota: `expandConcept` in Task 3 non accetta `sourceChunks`; se per i test scegli la seconda strada (vedi Step 1), aggiungi a `expandConcept` l'opzione `opts.sourceChunks?: Retrieved[]` usata al posto di `diverseSearch` quando presente, e propagala da `expandExercise` con un ultimo parametro facoltativo `found?: Retrieved[]`.

- [ ] **Step 4: test verdi**

Run: `npx tsx --test tests/mapExercise.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/lib/mapExercise.ts tests/mapExercise.test.ts src/lib/conceptmap.ts
git commit -m "Esercizi sulle mappe: creazione, approfondimenti con soluzione nascosta, soluzione e completamento

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Valutatore — `judgePropositions`, `evaluateLevel`, `relationCardDraft`

**Files:**
- Modify: `src/lib/mapExercise.ts`
- Modify: `tests/mapExercise.test.ts`

**Interfaces:**
- Consumes: Task 2 (`levelPropositions`, `levelConcepts`, `resolveSolution`, `comparePairs`, `pairKey`), Task 4 (`loadLevel`, tipi), `generate` di `@/lib/providers`, `checkCard` di `@/lib/tutor/cardQuality`, tipo `CardDraft` di `@/lib/tutor/cardGen`.
- Produces:
  - `export interface JudgeProposition { id: string; from: string; label: string; to: string; reference?: string }`
  - `export interface Judgement { id: string; reason: string; verdict: Verdict; fix: string }`
  - `export function parseJudgements(raw: string, ids: string[]): Judgement[] | null`
  - `export async function judgePropositions(input: { focusQuestion: string; propositions: JudgeProposition[]; passages: string[] }): Promise<Judgement[]>`
  - `export function levelPassages(solution: Solution, titles: string[]): string[]`
  - `export async function evaluateLevel(mapId: string, spaceId: string): Promise<CheckResult>`
  - `export function relationCardDraft(mapId: string, spaceId: string, relationId: string): CardDraft`

- [ ] **Step 1: test che falliscono** (accoda a `tests/mapExercise.test.ts`)

```ts
const { applyMapCommands } = await import("@/lib/mappe/comandi.js");
const { createRelation } = await import("@/lib/mappe/modello.js");
const { saveMap } = await import("@/lib/mappe/store");

const judged = (items: unknown[]) => JSON.stringify({ items });

test("parseJudgements: id sconosciuti scartati, verdetti fuori enum rifiutati, fix svuotato sui valid", () => {
  const ids = ["P1", "P2"];
  assert.deepEqual(ex.parseJudgements(judged([
    { id: "P1", reason: "ok", verdict: "valid", fix: "inutile" },
    { id: "P9", reason: "x", verdict: "wrong", fix: "y" },
  ]), ids), [{ id: "P1", reason: "ok", verdict: "valid", fix: "" }]);
  assert.equal(ex.parseJudgements("non json", ids), null);
  assert.equal(ex.parseJudgements(JSON.stringify({ nope: [] }), ids), null);
  assert.deepEqual(ex.parseJudgements(judged([{ id: "P2", reason: "r", verdict: "forse", fix: "" }]), ids), []);
});

test("judgePropositions: oltre 15 lancia; un retry poi errore", async () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ id: `P${i + 1}`, from: "A", label: "x", to: "B" }));
  await assert.rejects(ex.judgePropositions({ focusQuestion: "D?", propositions: many, passages: [] }), /15/);
  const one = [{ id: "P1", from: "State", label: "provoca", to: "Rendering", reference: "State provoca Rendering" }];
  const bodies: Record<string, unknown>[] = [];
  const r = await withJudge(["rotto", judged([{ id: "P1", reason: "Il materiale lo dice.", verdict: "valid", fix: "" }])],
    () => ex.judgePropositions({ focusQuestion: "D?", propositions: one, passages: ["Lo state provoca il rendering."] }), bodies);
  assert.equal(r[0].verdict, "valid");
  assert.equal(bodies.length, 2);
  const prompt = JSON.stringify(bodies[0]);
  assert.match(prompt, /una possibile, non l'unica/);
  assert.match(prompt, /\[1\] Lo state provoca il rendering\./);
  await assert.rejects(withJudge(["rotto"], () => ex.judgePropositions({ focusQuestion: "D?", propositions: one, passages: [] })), /valutazione valida/);
});

test("levelPassages: chunk dei concetti del livello, deduplicati, tagliati a 1500 e 10000 in tutto", () => {
  sqlite.prepare("INSERT INTO documents (id, domain_id, title, kind) VALUES (1, 1, 'Doc', 'text')").run();
  sqlite.prepare("INSERT INTO chunks (id, document_id, ordinal, content) VALUES (10, 1, 0, ?)").run("a".repeat(2000));
  sqlite.prepare("INSERT INTO chunks (id, document_id, ordinal, content) VALUES (11, 1, 1, 'Le props arrivano dal genitore.')").run();
  const ref = (chunkId: string) => ({ documentId: "1", documentRevision: "h", chunkId });
  const sol = { concepts: [
    { title: "State", sourceRefs: [ref("10"), ref("11")] },
    { title: "Props", sourceRefs: [ref("11")] },
    { title: "Altro", sourceRefs: [ref("99")] },
  ], relations: [] };
  const ps = ex.levelPassages(sol, ["State", "props"]);
  assert.deepEqual(ps.map((p) => p.length), [1500, "Le props arrivano dal genitore.".length]);
});

test("evaluateLevel: legge il documento salvato, voci mancanti unrated, coppie mancanti per nome, last_check salvato", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React-check", FOUND));
  const id = (t: string) => (map.concepts as { id: string; title: string }[]).find((c) => c.title === t)!.id;
  const withRels = applyMapCommands(map, [
    { type: "addRelation", relation: createRelation(id("State"), id("React"), "è gestito da") },
    { type: "addRelation", relation: createRelation(id("Props"), id("State"), "diventano") },
  ]);
  saveMap(1, withRels, map.revision);
  const r = await withJudge([judged([{ id: "P1", reason: "Giusta.", verdict: "valid", fix: "" }])], () => ex.evaluateLevel(map.id, map.rootSpaceId));
  assert.deepEqual(r.verdicts.map((v) => [v.label, v.verdict, v.inSolution]), [["è gestito da", "valid", true], ["diventano", "unrated", true]]);
  assert.deepEqual(r.missing, [{ a: "React", b: "Props" }].filter((m) => r.missing.some((x) => [x.a, x.b].sort().join() === [m.a, m.b].sort().join())));
  assert.equal(ex.exerciseLevels(map.id)[0].lastCheck?.verdicts.length, 2);
});

test("evaluateLevel: senza proposizioni → ExerciseError 400", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React-vuota", FOUND));
  await assert.rejects(ex.evaluateLevel(map.id, map.rootSpaceId), (e: unknown) => e instanceof ex.ExerciseError && e.status === 400);
});

test("relationCardDraft: risposta dalla soluzione se la coppia c'è, altrimenti dal fix della verifica", async () => {
  const { map } = await withJudge([MAP_REPLY], () => ex.createExercise(1, "React-carta", FOUND));
  const id = (t: string) => (map.concepts as { id: string; title: string }[]).find((c) => c.title === t)!.id;
  const inSol = createRelation(id("State"), id("Props"), "è uguale a");
  const outSol = createRelation(id("React"), id("Props"), "ignora");
  const saved = saveMap(1, applyMapCommands(map, [{ type: "addRelation", relation: inSol }, { type: "addRelation", relation: outSol }]), map.revision);
  await withJudge([judged([
    { id: "P1", reason: "No.", verdict: "wrong", fix: "Lo state differisce dalle props." },
    { id: "P2", reason: "No.", verdict: "wrong", fix: "React riceve le props." },
  ])], () => ex.evaluateLevel(saved.id, saved.rootSpaceId));
  const a = ex.relationCardDraft(saved.id, saved.rootSpaceId, inSol.id);
  assert.equal(a.question, "Che relazione c'è tra «State» e «Props»?");
  assert.equal(a.answer, "State differisce da Props");
  assert.equal(a.sourceChunkId, 10);
  assert.deepEqual(a.issues, []);
  const b = ex.relationCardDraft(saved.id, saved.rootSpaceId, outSol.id);
  assert.equal(b.answer, "React riceve Props");
});
```

Note per l'implementatore:
- La relazione `React → Props` **è** nella soluzione (arco dal centro via `verb: "riceve"`): la risposta viene dalla soluzione, non dal `fix`. Per testare il ramo `fix` aggiungi una terza relazione fuori soluzione (es. `State → React`? no, anche quella è in soluzione): crea un concetto in più nel `MAP_REPLY`? Più semplice: una relazione `Props → React` è comunque la coppia React–Props. Usa invece un documento con un concetto aggiunto a mano (`addConcept` + `addPlacement` nella tela root) e una relazione verso di esso, verificata come `wrong` con `fix` → risposta = `fix`. Aggiungi questo caso al test.
- Controlla le colonne reali di `documents`/`chunks` in `schema.ts` e adatta gli INSERT di `levelPassages`.
- L'asserzione su `missing` va resa esatta una volta noto l'output: la soluzione ha le coppie React–State, React–Props, State–Props; lo studente ha State–React e Props–State → mancante solo `React–Props`. Scrivi `assert.deepEqual(r.missing.map((m) => [m.a, m.b].sort()), [["Props", "React"]])`.

- [ ] **Step 2: verifica che falliscano**

Run: `npx tsx --test tests/mapExercise.test.ts`
Expected: FAIL (funzioni assenti).

- [ ] **Step 3: implementazione** (in `src/lib/mapExercise.ts`)

```ts
import { generate } from "@/lib/providers";
import { checkCard } from "@/lib/tutor/cardQuality";
import type { CardDraft } from "@/lib/tutor/cardGen";
import { comparePairs, levelConcepts, levelPropositions, pairKey, resolveSolution } from "@/lib/mapExerciseCore";

const VERDICTS = ["valid", "imprecise", "wrong"] as const;
const PASSAGE_CHARS = 1500;
const PASSAGES_TOTAL = 10000;

export interface JudgeProposition { id: string; from: string; label: string; to: string; reference?: string }
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
  "Per ogni proposizione, in quest'ordine:",
  "1. reason: una o due frasi in italiano: cosa dice il materiale sul legame fra A e B.",
  "2. verdict:",
  "- valid: il materiale sostiene il legame, anche se è formulato con altre parole o non compare nella formulazione di riferimento. Non esiste una sola mappa giusta.",
  "- imprecise: i due concetti sono davvero legati, ma il verbo è vago (es. «è collegato a», «riguarda»), sbagliato nel tipo di rapporto, oppure la direzione è invertita.",
  "- wrong: il materiale non sostiene il legame o lo contraddice.",
  "3. fix: per imprecise e wrong, una frase che enuncia la relazione corretta fra A e B secondo il materiale; vuoto per valid.",
  "La «formulazione di riferimento», quando c'è, è UNA formulazione possibile, non l'unica: usala per capire il legame atteso, non per bocciare formulazioni diverse ma corrette.",
  "Valuta tutte le proposizioni, con lo stesso id.",
].join("\n");

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
export async function judgePropositions(input: { focusQuestion: string; propositions: JudgeProposition[]; passages: string[] }): Promise<Judgement[]> {
  const { focusQuestion, propositions, passages } = input;
  if (!propositions.length) return [];
  if (propositions.length > MAX_PROPOSITIONS) throw new ExerciseError(`massimo ${MAX_PROPOSITIONS} proposizioni per verifica`);
  const content = [
    `Domanda focale della mappa: ${focusQuestion}`,
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
    if (parsed) return parsed;
  }
  throw new Error("Il modello non ha prodotto una valutazione valida delle proposizioni. Riprova.");
}

/** Passaggi sorgente dei concetti del livello (per titolo), deduplicati, ≤ 1500 caratteri l'uno e 10 000 in tutto. */
export function levelPassages(solution: Solution, titles: string[]): string[] {
  const keys = new Set(titles.map(titleKey));
  const ids: number[] = [];
  for (const c of solution.concepts) {
    if (!keys.has(titleKey(c.title))) continue;
    for (const r of c.sourceRefs ?? []) {
      const n = Number(r.chunkId);
      if (Number.isSafeInteger(n) && !ids.includes(n)) ids.push(n);
    }
  }
  const get = sqlite.prepare("SELECT content FROM chunks WHERE id = ?");
  const out: string[] = [];
  let total = 0;
  for (const id of ids) {
    const row = get.get(id) as { content: string } | undefined;
    if (!row) continue;
    const text = row.content.slice(0, PASSAGE_CHARS);
    if (total + text.length > PASSAGES_TOTAL) break;
    out.push(text); total += text.length;
  }
  return out;
}

/** Verifica del livello: confronto delle coppie in codice + una chiamata LLM; l'esito resta in `last_check`. */
export async function evaluateLevel(mapId: string, spaceId: string): Promise<CheckResult> {
  const { doc, levelKey, row, solution } = loadLevel(mapId, spaceId);
  const props = levelPropositions(doc, spaceId);
  if (!props.length) throw new ExerciseError("nessuna proposizione da verificare: aggiungine almeno una");
  if (props.length > MAX_PROPOSITIONS) throw new ExerciseError(`massimo ${MAX_PROPOSITIONS} proposizioni per verifica: togline qualcuna`);
  const title = new Map(doc.concepts.map((c) => [c.id, c.title]));
  const reference = new Map<string, string>();
  for (const r of resolveSolution(doc, spaceId, solution)) {
    const k = pairKey(r.sourceId, r.targetId);
    if (!reference.has(k)) reference.set(k, `${title.get(r.sourceId)} ${r.label} ${title.get(r.targetId)}`);
  }
  const propositions: JudgeProposition[] = props.map((r, i) => ({
    id: `P${i + 1}`, from: title.get(r.sourceConceptId) ?? "", label: r.label || r.predicate, to: title.get(r.targetConceptId) ?? "",
    reference: reference.get(pairKey(r.sourceConceptId, r.targetConceptId)),
  }));
  const passages = levelPassages(solution, levelConcepts(doc, spaceId).map((c) => c.title));
  const judged = new Map((await judgePropositions({ focusQuestion: row.focus_question, propositions, passages })).map((j) => [j.id, j]));
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
 * Bozza di carta da una proposizione sbagliata: «Che relazione c'è tra X e Y?», risposta dalla
 * soluzione se la coppia c'è, altrimenti dalla correzione dell'ultima verifica. Passa da checkCard.
 */
export function relationCardDraft(mapId: string, spaceId: string, relationId: string): CardDraft {
  const { doc, row, solution } = loadLevel(mapId, spaceId);
  const rel = doc.relations.find((r) => r.id === relationId);
  if (!rel) throw new ExerciseError("relazione inesistente", 404);
  const title = new Map(doc.concepts.map((c) => [c.id, c.title]));
  const a = title.get(rel.sourceConceptId) ?? "", b = title.get(rel.targetConceptId) ?? "";
  const k = pairKey(rel.sourceConceptId, rel.targetConceptId);
  const ref = resolveSolution(doc, spaceId, solution).find((r) => pairKey(r.sourceId, r.targetId) === k);
  const check = row.last_check ? JSON.parse(row.last_check) as CheckResult : null;
  const fix = check?.verdicts.find((v) => v.relationId === relationId)?.fix ?? "";
  const answer = ref ? `${title.get(ref.sourceId)} ${ref.label} ${title.get(ref.targetId)}` : fix;
  if (!answer) throw new ExerciseError("nessuna risposta disponibile: verifica prima la mappa");
  const keys = new Set([titleKey(a), titleKey(b)]);
  const chunk = solution.concepts.filter((c) => keys.has(titleKey(c.title))).flatMap((c) => c.sourceRefs ?? [])
    .map((r) => Number(r.chunkId)).find((n) => Number.isSafeInteger(n));
  const question = `Che relazione c'è tra «${a}» e «${b}»?`;
  return { question, answer, type: "qa", fact: answer, sourceChunkId: chunk ?? null, issues: checkCard({ question, answer }) };
}
```

(Unisci gli import nuovi a quelli già presenti in cima al file; niente import duplicati.)

- [ ] **Step 4: test verdi**

Run: `npx tsx --test tests/mapExercise.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/lib/mapExercise.ts tests/mapExercise.test.ts
git commit -m "Valutatore delle mappe-esercizio (maps-v1): verdetti per proposizione, coppie mancanti, carte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: API `src/app/api/maps/exercise/*`

**Files:**
- Create: `src/app/api/maps/exercise/route.ts` (GET livelli, POST crea)
- Create: `src/app/api/maps/exercise/expand/route.ts`
- Create: `src/app/api/maps/exercise/check/route.ts`
- Create: `src/app/api/maps/exercise/reveal/route.ts`
- Create: `src/app/api/maps/exercise/complete/route.ts`
- Create: `src/app/api/maps/exercise/card/route.ts`
- Create: `src/lib/mapExerciseHttp.ts` (helper risposta errori)
- Test: `tests/mapExerciseApi.test.ts`

**Interfaces:**
- Consumes: Task 4/5.
- Produces: le route della tabella in spec §5, con queste risposte JSON:
  - `GET ?mapId=` → `{ levels: LevelInfo[] }`
  - `POST /` `{ domainId, topic }` → `{ map }`
  - `POST /expand` → `Solution` (proposta spogliata; stessa forma che l'editor si aspetta da `expandConcept`)
  - `POST /check` `{ mapId, spaceId }` → `CheckResult`
  - `POST /reveal` → `{ relations }`
  - `POST /complete` → `{ solution }`
  - `POST /card` `{ mapId, spaceId, relationId }` → `{ draft }`

- [ ] **Step 1: helper errori**

`src/lib/mapExerciseHttp.ts`:

```ts
import { NextResponse } from "next/server";
import { ExerciseError } from "@/lib/mapExercise";

/** Esegue `fn`: ExerciseError → il suo status, altri errori (modello, rete) → 500. */
export async function exerciseResponse(fn: () => unknown): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    const status = e instanceof ExerciseError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}

export const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
export const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
```

- [ ] **Step 2: route**

`src/app/api/maps/exercise/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createExercise, exerciseLevels } from "@/lib/mapExercise";
import { exerciseResponse, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Livelli dell'esercizio di una mappa (senza soluzione); vuoto = mappa normale. */
export async function GET(req: NextRequest) {
  const mapId = str(req.nextUrl.searchParams.get("mapId"));
  if (!mapId) return NextResponse.json({ error: "mapId richiesto" }, { status: 400 });
  return exerciseResponse(() => ({ levels: exerciseLevels(mapId) }));
}

/** Esercizio nuovo «costruisci tu» su un argomento. */
export async function POST(req: NextRequest) {
  const { domainId, topic } = await req.json();
  if (!Number.isSafeInteger(domainId) || !str(topic)) return NextResponse.json({ error: "domainId e topic richiesti" }, { status: 400 });
  return exerciseResponse(() => createExercise(domainId, topic.trim()));
}
```

`expand/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { expandExercise } from "@/lib/mapExercise";
import { exerciseResponse, str, strings } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Sottolivello di una mappa-esercizio: solo concetti, la soluzione resta sul server. */
export async function POST(req: NextRequest) {
  const { mapId, domainId, conceptId, concept, path, existing, present } = await req.json();
  if (!str(mapId) || !Number.isSafeInteger(domainId) || !str(conceptId) || !str(concept?.title))
    return NextResponse.json({ error: "mapId, domainId, conceptId e concept.title richiesti" }, { status: 400 });
  return exerciseResponse(() => expandExercise(mapId, domainId, conceptId, {
    concept: { title: concept.title, definition: typeof concept.definition === "string" ? concept.definition : undefined },
    path: strings(path), existing: strings(existing), present: strings(present),
  }));
}
```

`check/route.ts`, `reveal/route.ts`, `complete/route.ts` (stesso schema, cambia la funzione e il wrapping):

```ts
import { NextRequest, NextResponse } from "next/server";
import { evaluateLevel } from "@/lib/mapExercise";
import { exerciseResponse, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Verifica le proposizioni della tela: verdetti e coppie mancanti. */
export async function POST(req: NextRequest) {
  const { mapId, spaceId } = await req.json();
  if (!str(mapId) || !str(spaceId)) return NextResponse.json({ error: "mapId e spaceId richiesti" }, { status: 400 });
  return exerciseResponse(() => evaluateLevel(mapId, spaceId));
}
```

- `reveal/route.ts`: import `revealLevel`, commento «Mostra soluzione: relazioni della soluzione del livello.», `exerciseResponse(() => revealLevel(mapId, spaceId))`.
- `complete/route.ts`: import `completeLevel`, commento «Completa la mappa: soluzione intera del livello.», `exerciseResponse(() => ({ solution: completeLevel(mapId, spaceId) }))`.

`card/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { relationCardDraft } from "@/lib/mapExercise";
import { exerciseResponse, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Bozza di carta da una proposizione sbagliata (si salva poi con POST /api/cards). */
export async function POST(req: NextRequest) {
  const { mapId, spaceId, relationId } = await req.json();
  if (!str(mapId) || !str(spaceId) || !str(relationId)) return NextResponse.json({ error: "mapId, spaceId e relationId richiesti" }, { status: 400 });
  return exerciseResponse(() => ({ draft: relationCardDraft(mapId, spaceId, relationId) }));
}
```

- [ ] **Step 3: test delle route** (`tests/mapExerciseApi.test.ts`)

Segui lo stile di `tests/sf6Api.test.ts` (import dinamico della route dopo `useTempDb`, `new NextRequest(url, { method, body, headers })`). Casi:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { useTempDb } from "./helpers/db";

await useTempDb();
const list = await import("@/app/api/maps/exercise/route");
const check = await import("@/app/api/maps/exercise/check/route");
const reveal = await import("@/app/api/maps/exercise/reveal/route");

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("GET livelli: mapId mancante 400, mappa senza esercizio → []", async () => {
  assert.equal((await list.GET(new NextRequest("http://localhost/api/maps/exercise"))).status, 400);
  const r = await list.GET(new NextRequest("http://localhost/api/maps/exercise?mapId=nessuna"));
  assert.deepEqual(await r.json(), { levels: [] });
});

test("POST crea: corpo non valido 400", async () => {
  assert.equal((await list.POST(post("/api/maps/exercise", { domainId: "1", topic: "" }))).status, 400);
});

test("check e reveal: mappa inesistente 404 con messaggio", async () => {
  const r = await check.POST(post("/api/maps/exercise/check", { mapId: "nessuna", spaceId: "x" }));
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /mappa inesistente/);
  assert.equal((await reveal.POST(post("/api/maps/exercise/reveal", { mapId: "nessuna", spaceId: "x" }))).status, 404);
});
```

- [ ] **Step 4: test verdi**

Run: `npx tsx --test tests/mapExerciseApi.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/lib/mapExerciseHttp.ts src/app/api/maps/exercise tests/mapExerciseApi.test.ts
git commit -m "API degli esercizi sulle mappe: crea, approfondisci, verifica, soluzione, completa, carta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: UI — pannello `MapExercise` e integrazione in `MapStudio`

**Files:**
- Create: `src/components/study/MapExercise.tsx`
- Modify: `src/components/mappe/MapStudio.tsx`

**Interfaces:**
- Consumes: API di Task 6; core di Task 2 (`levelKeyOf`, `levelConcepts`, `levelPropositions`, `overlayDocument`, `completionCommands`, tipi); `createRelation` da `@/lib/mappe/modello.js`; `MapEditor`, `MapDoc` da `@/components/mappe/editor.js`; `CardPreview` da `./CardPreview`; tipi `LevelInfo`, `CheckResult`, `PropositionVerdict` da `@/lib/mapExercise` **solo come `import type`** (il modulo server non deve finire nel bundle client).
- Produces: `export default function MapExercise(props: { editor: MapEditor; mapId: string; domainId: number; levels: LevelInfo[]; onLevelsChange: () => void; overlay: boolean; onShowSolution: (doc: MapDoc) => void; onCloseSolution: () => void })`.

- [ ] **Step 1: componente `MapExercise.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { MapDoc, MapEditor } from "@/components/mappe/editor.js";
import { createRelation } from "@/lib/mappe/modello.js";
import {
  completionCommands, levelConcepts, levelKeyOf, levelPropositions, overlayDocument,
  type ExerciseDoc, type Solution, type SolutionRelation,
} from "@/lib/mapExerciseCore";
import type { CheckResult, LevelInfo, PropositionVerdict } from "@/lib/mapExercise";
import type { CardDraft } from "@/lib/tutor/cardGen";
import CardPreview from "./CardPreview";

const MAX = 15;
const TONE: Record<PropositionVerdict["verdict"], { background: string; color: string; label: string }> = {
  valid: { background: "var(--success-soft)", color: "var(--on-success-soft)", label: "✓ Valida" },
  imprecise: { background: "var(--warning-soft)", color: "var(--on-warning-soft)", label: "≈ Imprecisa" },
  wrong: { background: "var(--danger-soft)", color: "var(--on-danger-soft)", label: "✗ Sbagliata" },
  unrated: { background: "var(--panel-2)", color: "var(--muted)", label: "– Non valutata" },
};

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

/**
 * Pannello dell'esercizio «costruisci tu» (Fase 5) accanto alla tela: domanda focale del livello,
 * proposizioni dello studente (aggiunte con i comandi atomici dell'editor), verifica, coppie
 * mancanti, soluzione sovrapposta e completamento. La soluzione arriva dal server solo su richiesta.
 */
export default function MapExercise({ editor, mapId, domainId, levels, onLevelsChange, overlay, onShowSolution, onCloseSolution }: {
  editor: MapEditor; mapId: string; domainId: number; levels: LevelInfo[]; onLevelsChange: () => void;
  overlay: boolean; onShowSolution: (doc: MapDoc) => void; onCloseSolution: () => void;
}) {
  const [doc, setDoc] = useState(() => editor.getDocument() as unknown as ExerciseDoc);
  const [spaceId, setSpaceId] = useState(() => editor.getStatus().ui.spaceId);
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [verb, setVerb] = useState("");
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const [solution, setSolution] = useState<SolutionRelation[] | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => editor.subscribe(() => {
    setDoc(editor.getDocument() as unknown as ExerciseDoc);
    setSpaceId(editor.getStatus().ui.spaceId);
  }), [editor]);

  const levelKey = useMemo(() => { try { return levelKeyOf(doc, spaceId); } catch { return null; } }, [doc, spaceId]);
  const level = levels.find((l) => l.levelKey === levelKey) ?? null;
  const concepts = useMemo(() => levelConcepts(doc, spaceId), [doc, spaceId]);
  const props = useMemo(() => levelPropositions(doc, spaceId), [doc, spaceId]);
  const title = (id: string) => doc.concepts.find((c) => c.id === id)?.title ?? "?";
  // Cambio livello: chiude soluzione e bozza della carta.
  useEffect(() => { setSolution(null); setDraft(null); setError(""); setNotice(""); }, [levelKey]);

  if (!level) return <aside style={P.panel}><p style={P.dim}>Nessun esercizio su questo livello.</p></aside>;
  if (level.completedAt && !overlay) return <aside style={P.panel}><p style={P.focus}>{level.focusQuestion}</p><p style={P.dim}>Livello completato: è una mappa normale da ripassare.</p></aside>;

  const check: CheckResult | null = level.lastCheck;
  const verdictOf = (relId: string, label: string, s: string, t: string) => {
    const v = check?.verdicts.find((x) => x.relationId === relId);
    return v && v.label === label && v.sourceId === s && v.targetId === t ? v : null;
  };

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  }
  const saveFirst = async () => { if (editor.getStatus().dirty) await editor.save(); };

  function add() {
    if (!from || !to || from === to || !verb.trim()) return;
    editor.applyCommands([{ type: "addRelation", relation: createRelation(from, to, verb.trim().slice(0, 120)) }]);
    setVerb("");
  }
  const remove = (id: string) => editor.applyCommands([{ type: "removeRelation", id }]);

  const verify = () => run("verifica", async () => {
    await saveFirst();
    await call<CheckResult>("/api/maps/exercise/check", { mapId, spaceId });
    onLevelsChange();
  });
  const reveal = () => run("soluzione", async () => {
    const { relations } = await call<{ relations: SolutionRelation[] }>("/api/maps/exercise/reveal", { mapId, spaceId });
    setSolution(relations);
    onShowSolution(overlayDocument(doc, spaceId, { concepts: [], relations }) as unknown as MapDoc);
    onLevelsChange();
  });
  const complete = () => run("completa", async () => {
    const { solution: full } = await call<{ solution: Solution }>("/api/maps/exercise/complete", { mapId, spaceId });
    onCloseSolution();
    editor.applyCommands(completionCommands(doc, spaceId, full));
    await editor.save();
    onLevelsChange();
  });
  const card = (relationId: string) => run("carta", async () => {
    const { draft: d } = await call<{ draft: CardDraft }>("/api/maps/exercise/card", { mapId, spaceId, relationId });
    setDraft(d);
  });

  return (
    <aside style={P.panel} aria-label="Esercizio: costruisci la mappa">
      <p style={P.label}>Domanda focale</p>
      <p style={P.focus}>{level.focusQuestion}</p>

      {overlay ? (
        <>
          <p style={P.dim}>Archi pieni = i tuoi. Tratteggiati = archi della soluzione che non hai tracciato.</p>
          {solution && <p style={P.dim}>{solution.length} relazioni nella soluzione di questo livello.</p>}
          <div style={P.row}>
            <button style={P.ghost} onClick={onCloseSolution}>Torna alla tua mappa</button>
            <button style={P.primary} onClick={complete} disabled={!!busy}>{busy === "completa" ? "Completo…" : "Completa la mappa"}</button>
          </div>
        </>
      ) : (
        <>
          <form style={P.form} onSubmit={(e) => { e.preventDefault(); add(); }}>
            <select aria-label="Da" value={from} onChange={(e) => setFrom(e.target.value)} style={P.input}>
              <option value="">Da…</option>
              {concepts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <input aria-label="Verbo della relazione" placeholder="verbo (es. provoca)" value={verb} maxLength={120} onChange={(e) => setVerb(e.target.value)} style={P.input} />
            <select aria-label="A" value={to} onChange={(e) => setTo(e.target.value)} style={P.input}>
              <option value="">A…</option>
              {concepts.filter((c) => c.id !== from).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button type="submit" style={P.primary} disabled={!from || !to || from === to || !verb.trim()}>Aggiungi</button>
          </form>

          <p style={P.label}>Le tue proposizioni · {props.length}/{MAX}</p>
          {!props.length && <p style={P.dim}>Collega due concetti con un verbo che dica che rapporto c'è fra loro.</p>}
          <ul style={P.list}>
            {props.map((r) => {
              const v = verdictOf(r.id, r.label || r.predicate, r.sourceConceptId, r.targetConceptId);
              return (
                <li key={r.id} style={P.item}>
                  <div><strong>{title(r.sourceConceptId)}</strong> → {r.label || r.predicate} → <strong>{title(r.targetConceptId)}</strong></div>
                  {v && <span style={{ ...P.badge, background: TONE[v.verdict].background, color: TONE[v.verdict].color }}>{TONE[v.verdict].label}</span>}
                  {v?.reason && <p style={P.small}>{v.reason}</p>}
                  {v?.fix && <p style={P.small}><em>Correzione:</em> {v.fix}</p>}
                  <div style={P.row}>
                    <button style={P.link} onClick={() => remove(r.id)}>Rimuovi</button>
                    {v?.verdict === "wrong" && <button style={P.link} onClick={() => card(r.id)} disabled={!!busy}>Crea carta</button>}
                  </div>
                </li>
              );
            })}
          </ul>

          <div style={P.row}>
            <button style={P.primary} onClick={verify} disabled={!!busy || !props.length || props.length > MAX}>
              {busy === "verifica" ? "Verifico…" : "Verifica"}
            </button>
            <button style={P.ghost} onClick={reveal} disabled={!!busy || !check}>Mostra soluzione</button>
          </div>
          {props.length > MAX && <p style={P.error}>Massimo {MAX} proposizioni per verifica: togline qualcuna.</p>}

          {check && check.missing.length > 0 && (
            <>
              <p style={P.label}>Coppie mancanti · {check.missing.length}</p>
              <ul style={P.list}>{check.missing.map((m, i) => <li key={i} style={P.small}>{m.a} — {m.b}</li>)}</ul>
            </>
          )}
          <p style={P.small}>Se rinomini una bolla, le sue coppie non vengono più riconosciute nella verifica.</p>
        </>
      )}

      {draft && (
        <div style={{ marginTop: 10 }}>
          <CardPreview domainId={domainId} drafts={[draft]} onDone={(m) => { setDraft(null); setNotice(m); }} />
        </div>
      )}
      {notice && <p style={P.small} role="status">{notice}</p>}
      {error && <p style={P.error} role="alert">{error}</p>}
    </aside>
  );
}

const P: Record<string, React.CSSProperties> = {
  panel: { width: 340, maxWidth: "100%", flexShrink: 0, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 },
  label: { margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)" },
  focus: { margin: 0, fontWeight: 650, lineHeight: 1.4, color: "var(--text)" },
  dim: { margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 },
  small: { margin: 0, color: "var(--muted)", fontSize: 12.5, lineHeight: 1.45 },
  form: { display: "grid", gridTemplateColumns: "1fr", gap: 6 },
  input: { background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 },
  item: { background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5 },
  badge: { alignSelf: "flex-start", borderRadius: 999, padding: "2px 9px", fontSize: 12, fontWeight: 700 },
  row: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  primary: { background: "var(--accent-2)", color: "var(--button-ink)", border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 600 },
  ghost: { background: "transparent", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" },
  link: { background: "transparent", border: "none", color: "var(--muted)", padding: 0, fontSize: 12.5, textDecoration: "underline", cursor: "pointer" },
  error: { margin: 0, color: "var(--color-danger)", fontSize: 13 },
};
```

Verifica nel typecheck che `editor.applyCommands` esista nel tipo `MapEditor` di `editor.d.ts`: oggi **non** c'è (c'è solo nell'oggetto JS). Non modificare `editor.d.ts`? È un file di tipi del motore: per non toccarlo, dichiara in `MapExercise.tsx` un tipo locale
`type ExerciseEditor = MapEditor & { applyCommands(commands: unknown[]): unknown }` e usa `editor as ExerciseEditor` dove serve. Verifica in `editor.js` (riga ~458) che il metodo pubblico si chiami davvero `applyCommands`.

`disabled` del pulsante «Mostra soluzione» usa `!check` (prima serve almeno una verifica, come da piano: due livelli di esito).

- [ ] **Step 2: integrazione in `MapStudio.tsx`**

Modifiche (mantieni lo stile del file):

1. Import: `import MapExercise from "@/components/study/MapExercise";` e `import type { LevelInfo } from "@/lib/mapExercise";`.
2. Stato nuovo:
   ```ts
   const [buildMode, setBuildMode] = useState(false);
   const [levels, setLevels] = useState<LevelInfo[]>([]);
   const [ed, setEd] = useState<MapEditor | null>(null);
   const [overlay, setOverlay] = useState<MapDoc | null>(null);
   const overlayHost = useRef<HTMLDivElement>(null);
   const exerciseRef = useRef(false);
   exerciseRef.current = levels.length > 0;
   ```
3. `loadLevels`:
   ```ts
   const loadLevels = useCallback(async (mapId: string) => {
     const r = await json<{ levels: LevelInfo[] }>(`/api/maps/exercise?mapId=${encodeURIComponent(mapId)}`);
     setLevels(r.levels);
   }, []);
   ```
   Chiamala in `open(id)` dopo aver caricato la mappa e in `generate()` dopo la creazione; azzera `levels` e `overlay` quando `current` diventa `null` o cambia (in `open`, in `remove`, nell'effetto di cambio dominio).
4. Nell'effetto di mount dell'editor: `setEd(ed)` dopo `editor.current = ed`, `setEd(null)` nel cleanup; l'adattatore `expandConcept` diventa:
   ```ts
   expandConcept: async (req) => {
     if (!exerciseRef.current) return json("/api/maps/expand", {
       method: "POST",
       body: JSON.stringify({ domainId: domainRef.current, concept: req.concept, path: req.path, existing: req.existing, present: req.present }),
     });
     const proposal = await json<Proposal>("/api/maps/exercise/expand", {
       method: "POST",
       body: JSON.stringify({ mapId: req.mapId, domainId: domainRef.current, conceptId: req.conceptId, concept: req.concept, path: req.path, existing: req.existing, present: req.present }),
     });
     loadLevels(req.mapId).catch(() => {});
     return proposal;
   },
   ```
   (importa il tipo `Proposal` da `./editor.js`).
5. `generate()`: se `buildMode`, `POST /api/maps/exercise` al posto di `/api/maps`; poi `setCurrent(map)` e `loadLevels(map.id)`.
6. Barra: dopo l'input dell'argomento, prima di «Genera mappa»:
   ```tsx
   <label style={S.check}><input type="checkbox" checked={buildMode} onChange={(e) => setBuildMode(e.target.checked)} disabled={!domainId || busy} /> Costruisci tu</label>
   ```
   e il testo del pulsante diventa `buildMode ? "Crea esercizio" : "Genera mappa"`. Nel `<select>` delle mappe: `{m.exercise ? "✎ " : ""}{m.title}`. Aggiungi a `S`: `check: { display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 13 }`.
7. Effetto per la vista soluzione:
   ```ts
   useEffect(() => {
     if (!overlay || !overlayHost.current) return;
     const view = mount(overlayHost.current, { document: overlay, readOnly: true });
     return () => view.destroy();
   }, [overlay]);
   ```
8. Rendering dell'area mappa (al posto di `<div ref={host} style={S.host} />`):
   ```tsx
   <div style={S.studio}>
     <div ref={host} style={{ ...S.host, display: overlay ? "none" : undefined }} />
     {overlay && <div ref={overlayHost} style={S.host} />}
     {ed && levels.length > 0 && current && domainId && (
       <MapExercise editor={ed} mapId={current.id} domainId={domainId} levels={levels}
         onLevelsChange={() => loadLevels(current.id).catch((e) => setError(String(e)))}
         overlay={!!overlay} onShowSolution={setOverlay} onCloseSolution={() => setOverlay(null)} />
     )}
   </div>
   ```
   con `studio: { flex: 1, minHeight: 0, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }` e `host` che acquisisce `flex: "1 1 520px", minWidth: 0`. Sotto `md` il pannello va a capo sotto la tela grazie a `flexWrap` (larghezza 340, `maxWidth: 100%`).
9. Testo vuoto (`S.empty`): aggiungi in coda «Con «Costruisci tu» vedi solo i concetti: le relazioni le tracci tu, poi le verifichi.»

- [ ] **Step 3: typecheck e test**

Run: `npm run typecheck && npm test`
Expected: PASS. (La verifica dal vivo la fa il controller dopo il Task 8, con Playwright.)

- [ ] **Step 4: build su DB temporaneo**

Run: `DB_PATH=$(mktemp -d)/build.db npm run build`
Expected: build riuscita (nessun import server nel bundle client: se fallisce per `better-sqlite3` nel client, controlla che `MapExercise.tsx` importi da `@/lib/mapExercise` **solo** con `import type`).

- [ ] **Step 5: commit**

```bash
git add src/components/study/MapExercise.tsx src/components/mappe/MapStudio.tsx
git commit -m "UI degli esercizi sulle mappe: pannello proposizioni, verifica, soluzione sovrapposta, completa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Eval `maps`

**Files:**
- Create: `src/lib/evals/maps.ts`
- Modify: `scripts/eval.ts`
- Modify: `evals/README.md`
- Test: `tests/eval-maps.test.ts`

**Interfaces:**
- Consumes: `judgePropositions`, `PROMPT_VERSION` (Task 5); `proposeMap` (Task 3).
- Produces:
  - `export const KINDS = ["same", "absent-valid", "vague", "inverted", "wrong"] as const`
  - `export interface MapCaseProposition { id: string; from: string; label: string; to: string; gold: Verdict; kind: (typeof KINDS)[number] }`
  - `export interface MapCase { id: string; course: string; topic: string; focusQuestion: string; concepts: { title: string; definition: string }[]; solution: { from: string; label: string; to: string }[]; passages: { n: number; chunkId: number; text: string }[]; propositions: MapCaseProposition[] }`
  - `export function parseMapCases(text: string, { requirePropositions = true } = {}): MapCase[]`
  - `export function referenceFor(c: MapCase, p: MapCaseProposition): string | undefined` (formulazione di riferimento se la coppia non ordinata è nella soluzione, con `titleKey`)
  - `export interface MapOutcome { caseId: string; propId: string; kind: string; gold: Verdict; got: Verdict | "unrated" | "error" }`
  - `export function mapMetrics(rows: MapOutcome[]): { total: number; agreement: number; confusion: Record<string, Record<string, number>>; byKind: Record<string, { n: number; agree: number }>; absentValidRejected: number; absentValid: number }`

- [ ] **Step 1: test che falliscono**

`tests/eval-maps.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapMetrics, parseMapCases, referenceFor } from "@/lib/evals/maps";

const CASE = {
  id: "m1", course: "C", topic: "React", focusQuestion: "D?",
  concepts: [{ title: "State", definition: "d" }, { title: "Rendering", definition: "d" }],
  solution: [{ from: "State", label: "provoca", to: "Rendering" }],
  passages: [{ n: 1, chunkId: 10, text: "Lo state provoca il rendering." }],
  propositions: [
    { id: "p1", from: "Rendering", label: "dipende da", to: "state", gold: "valid", kind: "same" },
    { id: "p2", from: "State", label: "riguarda", to: "Rendering", gold: "imprecise", kind: "vague" },
  ],
};

test("parseMapCases: valida i campi e rifiuta kind/gold sconosciuti e id duplicati", () => {
  assert.equal(parseMapCases(JSON.stringify(CASE)).length, 1);
  assert.throws(() => parseMapCases(JSON.stringify({ ...CASE, propositions: [{ ...CASE.propositions[0], gold: "forse" }] })), /gold/);
  assert.throws(() => parseMapCases(JSON.stringify({ ...CASE, propositions: [{ ...CASE.propositions[0], kind: "boh" }] })), /kind/);
  assert.throws(() => parseMapCases([JSON.stringify(CASE), JSON.stringify(CASE)].join("\n")), /duplicato/);
  assert.equal(parseMapCases(JSON.stringify({ ...CASE, propositions: [] }), { requirePropositions: false }).length, 1);
  assert.throws(() => parseMapCases(JSON.stringify({ ...CASE, propositions: [] })), /propositions/);
});

test("referenceFor: coppia non ordinata, titoli normalizzati", () => {
  const c = parseMapCases(JSON.stringify(CASE))[0];
  assert.equal(referenceFor(c, c.propositions[0]), "State provoca Rendering");
});

test("mapMetrics: accordo, confusione, per kind e absent-valid bocciate", () => {
  const m = mapMetrics([
    { caseId: "m1", propId: "p1", kind: "same", gold: "valid", got: "valid" },
    { caseId: "m1", propId: "p2", kind: "vague", gold: "imprecise", got: "valid" },
    { caseId: "m1", propId: "p3", kind: "absent-valid", gold: "valid", got: "wrong" },
    { caseId: "m1", propId: "p4", kind: "absent-valid", gold: "valid", got: "valid" },
  ]);
  assert.equal(m.total, 4);
  assert.equal(m.agreement, 0.5);
  assert.equal(m.confusion.imprecise.valid, 1);
  assert.deepEqual(m.byKind["absent-valid"], { n: 2, agree: 1 });
  assert.equal(m.absentValidRejected, 1);
  assert.equal(m.absentValid, 2);
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx tsx --test tests/eval-maps.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/lib/evals/maps.ts`**

Segui lo stile di `src/lib/evals/tutor.ts` (righe JSONL, `//` = commento, errori `maps.jsonl riga N: …`). Implementa:

```ts
/**
 * Set di valutazione delle mappe-esercizio (Fase 5): proposizioni scritte su mappe generate dai
 * corsi, con il verdetto di riferimento deciso sui passaggi. Misura quanto il valutatore
 * (`judgePropositions`, prompt maps-vN) coincide: obiettivo ≥ 80% di accordo esatto.
 * Logica pura: `scripts/eval.ts` chiama il modello.
 */
import { titleKey } from "@/lib/mappe/proposte.js";
import type { Verdict } from "@/lib/mapExercise";

export const KINDS = ["same", "absent-valid", "vague", "inverted", "wrong"] as const;
const VERDICTS = ["valid", "imprecise", "wrong"] as const;

export interface MapCaseProposition { id: string; from: string; label: string; to: string; gold: Verdict; kind: (typeof KINDS)[number] }
export interface MapCase {
  id: string; course: string; topic: string; focusQuestion: string;
  concepts: { title: string; definition: string }[];
  solution: { from: string; label: string; to: string }[];
  passages: { n: number; chunkId: number; text: string }[];
  propositions: MapCaseProposition[];
}
export interface MapOutcome { caseId: string; propId: string; kind: string; gold: Verdict; got: Verdict | "unrated" | "error" }

export function parseMapCases(text: string, { requirePropositions = true } = {}): MapCase[] {
  const seen = new Set<string>();
  const out: MapCase[] = [];
  text.split("\n").forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("//")) return;
    const fail = (why: string): never => { throw new Error(`maps.jsonl riga ${i + 1}: ${why}`); };
    let c: Record<string, unknown>;
    try { c = JSON.parse(raw); } catch { return fail("JSON non valido"); }
    for (const k of ["id", "course", "topic", "focusQuestion"]) if (typeof c[k] !== "string" || !(c[k] as string).trim()) fail(`${k} deve essere una stringa non vuota`);
    if (!Array.isArray(c.concepts) || !Array.isArray(c.solution) || !Array.isArray(c.passages)) fail("concepts, solution e passages devono essere elenchi");
    const props = (c.propositions ?? []) as Record<string, unknown>[];
    if (!Array.isArray(props) || (requirePropositions && !props.length)) fail("propositions deve essere un elenco non vuoto");
    const ids = new Set<string>();
    for (const p of props) {
      for (const k of ["id", "from", "label", "to"]) if (typeof p[k] !== "string" || !(p[k] as string).trim()) fail(`proposizione: ${k} mancante`);
      if (!(VERDICTS as readonly unknown[]).includes(p.gold)) fail(`proposizione ${p.id}: gold deve essere valid, imprecise o wrong`);
      if (!(KINDS as readonly unknown[]).includes(p.kind)) fail(`proposizione ${p.id}: kind sconosciuto`);
      if (ids.has(p.id as string)) fail(`proposizione ${p.id} duplicata`);
      ids.add(p.id as string);
    }
    if (seen.has(c.id as string)) fail(`id duplicato ${c.id}`);
    seen.add(c.id as string);
    out.push(c as unknown as MapCase);
  });
  return out;
}

/** La formulazione di riferimento della soluzione per la stessa coppia (direzione ignorata), se c'è. */
export function referenceFor(c: MapCase, p: MapCaseProposition): string | undefined {
  const key = (a: string, b: string) => [titleKey(a), titleKey(b)].sort().join("|");
  const r = c.solution.find((s) => key(s.from, s.to) === key(p.from, p.to));
  return r ? `${r.from} ${r.label} ${r.to}` : undefined;
}

export function mapMetrics(rows: MapOutcome[]) {
  const confusion: Record<string, Record<string, number>> = {};
  const byKind: Record<string, { n: number; agree: number }> = {};
  let agree = 0, absentValid = 0, absentValidRejected = 0;
  for (const r of rows) {
    const ok = r.got === r.gold;
    if (ok) agree++;
    (confusion[r.gold] ??= {})[r.got] = (confusion[r.gold][r.got] ?? 0) + 1;
    const k = (byKind[r.kind] ??= { n: 0, agree: 0 });
    k.n++; if (ok) k.agree++;
    if (r.kind === "absent-valid") { absentValid++; if (r.got === "wrong") absentValidRejected++; }
  }
  return { total: rows.length, agreement: rows.length ? agree / rows.length : 0, confusion, byKind, absentValidRejected, absentValid };
}
```

- [ ] **Step 4: comandi in `scripts/eval.ts`**

1. Nell'intestazione d'uso aggiungi:
   ```
    *   npm run eval -- maps [--limit N]               valuta le proposizioni di maps.jsonl (accordo col verdetto di riferimento)
    *   npm run eval -- maps --build <db> [--force]    bozza maps.draft.jsonl: 6 mappe in modalità build da 3 corsi (DB in sola lettura)
   ```
2. Import: `import { judgePropositions, PROMPT_VERSION as MAPS_VERSION } from "@/lib/mapExercise";`, `import { proposeMap } from "@/lib/conceptmap";`, `import { mapMetrics, parseMapCases, referenceFor, type MapOutcome } from "@/lib/evals/maps";`.
3. `sampleModules(dbPath)` (sola lettura, come `samplePassages`): i 3 domini con più chunk (`d.kind IN ('transcript','html','pdf','text')`), per ciascuno 2 moduli distinti da `json_extract(d.meta, '$.module')` (non nulli, i due con più chunk), per ogni modulo fino a 14 chunk con `length(content) >= 300`, al massimo 3 per documento, ordinati per `d.id, c.ordinal`. Restituisce `{ course: {id, name}, topic, chunks: Retrieved[] }[]`; `topic` = nome del modulo senza prefissi numerici e trattini bassi (`.replace(/^[\d\s._-]+/, "").replace(/_/g, " ").trim()`). Ogni `Retrieved` = `{ chunkId: id, documentId, content, distance: 0, source, docKind: kind, docMeta: JSON.parse(meta ?? "{}"), meta: chunkMeta ? JSON.parse(chunkMeta) : undefined }`.
4. `buildMaps(dbPath, force)`: `out = evals/data/maps.draft.jsonl` (rifiuta se esiste senza `--force`); per ogni modulo `await proposeMap(course.id, topic, chunks, { build: true })` (try/catch per caso: in errore stampa e prosegue); scrive una riga per caso `{ id: \`m${course.id}-${k}\`, course: course.name, topic, focusQuestion, concepts: [{title, definition}], solution: relations, passages: chunks.map((c, i) => ({ n: i + 1, chunkId: c.chunkId, text: c.content.slice(0, 1500) })), propositions: [] }`. Stampa: «ora scrivi le proposizioni e salva come evals/data/maps.jsonl (vedi evals/README.md)».
5. `runMaps(args)`: `--build <db>` → `buildMaps`. Altrimenti legge `evals/data/maps.jsonl` (`parseMapCases`), `--limit N` sui casi; stampa `maps · N casi · M proposizioni · prompt ${MAPS_VERSION} · modello ${models.grade.model}`; per ogni caso divide le proposizioni a blocchi di 15, chiama `judgePropositions({ focusQuestion, propositions: blocco.map((p) => ({ id: p.id, from: p.from, label: p.label, to: p.to, reference: referenceFor(c, p) })), passages: c.passages.map((p) => p.text) })`, mappa gli esiti in `MapOutcome` (`unrated` se manca, `error` per tutto il blocco se la chiamata lancia), stampa una riga per caso con l'accordo e i disaccordi (`p3: gold valid, got wrong`). Alla fine: accordo esatto con obiettivo ≥ 80%, accordo per `kind`, `absent-valid bocciate X/Y`, matrice di confusione; salva `evals/results/maps-<ISO>.json` con `{ promptVersion, model, runAt, metrics, rows }` come fanno gli altri eval.
6. In `main()`: `if (module === "maps") return runMaps(args);`, togli `maps` da `LATER` (se `LATER` resta vuoto, rimuovi la costante e il suo `if`), e aggiungi `maps [--limit N] | maps --build <db>` al messaggio d'uso.

- [ ] **Step 5: `evals/README.md`**

Aggiungi una sezione «Mappe (`maps`, Fase 5)» con: comandi (`DB_PATH=<file temporaneo> npm run eval -- maps --build data/studybuddy.db`, poi la scrittura di `maps.jsonl`, poi `DB_PATH=<file temporaneo> npm run eval -- maps`); formato di una riga (i campi di `MapCase`); i cinque `kind`; il criterio dei verdetti (le regole di `JUDGE_SYSTEM`: valid se il materiale sostiene il legame anche fuori dalla soluzione, imprecise se verbo vago o sbagliato o direzione invertita, wrong se non sostenuto o contraddetto); obiettivo ≥ 80% e la metrica `absent-valid bocciate`. Spiega perché `DB_PATH` temporaneo: lo script importa `@/lib/db`, che all'apertura esegue le migrazioni.

- [ ] **Step 6: test verdi**

Run: `npx tsx --test tests/eval-maps.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: commit**

```bash
git add src/lib/evals/maps.ts scripts/eval.ts evals/README.md tests/eval-maps.test.ts
git commit -m "Eval maps: set maps.jsonl, accordo col verdetto di riferimento, bozza in modalità build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9 (controller): set, eval, verifica dal vivo, documentazione

Lo esegue il controller (non un subagent), perché richiede giudizio sul materiale.

- [ ] **Step 1:** `DB_PATH=<scratch>/eval.db npm run eval -- maps --build data/studybuddy.db` (DB reale aperto **in sola lettura** da `better-sqlite3 { readonly: true }`).
- [ ] **Step 2:** scrivere `evals/data/maps.jsonl`: per ogni caso ~10 proposizioni (≥ 2 per `kind`, distribuite), `gold` deciso leggendo i passaggi del caso; le `absent-valid` devono essere sostenute da un passaggio citabile.
- [ ] **Step 3:** `DB_PATH=<scratch>/eval.db npm run eval -- maps` due volte. Se l'accordo è < 80%, analizzare i disaccordi per `kind`, correggere `JUDGE_SYSTEM` (bump `PROMPT_VERSION` → `maps-v2`…) e rimisurare.
- [ ] **Step 4:** verifica con Playwright su DB e cartella-libreria temporanei (mini-corso sintetico, Ollama vero, `npm run dev` con `DB_PATH` e `STUDYBUDDY_LIBRARY_DIR` temporanei): crea esercizio, aggiungi 3 proposizioni (una giusta, una vaga, una sbagliata), Verifica, coppie mancanti, Crea carta sulla sbagliata → salvata, Mostra soluzione (tratteggiati), Torna, Completa la mappa (archi e spiegazioni), entra in una bolla (sottolivello solo concetti, domanda focale nuova).
- [ ] **Step 5:** `npm run colors:check` (nessun colore nuovo: deve restare exit 0), `npm test`, `npm run typecheck`, `DB_PATH=<tmp> npm run build`.
- [ ] **Step 6:** CLAUDE.md (stato attuale: modalità «costruisci tu»; nota tecnica Fase 5 con i risultati dell'eval; `maps` nell'elenco dei `PROMPT_VERSION` e nei comandi eval), memoria di progetto aggiornata. Commit.
- [ ] **Step 7:** revisione finale dell'intero branch (subagent reviewer), poi resoconto all'utente: **niente merge né push** senza il suo ok.
