# Libreria corsi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare StudyBuddy da "pagina unica del corso attuale" a una app con Libreria (corsi raggruppati per area, macro → corsi), area studio per corso/macro, e import dalla UI con analisi della cartella-libreria e anteprima modificabile.

**Architecture:** La logica sta in `src/lib/*` (`library.ts` = lettura/organizzazione dei domini, `ingestPlan.ts` = analisi delle cartelle, `ingestTree.ts` = esecuzione di un piano esplicito); le route `src/app/api/*` sono thin wrapper. Pagine App Router: `/` Libreria (Server Component che legge SQLite), `/study/[id]?mode=` (shell client con le viste di studio estratte da `page.tsx`), `/add` (wizard client). Test con `node:test` via `tsx --test` su DB SQLite temporanei.

**Tech Stack:** Next 16 (App Router, Turbopack), React 19.3, TypeScript 7, drizzle-orm 0.45 + better-sqlite3 13, Tailwind v4 (nuovo), `@fontsource-variable/*` (nuovo), `node:test` + tsx.

**Spec:** `docs/superpowers/specs/2026-10-08-libreria-corsi-design.md` — leggila prima di iniziare.

## Global Constraints

- App **generica**: nessun codice, prompt, default o test pensato per un corso specifico (niente "Meta" nel codice; nei test usare nomi inventati).
- Il materiale dei corsi (`Courses/`) e `learning-vault/` **non si committano mai**. Usare sempre `git add <file espliciti>`, mai `git add .` / `-A`.
- La logica sta in `src/lib/*`; le route in `src/app/api/*` sono thin wrapper. Le route che toccano il DB hanno `export const runtime = "nodejs"`.
- Tutte le scritture `/api/*` dal client devono avere `Content-Type: application/json` (lo impone `src/proxy.ts`), anche `DELETE`.
- Ogni percorso che arriva dal client passa da `insideRoot()` di `src/lib/fsRoot.ts` (403 se fuori).
- Path costruiti da `process.cwd()` per file runtime: `path.resolve(/* turbopackIgnore: true */ process.cwd(), …)` (altrimenti la build Turbopack fallisce).
- Gerarchia a **2 livelli**: un `macro` non ha genitore; il genitore di un `course` è `null` o un `macro`. I documenti stanno solo sui `course`.
- **Aree** = solo layout: nessun modulo di retrieval/ripasso/mappe le legge.
- Un dominio esistente cambia `name`/`parentId`/`areas` solo da un'azione in Libreria o da un piano esplicito dell'anteprima; mai da una deduzione automatica sulle cartelle.
- Testo UI in italiano. Commenti nel codice in italiano, densità come il codice esistente.
- Non lanciare `npm run db:push` sul DB reale: le tabelle virtuali (`vec_chunks`, `chunks_fts`) non sono nello schema Drizzle. Le migrazioni del DB reale si fanno con SQL esplicito dopo un backup (Task 2).
- Commit alla fine di ogni task, messaggio in italiano, che termina con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Nomi di cartella con spazi, apostrofi, accenti** (`Corso dell'Arte è`): analisi, import e link video devono funzionare; un errore qui rende invisibile un corso reale. → test in Task 4.
2. **Percorsi fuori sandbox nel piano o nell'analisi** (`/etc`, `~/../x`): devono dare 403, mai essere letti o ingeriti. → test in Task 5 (`parsePlan`).
3. **Secondo import mentre uno è in corso**: 409 e la UI mostra quello in corso, invece di due ingest paralleli sullo stesso DB. → test in Task 5 (`activeJob`).
4. **Corso spostato a mano e cartella re-importata**: l'organizzazione manuale resta (macro, nome, aree). → test in Task 5 (`applyPlan` dopo `updateDomain`).
5. **URL dell'area studio con id inesistente o `mode` invalido**: 404 per l'id, `tutor` per il mode. → test in Task 7 (`parseMode`) + verifica manuale in Task 9.

---

## File Structure

Nuovi:
- `tests/helpers/db.ts` — DB temporaneo con lo schema Drizzle (via `drizzle-kit/api`).
- `tests/helpers/fs.ts` — crea alberi di cartelle-fixture.
- `tests/*.test.ts` — test per modulo.
- `scripts/create-db.ts` — crea un DB nuovo vuoto con lo schema (serve alla verifica e2e e a "re-indicizza su un DB nuovo").
- `src/lib/library.ts` — lettura della libreria + mutazioni con invarianti (`LibraryError`).
- `src/lib/libraryDir.ts` — percorso della cartella-libreria.
- `src/lib/ingestPlanTypes.ts` — tipi del piano + `defaultPlan`/`groupIntoNewMacro` (puro, importabile dal client).
- `src/lib/ingestPlan.ts` — classificazione macro/corso, analisi cartelle, rilevamento nuovi corsi (server).
- `src/lib/client/api.ts` — `api()`/`post()` per il client.
- `src/app/api/library/route.ts`, `src/app/api/ingest-folder/analyze/route.ts`.
- `src/app/study/[id]/page.tsx`, `src/app/add/page.tsx`.
- `src/components/library/{LibraryView,DomainMenu,AreaInput,NewMacroButton}.tsx`.
- `src/components/study/{StudyShell,TutorView,ReviewView,StudioView,Markdown}.tsx`, `src/components/study/{types,styles,modes}.ts`.
- `src/components/add/{AddWizard,PlanEditor,FolderBrowser,ImportProgress}.tsx`.
- `postcss.config.mjs`.

Modificati:
- `tsconfig.json` (escludi `learning-vault`), `package.json` (script `test`, dipendenze).
- `src/lib/db/schema.ts` (`domains.areas`, tabella `ingested_files`).
- `src/lib/rag/sources/coursera.ts` (export helper, registra `ingested_files`).
- `src/lib/ingestTree.ts` (piano esplicito: `parsePlan`, `applyPlan`, `runPlan`; via `ingestSelection`).
- `src/lib/jobs.ts` (`activeJob`).
- `src/app/api/ingest-folder/route.ts`.
- `src/app/page.tsx` (diventa la Libreria), `src/app/layout.tsx`, `src/app/globals.css`.
- `CLAUDE.md`.

Eliminati: `src/app/api/domains/route.ts` (sostituita da `getLibrary`; unico consumatore era il vecchio `page.tsx`).

---

### Task 1: Infrastruttura di test e typecheck pulito

**Files:**
- Modify: `tsconfig.json`
- Modify: `package.json` (scripts)
- Create: `tests/helpers/db.ts`, `tests/helpers/fs.ts`, `tests/db.test.ts`
- Create: `scripts/create-db.ts`

**Interfaces:**
- Produces: `useTempDb(): Promise<{ dir: string; sqlite: import("better-sqlite3").Database }>` — da chiamare **prima** di importare (dinamicamente) qualsiasi modulo che usa `@/lib/db`; imposta `process.env.DB_PATH` su un file temporaneo e crea tutte le tabelle dello schema Drizzle. `makeTree(root: string, files: Record<string, string>): void`. Script `npm test`.

Contesto: `npm run typecheck` oggi fallisce con ~95 errori perché `tsconfig.json` include `**/*.ts` e quindi anche `learning-vault/` (un altro progetto copiato nella root). `@/lib/db` apre il DB **all'import** leggendo `DB_PATH`, per questo i test importano i moduli dinamicamente dopo `useTempDb()`. `node --test` esegue ogni file in un processo separato: un DB temporaneo per file.

- [ ] **Step 1: Escludi learning-vault dal typecheck**

In `tsconfig.json` sostituisci il blocco `exclude`:

```json
  "exclude": [
    "node_modules",
    "learning-vault"
  ]
```

Run: `npm run typecheck`
Expected: nessun errore (exit 0).

- [ ] **Step 2: Aggiungi lo script di test**

In `package.json`, dentro `"scripts"`, dopo `"typecheck"`:

```json
    "typecheck": "tsc --noEmit",
    "test": "tsx --test tests/*.test.ts"
```

- [ ] **Step 3: Scrivi gli helper**

`tests/helpers/db.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * DB SQLite temporaneo con lo schema Drizzle. Va chiamato PRIMA di importare
 * (dinamicamente) i moduli che usano "@/lib/db": quel modulo apre `DB_PATH` all'import.
 * `node --test` esegue ogni file in un processo a sé, quindi un DB per file di test.
 */
export async function useTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  const { sqlite } = await import("@/lib/db");
  const schema = await import("@/lib/db/schema");
  const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import("drizzle-kit/api");
  const prev = await generateSQLiteDrizzleJson({});
  const cur = await generateSQLiteDrizzleJson({ ...schema });
  for (const stmt of await generateSQLiteMigration(prev, cur)) sqlite.exec(stmt);
  return { dir, sqlite };
}
```

`tests/helpers/fs.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

/** Crea file (e cartelle intermedie) sotto `root`: { "a/b/c.srt": "contenuto" }. */
export function makeTree(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
```

- [ ] **Step 4: Scrivi lo smoke test**

`tests/db.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

test("il DB temporaneo ha le tabelle dello schema", async () => {
  const { sqlite } = await useTempDb();
  const names = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  for (const t of ["domains", "documents", "chunks", "cards", "sessions", "concept_maps"]) {
    assert.ok(names.includes(t), `manca la tabella ${t}`);
  }
});
```

- [ ] **Step 5: Esegui**

Run: `npm test`
Expected: `ℹ pass 1`, `ℹ fail 0`.

- [ ] **Step 6: Script per creare un DB nuovo**

`scripts/create-db.ts`:

```ts
/**
 * Crea un DB nuovo con lo schema Drizzle (tabelle "normali"; vec0 e FTS5 le crea
 * l'app al primo uso). Rifiuta di toccare un file esistente.
 *
 *   DB_PATH=/percorso/nuovo.db npx tsx scripts/create-db.ts
 */
import fs from "node:fs";

async function main() {
  const target = process.env.DB_PATH;
  if (!target) throw new Error("DB_PATH richiesto");
  if (fs.existsSync(target)) throw new Error(`${target} esiste già: non lo tocco`);
  const { sqlite } = await import("@/lib/db");
  const schema = await import("@/lib/db/schema");
  const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import("drizzle-kit/api");
  const prev = await generateSQLiteDrizzleJson({});
  const cur = await generateSQLiteDrizzleJson({ ...schema });
  for (const stmt of await generateSQLiteMigration(prev, cur)) sqlite.exec(stmt);
  console.log(`Creato ${target}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

Run: `DB_PATH=/tmp/sb-create-check.db npx tsx scripts/create-db.ts && rm /tmp/sb-create-check.db*`
Expected: `Creato /tmp/sb-create-check.db`.

- [ ] **Step 7: Commit**

```bash
git add tsconfig.json package.json tests/helpers/db.ts tests/helpers/fs.ts tests/db.test.ts scripts/create-db.ts
git commit -m "Test con node:test su DB temporaneo; typecheck esclude learning-vault

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Schema (aree, ingested_files) e `lib/library.ts`

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/library.ts`
- Test: `tests/library.test.ts`

**Interfaces:**
- Consumes: `useTempDb()` (Task 1).
- Produces (da `src/lib/library.ts`):
  - `class LibraryError extends Error { status: number }`
  - `interface CourseNode { id: number; name: string; path: string | null; areas: string[]; docs: number; due: number }`
  - `interface MacroNode { id: number; name: string; path: string | null; areas: string[]; docs: number; due: number; courses: CourseNode[] }`
  - `interface Library { macros: MacroNode[]; loose: CourseNode[]; areas: string[] }`
  - `interface Trail { id: number; name: string; kind: "macro" | "course"; macro: { id: number; name: string } | null; courses: { id: number; name: string }[] }`
  - `getLibrary(): Library`, `getTrail(id: number): Trail | null`
  - `cleanName(name: unknown): string`, `normalizeAreas(areas: unknown): string[]`
  - `findByPath(path: string): { id: number; kind: string; parentId: number | null; name: string; areas: string[] } | undefined`
  - `updateDomain(id: number, patch: { name?: unknown; areas?: unknown; parentId?: unknown }): void`
  - `createMacro(name: unknown, areas?: unknown, courseIds?: unknown, path?: string | null): number`
  - `createCourse(name: unknown, path: string, parentId: number | null, areas?: unknown): number`
  - `deleteMacro(id: number): void`
  - schema: `domains.areas` (JSON `string[]`), tabella `ingestedFiles` (`ingested_files`: `domain_id`, `source`, `file_hash`, PK composta).

Note: `cards.due_at` e `domains.created_at` sono timestamp Drizzle in **secondi**. Le query raw usano `sqlite` da `@/lib/db` come fa già `rag/store.ts`.

- [ ] **Step 1: Schema**

In `src/lib/db/schema.ts` cambia l'import e aggiungi la colonna e la tabella:

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, primaryKey } from "drizzle-orm/sqlite-core";
```

Nel blocco `domains`, dopo `path`:

```ts
  path: text("path"),                               // cartella sorgente su disco
  // Aree (tag) della Libreria: SOLO layout, nessun effetto su retrieval/ripasso/mappe.
  areas: text("areas", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
```

Dopo la tabella `documents`:

```ts
/**
 * Ogni file elaborato da `ingestCourse`, anche quelli che non producono documenti
 * (vuoti o con chunk tutti duplicati). L'analisi dell'import confronta gli hash con
 * questa tabella: con i soli `documents` quei file risulterebbero "nuovi" per sempre.
 */
export const ingestedFiles = sqliteTable("ingested_files", {
  domainId: integer("domain_id").notNull().references(() => domains.id),
  source: text("source").notNull(),
  fileHash: text("file_hash").notNull(),
}, (t) => [primaryKey({ columns: [t.domainId, t.source] })]);
```

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 2: Scrivi i test (falliscono)**

`tests/library.test.ts`:

```ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

let L: typeof import("@/lib/library");
let sqlite: import("better-sqlite3").Database;

before(async () => {
  ({ sqlite } = await useTempDb());
  L = await import("@/lib/library");
});

const now = () => Math.floor(Date.now() / 1000);

test("getLibrary: macro con figli, corsi sciolti, carte in scadenza aggregate", () => {
  const m = L.createMacro("Specializzazione X", ["Web"]);
  const a = L.createCourse("Corso A", "/tmp/x/a", m);
  const b = L.createCourse("Corso B", "/tmp/b", null, ["Data", "Web"]);
  sqlite.prepare("INSERT INTO cards (domain_id, question, answer, due_at) VALUES (?, 'q', 'a', ?)").run(a, now() - 10);
  sqlite.prepare("INSERT INTO cards (domain_id, question, answer, due_at) VALUES (?, 'q', 'a', ?)").run(a, now() + 86400);
  const lib = L.getLibrary();
  const macro = lib.macros.find((x) => x.id === m)!;
  assert.equal(macro.courses.length, 1);
  assert.equal(macro.courses[0].id, a);
  assert.equal(macro.due, 1);
  assert.ok(lib.loose.some((c) => c.id === b));
  assert.deepEqual(lib.areas, ["Data", "Web"]);
});

test("getTrail: corso dentro macro, macro con i suoi corsi, id sconosciuto", () => {
  const m = L.createMacro("Macro T");
  const c = L.createCourse("Corso T", "/tmp/t", m);
  assert.deepEqual(L.getTrail(c)?.macro, { id: m, name: "Macro T" });
  assert.equal(L.getTrail(m)?.kind, "macro");
  assert.deepEqual(L.getTrail(m)?.courses, [{ id: c, name: "Corso T" }]);
  assert.equal(L.getTrail(999999), null);
});

test("invarianti: niente macro dentro macro, niente corso dentro corso", () => {
  const m1 = L.createMacro("M1");
  const m2 = L.createMacro("M2");
  const c = L.createCourse("C", "/tmp/c", null);
  assert.throws(() => L.updateDomain(m1, { parentId: m2 }), L.LibraryError);
  const c2 = L.createCourse("C2", "/tmp/c2", null);
  assert.throws(() => L.updateDomain(c2, { parentId: c }), L.LibraryError);
  L.updateDomain(c, { parentId: m1 });
  L.updateDomain(c, { parentId: null });
  assert.equal(L.findByPath("/tmp/c")?.parentId, null);
});

test("nome e aree: validazione e normalizzazione", () => {
  const c = L.createCourse("Nome", "/tmp/n", null);
  assert.throws(() => L.updateDomain(c, { name: "   " }), L.LibraryError);
  L.updateDomain(c, { name: "  Nuovo   nome ", areas: [" web ", "Web", "", 3, "Data"] });
  const d = L.findByPath("/tmp/n")!;
  assert.equal(d.name, "Nuovo nome");
  assert.deepEqual(d.areas, ["web", "Data"]);
});

test("createMacro con corsi dentro; deleteMacro rende sciolti i figli", () => {
  const c = L.createCourse("Figlio", "/tmp/f", null);
  const m = L.createMacro("Da eliminare", [], [c]);
  assert.equal(L.findByPath("/tmp/f")?.parentId, m);
  L.deleteMacro(m);
  assert.equal(L.findByPath("/tmp/f")?.parentId, null);
  assert.equal(L.getTrail(m), null);
});

test("deleteMacro bloccato se il macro ha carte/mappe/sessioni proprie; vietato sui corsi", () => {
  const m = L.createMacro("Con sessione");
  sqlite.prepare("INSERT INTO sessions (domain_id, mode) VALUES (?, 'socratic')").run(m);
  assert.throws(() => L.deleteMacro(m), (e: unknown) => e instanceof L.LibraryError && e.status === 409);
  const c = L.createCourse("Corso", "/tmp/cc", null);
  assert.throws(() => L.deleteMacro(c), L.LibraryError);
});

test("id inesistente → LibraryError 404", () => {
  assert.throws(() => L.updateDomain(424242, { name: "x" }), (e: unknown) => e instanceof L.LibraryError && e.status === 404);
});
```

Run: `npm test`
Expected: FAIL (`Cannot find module '@/lib/library'` o simile).

- [ ] **Step 3: Implementa `src/lib/library.ts`**

```ts
import { sqlite } from "@/lib/db";

/**
 * Libreria: lettura dei domini per la UI e organizzazione manuale (rinomina, aree,
 * sposta in macro). Gerarchia a 2 livelli: macro → corsi. Le aree sono solo layout.
 * Ogni mutazione valida gli invarianti e lancia `LibraryError` (status HTTP incluso).
 */
export class LibraryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface CourseNode { id: number; name: string; path: string | null; areas: string[]; docs: number; due: number }
export interface MacroNode { id: number; name: string; path: string | null; areas: string[]; docs: number; due: number; courses: CourseNode[] }
export interface Library { macros: MacroNode[]; loose: CourseNode[]; areas: string[] }
export interface Trail {
  id: number;
  name: string;
  kind: "macro" | "course";
  macro: { id: number; name: string } | null;
  courses: { id: number; name: string }[];
}

interface Row { id: number; name: string; kind: string; parentId: number | null; path: string | null; areas: string | null; docs: number; due: number }

const nowSec = () => Math.floor(Date.now() / 1000);

function parseAreas(raw: string | null): string[] {
  try {
    const a = JSON.parse(raw ?? "[]");
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rows(): Row[] {
  return sqlite.prepare(
    `SELECT d.id, d.name, d.kind, d.parent_id AS parentId, d.path, d.areas,
            (SELECT count(*) FROM documents x WHERE x.domain_id = d.id) AS docs,
            (SELECT count(*) FROM cards c WHERE c.domain_id = d.id AND c.due_at <= ?) AS due
     FROM domains d ORDER BY d.name COLLATE NOCASE`
  ).all(nowSec()) as Row[];
}

export function getLibrary(): Library {
  const all = rows();
  const course = (r: Row): CourseNode => ({ id: r.id, name: r.name, path: r.path, areas: parseAreas(r.areas), docs: r.docs, due: r.due });
  const macros: MacroNode[] = all.filter((r) => r.kind === "macro").map((m) => {
    const courses = all.filter((r) => r.kind !== "macro" && r.parentId === m.id).map(course);
    return {
      id: m.id, name: m.name, path: m.path, areas: parseAreas(m.areas),
      docs: courses.reduce((n, c) => n + c.docs, 0),
      due: m.due + courses.reduce((n, c) => n + c.due, 0), // il ripasso del macro include i figli
      courses,
    };
  });
  const macroIds = new Set(macros.map((m) => m.id));
  // genitore sparito o non-macro: il corso si mostra sciolto invece di sparire
  const loose = all.filter((r) => r.kind !== "macro" && (r.parentId == null || !macroIds.has(r.parentId))).map(course);
  const areas = [...new Set([...macros, ...loose].flatMap((x) => x.areas))].sort((a, b) => a.localeCompare(b));
  return { macros, loose, areas };
}

export function getTrail(id: number): Trail | null {
  const lib = getLibrary();
  for (const m of lib.macros) {
    if (m.id === id) return { id, name: m.name, kind: "macro", macro: null, courses: m.courses.map(({ id, name }) => ({ id, name })) };
    const c = m.courses.find((x) => x.id === id);
    if (c) return { id, name: c.name, kind: "course", macro: { id: m.id, name: m.name }, courses: [] };
  }
  const c = lib.loose.find((x) => x.id === id);
  return c ? { id, name: c.name, kind: "course", macro: null, courses: [] } : null;
}

// --- validazione ---------------------------------------------------------------

export function cleanName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) throw new LibraryError("il nome non può essere vuoto");
  const n = name.trim().replace(/\s+/g, " ");
  if (n.length > 120) throw new LibraryError("nome troppo lungo (max 120 caratteri)");
  return n;
}

/** Stringhe non vuote, max 40 caratteri, dedup case-insensitive, max 10 aree. */
export function normalizeAreas(areas: unknown): string[] {
  if (!Array.isArray(areas)) throw new LibraryError("aree non valide");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of areas) {
    if (typeof a !== "string") continue;
    const t = a.trim().replace(/\s+/g, " ");
    if (!t || t.length > 40 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 10);
}

interface DomainRow { id: number; kind: string; parentId: number | null }

function find(id: number): DomainRow {
  const r = sqlite.prepare("SELECT id, kind, parent_id AS parentId FROM domains WHERE id = ?").get(id) as DomainRow | undefined;
  if (!r) throw new LibraryError("dominio non trovato", 404);
  return r;
}

/** Un corso può stare solo dentro un macro; un macro non può stare dentro niente. */
function checkParent(childKind: string, parentId: number | null) {
  if (parentId == null) return;
  if (childKind === "macro") throw new LibraryError("un macro non può stare dentro un altro macro");
  if (find(parentId).kind !== "macro") throw new LibraryError("un corso si può mettere solo dentro un macro");
}

export function findByPath(p: string) {
  const r = sqlite.prepare("SELECT id, kind, parent_id AS parentId, name, areas FROM domains WHERE path = ?").get(p) as
    | (DomainRow & { name: string; areas: string | null })
    | undefined;
  return r ? { ...r, areas: parseAreas(r.areas) } : undefined;
}

// --- mutazioni -----------------------------------------------------------------

export function updateDomain(id: number, patch: { name?: unknown; areas?: unknown; parentId?: unknown }) {
  const d = find(id);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) { sets.push("name = ?"); vals.push(cleanName(patch.name)); }
  if (patch.areas !== undefined) { sets.push("areas = ?"); vals.push(JSON.stringify(normalizeAreas(patch.areas))); }
  if (patch.parentId !== undefined) {
    const pid = patch.parentId === null ? null : Number(patch.parentId);
    if (pid !== null && !Number.isInteger(pid)) throw new LibraryError("parentId non valido");
    checkParent(d.kind, pid);
    sets.push("parent_id = ?");
    vals.push(pid);
  }
  if (!sets.length) return;
  sqlite.prepare(`UPDATE domains SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function createMacro(name: unknown, areas: unknown = [], courseIds: unknown = [], path: string | null = null): number {
  const n = cleanName(name);
  const a = normalizeAreas(areas);
  if (!Array.isArray(courseIds)) throw new LibraryError("courseIds non valido");
  return sqlite.transaction(() => {
    const id = Number(
      sqlite.prepare("INSERT INTO domains (name, kind, parent_id, path, areas, created_at) VALUES (?, 'macro', NULL, ?, ?, ?)")
        .run(n, path, JSON.stringify(a), nowSec()).lastInsertRowid
    );
    for (const c of courseIds) {
      const cd = find(Number(c));
      checkParent(cd.kind, id);
      sqlite.prepare("UPDATE domains SET parent_id = ? WHERE id = ?").run(id, cd.id);
    }
    return id;
  })();
}

export function createCourse(name: unknown, path: string, parentId: number | null, areas: unknown = []): number {
  checkParent("course", parentId);
  return Number(
    sqlite.prepare("INSERT INTO domains (name, kind, parent_id, path, areas, created_at) VALUES (?, 'course', ?, ?, ?, ?)")
      .run(cleanName(name), parentId, path, JSON.stringify(normalizeAreas(areas)), nowSec()).lastInsertRowid
  );
}

/** Elimina un macro; i corsi diventano sciolti. Bloccato se il macro ha dati di studio propri. */
export function deleteMacro(id: number) {
  const d = find(id);
  if (d.kind !== "macro") throw new LibraryError("si possono eliminare solo i macro");
  const own = sqlite.prepare(
    `SELECT (SELECT count(*) FROM cards WHERE domain_id = ?)
          + (SELECT count(*) FROM concept_maps WHERE domain_id = ?)
          + (SELECT count(*) FROM sessions WHERE domain_id = ?) AS n`
  ).get(id, id, id) as { n: number };
  if (own.n > 0) throw new LibraryError("questo macro ha carte, mappe o sessioni di studio proprie: non lo elimino", 409);
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE domains SET parent_id = NULL WHERE parent_id = ?").run(id);
    sqlite.prepare("DELETE FROM domains WHERE id = ?").run(id);
  })();
}
```

- [ ] **Step 4: Esegui i test**

Run: `npm test`
Expected: tutti PASS.

- [ ] **Step 5: Migra il DB reale (con backup)**

Il DB reale è quello di `DB_PATH` in `.env.local` (oggi `studybuddy-v2.db`). **Non usare `db:push`** (vedi Global Constraints). Fermare `npm run dev` se gira.

```bash
DB=$(grep '^DB_PATH=' .env.local | cut -d= -f2)
cp "$DB" "$DB.bak-2026-10-08"
sqlite3 "$DB" "ALTER TABLE domains ADD COLUMN areas text DEFAULT '[]' NOT NULL;
CREATE TABLE IF NOT EXISTS ingested_files (
  domain_id integer NOT NULL REFERENCES domains(id),
  source text NOT NULL,
  file_hash text NOT NULL,
  PRIMARY KEY (domain_id, source)
);"
sqlite3 "$DB" "SELECT id, name, areas FROM domains LIMIT 3;"
```

Expected: le righe esistenti con `areas = []`. (Il backup `*.db.bak*` è già gitignored.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/library.ts tests/library.test.ts
git commit -m "Libreria: aree sui domini, ingested_files, lib/library con invarianti macro→corsi

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `coursera.ts` — helper esportati e registro `ingested_files`

**Files:**
- Modify: `src/lib/rag/sources/coursera.ts`
- Test: `tests/coursera.test.ts`

**Interfaces:**
- Consumes: `useTempDb`, `makeTree` (Task 1); `createCourse` (Task 2).
- Produces (export da `coursera.ts`):
  - `type Kind = "transcript" | "pdf" | "html" | "video" | "text" | "skip"`
  - `classify(file: string): Kind`, `stem(file: string): string`, `walk(dir: string): Promise<string[]>`
  - `fileHashOf(buf: Buffer): string` — sha1 di `PARSER_VERSION` + contenuto (lo stesso usato in `meta.fileHash`)
  - `selectWork(files: string[], useWhisper: boolean): { file: string; kind: Kind }[]` — i file che `ingestCourse` elabora, già ordinati
  - `ingestCourse` registra in `ingested_files` ogni file letto con successo (anche invariati e senza chunk).

Contesto: oggi `ingestCourse` (`coursera.ts:182`) calcola la lista di lavoro e l'hash inline. Estraiamo quelle parti così l'analisi (Task 4) usa **esattamente** la stessa definizione di "file da ingerire" e "modificato".

- [ ] **Step 1: Scrivi il test (fallisce)**

`tests/coursera.test.ts`:

```ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { useTempDb } from "./helpers/db";
import { makeTree } from "./helpers/fs";

let C: typeof import("@/lib/rag/sources/coursera");
let L: typeof import("@/lib/library");
let sqlite: import("better-sqlite3").Database;
let dir: string;

before(async () => {
  ({ sqlite, dir } = await useTempDb());
  C = await import("@/lib/rag/sources/coursera");
  L = await import("@/lib/library");
});

test("selectWork: salta .txt gemelli, video coperti da srt, file spazzatura", () => {
  const files = ["/c/01_m/a.srt", "/c/01_m/a.txt", "/c/01_m/a.mp4", "/c/01_m/b.mp4", "/c/01_m/r.html", "/c/x.url", "/c/n.txt"];
  const noWhisper = C.selectWork(files, false).map((w) => path.basename(w.file));
  assert.deepEqual(noWhisper, ["a.srt", "r.html", "n.txt"]);
  const withWhisper = C.selectWork(files, true).map((w) => path.basename(w.file));
  assert.ok(withWhisper.includes("b.mp4") && !withWhisper.includes("a.mp4"));
});

test("fileHashOf include la versione del parser", () => {
  const buf = Buffer.from("ciao");
  assert.notEqual(C.fileHashOf(buf), createHash("sha1").update(buf).digest("hex"));
  assert.equal(C.fileHashOf(buf), C.fileHashOf(Buffer.from("ciao")));
});

test("ingestCourse registra anche i file che non producono documenti", async () => {
  const course = path.join(dir, "corso-vuoto");
  makeTree(course, { "01_m/vuoto.html": "<html><body></body></html>", "01_m/vuoto.srt": "" });
  const id = L.createCourse("Vuoto", course, null);
  const stats = await C.ingestCourse(course, id);
  assert.equal(stats.documents, 0);
  const n = (sqlite.prepare("SELECT count(*) AS n FROM ingested_files WHERE domain_id = ?").get(id) as { n: number }).n;
  assert.equal(n, 2);
});
```

Run: `npm test`
Expected: FAIL (`C.selectWork is not a function`).

- [ ] **Step 2: Implementa**

In `src/lib/rag/sources/coursera.ts`:

1. Import: aggiungi `sqlite` all'import da `@/lib/db`:

```ts
import { db, sqlite } from "@/lib/db";
```

2. Rendi esportati `Kind`, `classify`, `stem`, `walk` (aggiungi `export` davanti a `type Kind`, `function classify`, `function stem`, `async function walk`).

3. Sotto `PARSER_VERSION` aggiungi:

```ts
/** Hash con cui si riconosce un file già ingerito (contenuto + versione del parser). */
export function fileHashOf(buf: Buffer): string {
  return createHash("sha1").update(PARSER_VERSION).update(buf).digest("hex");
}
```

4. Sopra `export interface IngestOpts` aggiungi `selectWork`, spostandoci la logica di filtro che oggi è dentro `ingestCourse`:

```ts
/**
 * I file che l'ingest elabora, in ordine di priorità. Condivisa con l'analisi
 * dell'import (lib/ingestPlan.ts): stessa definizione di "file da ingerire".
 */
export function selectWork(files: string[], useWhisper: boolean): { file: string; kind: Kind }[] {
  // Stem di ogni trascrizione: serve a riconoscere i .txt gemelli e i video già coperti.
  const transcriptStems = new Set<string>();
  for (const f of files) if (classify(f) === "transcript") transcriptStems.add(stem(f));
  return files
    .map((file) => ({ file, kind: classify(file) }))
    .filter(({ file, kind }) => {
      if (kind === "skip") return false;
      // Video: solo col fallback Whisper attivo e se manca la trascrizione gemella.
      if (kind === "video") return useWhisper && !transcriptStems.has(stem(file));
      // .txt gemello di una trascrizione -> ridondante, si tiene l'srt.
      if (kind === "text" && transcriptStems.has(stem(file))) return false;
      return true;
    })
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

function recordIngested(domainId: number, source: string, fileHash: string) {
  sqlite.prepare(
    `INSERT INTO ingested_files (domain_id, source, file_hash) VALUES (?, ?, ?)
     ON CONFLICT(domain_id, source) DO UPDATE SET file_hash = excluded.file_hash`
  ).run(domainId, source, fileHash);
}
```

`KIND_ORDER` è definito sopra `ingestCourse`: sposta la sua dichiarazione **sopra** `selectWork`.

5. In `ingestCourse` sostituisci il blocco che va da `const work = files` fino alla fine del `.sort(...)` con:

```ts
  const work = selectWork(files, useWhisper);
```

(Il set `transcriptStems` resta in `ingestCourse`: serve ancora per `stats.skippedTxtTwins`.)

6. Nel loop, sostituisci il calcolo dell'hash e il check invariato:

```ts
    const fileHash = fileHashOf(buf);

    const prev = existing.get(file);
    if (prev && prev.fileHash === fileHash) { recordIngested(domainId, file, fileHash); stats.unchanged++; continue; } // invariato
```

7. Registra anche gli altri esiti riusciti. Dopo il blocco `if (prev) { ... }` e **prima** di `if (!fresh.length) continue;`:

```ts
    recordIngested(domainId, file, fileHash); // anche se non produce chunk: l'analisi non lo rivede come "nuovo"
```

- [ ] **Step 3: Esegui**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rag/sources/coursera.ts tests/coursera.test.ts
git commit -m "Ingest: selectWork/fileHashOf condivisi, registro ingested_files anche per file senza chunk

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Analisi cartelle (`ingestPlan.ts`, `ingestPlanTypes.ts`, `libraryDir.ts`)

**Files:**
- Create: `src/lib/libraryDir.ts`, `src/lib/ingestPlanTypes.ts`, `src/lib/ingestPlan.ts`
- Test: `tests/ingestPlan.test.ts`

**Interfaces:**
- Consumes: `walk`, `classify`, `stem`, `selectWork`, `fileHashOf`, `hasIngestibleContent`, `subdirs` (coursera.ts, Task 3); `findByPath` (Task 2).
- Produces:
  - `LIBRARY_DIR: string` (`libraryDir.ts`)
  - da `ingestPlanTypes.ts` (puro, niente import Node — lo usa anche il client):
    - `type FileCounts = { transcript: number; html: number; pdf: number; text: number; video: number }`
    - `type CourseStatus = "new" | "upToDate" | "changed"`
    - `interface CourseAnalysis { path: string; name: string; existingId?: number; parentId?: number | null; areas: string[]; counts: FileCounts; videosWithoutSubs: number; status: CourseStatus; changedFiles: number }`
    - `interface ItemAnalysis { kind: "macro" | "course"; path: string; name: string; existingId?: number; areas: string[]; courses: CourseAnalysis[] }`
    - `interface PlanMacro { key: string; existingId?: number; name: string; path: string | null; areas: string[] }`
    - `type PlanParent = { macroKey: string } | { existingId: number } | null`
    - `interface PlanCourse { path: string; name: string; areas: string[]; parent: PlanParent; include: boolean; status: CourseStatus; changedFiles: number; videosWithoutSubs: number; counts: FileCounts }`
    - `interface IngestPlan { macros: PlanMacro[]; courses: PlanCourse[]; whisper: boolean }`
    - `defaultPlan(items: ItemAnalysis[]): IngestPlan`
    - `groupIntoNewMacro(plan: IngestPlan, coursePaths: string[], name: string): IngestPlan`
  - da `ingestPlan.ts`:
    - `classifyFolder(dir: string, whisper?: boolean): Promise<"macro" | "course" | null>`
    - `analyzeFolder(dir: string, opts?: { as?: "macro" | "course"; whisper?: boolean }): Promise<ItemAnalysis | null>`
    - `analyzeLibrary(dir: string, whisper?: boolean): Promise<ItemAnalysis[]>`
    - `newInLibrary(dir: string): Promise<{ path: string; name: string }[]>`

Regola di classificazione (dalla spec): sottocartelle dirette con materiale; se i nomi con prefisso numerico (`/^\d+[\s._-]/`) sono **almeno** quanti quelli senza ⇒ moduli ⇒ `course` (in parità vince `course`: il corso singolo è il caso più comune); altrimenti `macro`; nessuna sottocartella con materiale ma file diretti ⇒ `course`; niente materiale ⇒ `null`.

- [ ] **Step 1: `libraryDir.ts` e `ingestPlanTypes.ts`**

`src/lib/libraryDir.ts`:

```ts
import path from "node:path";

/**
 * Cartella-libreria: qui si copiano a mano i corsi scaricati, l'app li rileva e li
 * importa. Default `Courses/` nella root del progetto (gitignored), override con
 * STUDYBUDDY_LIBRARY_DIR. Deve stare dentro la sandbox di lib/fsRoot.ts.
 */
export const LIBRARY_DIR = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.STUDYBUDDY_LIBRARY_DIR ?? "Courses"
);
```

`src/lib/ingestPlanTypes.ts`:

```ts
/**
 * Tipi dell'analisi e del piano di import, condivisi tra server (lib/ingestPlan.ts,
 * lib/ingestTree.ts) e client (/add). Niente import Node qui.
 */
export type FileCounts = { transcript: number; html: number; pdf: number; text: number; video: number };
export type CourseStatus = "new" | "upToDate" | "changed";

export interface CourseAnalysis {
  path: string;
  name: string;
  existingId?: number;
  parentId?: number | null;   // organizzazione attuale nel DB (se il corso esiste già)
  areas: string[];
  counts: FileCounts;
  videosWithoutSubs: number;
  status: CourseStatus;
  changedFiles: number;       // file nuovi o modificati rispetto all'ultimo import
}

export interface ItemAnalysis {
  kind: "macro" | "course";
  path: string;
  name: string;
  existingId?: number;
  areas: string[];
  courses: CourseAnalysis[];  // per kind "course": un solo elemento, la cartella stessa
}

export interface PlanMacro { key: string; existingId?: number; name: string; path: string | null; areas: string[] }
export type PlanParent = { macroKey: string } | { existingId: number } | null;

export interface PlanCourse {
  path: string;
  name: string;
  areas: string[];
  parent: PlanParent;
  include: boolean;
  status: CourseStatus;
  changedFiles: number;
  videosWithoutSubs: number;
  counts: FileCounts;
}

export interface IngestPlan { macros: PlanMacro[]; courses: PlanCourse[]; whisper: boolean }

/**
 * Piano proposto dall'analisi. Un corso già nel DB tiene la sua organizzazione
 * attuale (macro, nome, aree): re-importare non disfa mai gli spostamenti manuali.
 * Preselezionati solo i corsi con qualcosa da fare.
 */
export function defaultPlan(items: ItemAnalysis[]): IngestPlan {
  const macros: PlanMacro[] = [];
  const courses: PlanCourse[] = [];
  for (const it of items) {
    if (it.kind === "macro") macros.push({ key: it.path, existingId: it.existingId, name: it.name, path: it.path, areas: it.areas });
    for (const c of it.courses) {
      const parent: PlanParent = c.existingId != null
        ? (c.parentId != null ? { existingId: c.parentId } : null)
        : it.kind === "macro"
          ? (it.existingId != null ? { existingId: it.existingId } : { macroKey: it.path })
          : null;
      courses.push({
        path: c.path, name: c.name, areas: c.areas, parent,
        include: c.status !== "upToDate",
        status: c.status, changedFiles: c.changedFiles, videosWithoutSubs: c.videosWithoutSubs, counts: c.counts,
      });
    }
  }
  return { macros, courses, whisper: false };
}

/** Mette i corsi indicati sotto un nuovo macro (senza cartella su disco). */
export function groupIntoNewMacro(plan: IngestPlan, coursePaths: string[], name: string): IngestPlan {
  const key = `new:${Date.now()}`;
  const wanted = new Set(coursePaths);
  return {
    ...plan,
    macros: [...plan.macros, { key, name, path: null, areas: [] }],
    courses: plan.courses.map((c) => (wanted.has(c.path) ? { ...c, parent: { macroKey: key } } : c)),
  };
}
```

- [ ] **Step 2: Scrivi i test (falliscono)**

`tests/ingestPlan.test.ts`:

```ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTempDb } from "./helpers/db";
import { makeTree } from "./helpers/fs";

let P: typeof import("@/lib/ingestPlan");
let T: typeof import("@/lib/ingestPlanTypes");
let L: typeof import("@/lib/library");
let C: typeof import("@/lib/rag/sources/coursera");
let sqlite: import("better-sqlite3").Database;
let lib: string;

before(async () => {
  let dir: string;
  ({ sqlite, dir } = await useTempDb());
  P = await import("@/lib/ingestPlan");
  T = await import("@/lib/ingestPlanTypes");
  L = await import("@/lib/library");
  C = await import("@/lib/rag/sources/coursera");
  lib = path.join(dir, "libreria");
  makeTree(lib, {
    // specializzazione: corsi con nomi, più una cartella numerata senza materiale
    "Spec Alfa/Corso-uno/01_mod/01_lez/a.srt": "1\n00:00:01,000 --> 00:00:02,000\nciao\n",
    "Spec Alfa/Corso-due/01_mod/b.html": "<html><body><p>testo</p></body></html>",
    "Spec Alfa/0. Link utili/sito.url": "[InternetShortcut]",
    "Spec Alfa/Info.txt": "spazzatura del download",
    // corso singolo: moduli numerati
    "corso-singolo/01_intro/x.srt": "1\n00:00:01,000 --> 00:00:02,000\nx\n",
    "corso-singolo/02_altro/y.srt": "1\n00:00:01,000 --> 00:00:02,000\ny\n",
    "corso-singolo/02_altro/v.mp4": "finto video",
    // nome con spazi, apostrofo e accento
    "Corso dell'Arte è/01_m/z.srt": "1\n00:00:01,000 --> 00:00:02,000\nz\n",
    // niente materiale
    "vuota/link.url": "[InternetShortcut]",
  });
});

test("classifyFolder: nomi ⇒ macro, moduli numerati ⇒ corso, vuota ⇒ null", async () => {
  assert.equal(await P.classifyFolder(path.join(lib, "Spec Alfa")), "macro");
  assert.equal(await P.classifyFolder(path.join(lib, "corso-singolo")), "course");
  assert.equal(await P.classifyFolder(path.join(lib, "vuota")), null);
});

test("classifyFolder: parità numerati/non numerati ⇒ corso", async () => {
  const d = path.join(lib, "..", "parita");
  makeTree(d, { "01_a/a.srt": "1\n00:00:01,000 --> 00:00:02,000\na\n", "Risorse/r.html": "<p>r</p>" });
  assert.equal(await P.classifyFolder(d), "course");
});

test("analyzeLibrary: la cartella-libreria non è un macro; ogni elemento è classificato", async () => {
  const items = await P.analyzeLibrary(lib);
  const byName = new Map(items.map((i) => [i.name, i]));
  assert.equal(byName.get("Spec Alfa")?.kind, "macro");
  assert.deepEqual(byName.get("Spec Alfa")?.courses.map((c) => c.name).sort(), ["Corso-due", "Corso-uno"]);
  assert.equal(byName.get("corso-singolo")?.kind, "course");
  assert.ok(byName.has("Corso dell'Arte è"));
  assert.ok(!byName.has("vuota"));
});

test("analyzeFolder: conteggi, video senza sottotitoli, stato nuovo", async () => {
  const it = (await P.analyzeFolder(path.join(lib, "corso-singolo")))!;
  const c = it.courses[0];
  assert.equal(c.counts.transcript, 2);
  assert.equal(c.counts.video, 1);
  assert.equal(c.videosWithoutSubs, 1);
  assert.equal(c.status, "new");
  assert.equal(c.changedFiles, 2);
});

test("analyzeFolder con as: forza macro su un corso singolo", async () => {
  const it = (await P.analyzeFolder(path.join(lib, "corso-singolo"), { as: "macro" }))!;
  assert.equal(it.kind, "macro");
  assert.deepEqual(it.courses.map((c) => c.name).sort(), ["01_intro", "02_altro"]);
});

test("stato: aggiornato dopo la registrazione degli hash, poi modificato", async () => {
  const dir = path.join(lib, "Corso dell'Arte è");
  const id = L.createCourse("Arte", dir, null, ["Arte"]);
  for (const w of C.selectWork(await C.walk(dir), false)) {
    sqlite.prepare("INSERT INTO ingested_files (domain_id, source, file_hash) VALUES (?, ?, ?)").run(id, w.file, C.fileHashOf(fs.readFileSync(w.file)));
  }
  let c = (await P.analyzeFolder(dir))!.courses[0];
  assert.equal(c.status, "upToDate");
  assert.equal(c.existingId, id);
  assert.equal(c.name, "Arte");            // nome dal DB, non dalla cartella
  assert.deepEqual(c.areas, ["Arte"]);
  fs.writeFileSync(path.join(dir, "01_m/z.srt"), "1\n00:00:01,000 --> 00:00:02,000\nmodificato\n");
  c = (await P.analyzeFolder(dir))!.courses[0];
  assert.equal(c.status, "changed");
  assert.equal(c.changedFiles, 1);
});

test("newInLibrary: solo le cartelle con materiale non ancora importate", async () => {
  const fresh = (await P.newInLibrary(lib)).map((f) => f.name).sort();
  assert.ok(fresh.includes("Spec Alfa") && fresh.includes("corso-singolo"));
  assert.ok(!fresh.includes("Corso dell'Arte è")); // importata nel test precedente
  assert.ok(!fresh.includes("vuota"));
  assert.deepEqual(await P.newInLibrary(path.join(lib, "non-esiste")), []);
});

test("defaultPlan: corso esistente tiene il suo macro; nuovi sotto il macro della cartella", async () => {
  const altro = L.createMacro("Altro macro");
  const spec = path.join(lib, "Spec Alfa");
  L.createCourse("Uno spostato", path.join(spec, "Corso-uno"), altro);
  const plan = T.defaultPlan([(await P.analyzeFolder(spec))!]);
  const uno = plan.courses.find((c) => c.path.endsWith("Corso-uno"))!;
  const due = plan.courses.find((c) => c.path.endsWith("Corso-due"))!;
  assert.deepEqual(uno.parent, { existingId: altro });
  assert.equal(uno.name, "Uno spostato");
  assert.deepEqual(due.parent, { macroKey: spec });
  const grouped = T.groupIntoNewMacro(plan, [due.path], "Nuovo");
  const key = grouped.macros.at(-1)!.key;
  assert.deepEqual(grouped.courses.find((c) => c.path === due.path)!.parent, { macroKey: key });
});
```

Run: `npm test`
Expected: FAIL (`Cannot find module '@/lib/ingestPlan'`).

- [ ] **Step 3: Implementa `src/lib/ingestPlan.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { sqlite } from "@/lib/db";
import { findByPath } from "@/lib/library";
import {
  walk, classify, stem, selectWork, fileHashOf, hasIngestibleContent, subdirs,
} from "@/lib/rag/sources/coursera";
import type { CourseAnalysis, FileCounts, ItemAnalysis } from "@/lib/ingestPlanTypes";

/**
 * Analisi delle cartelle per l'import (sola lettura, niente LLM): classifica macro vs
 * corso, conta i file, confronta gli hash con l'ultimo import. Regola generica, non
 * legata a un corso: sottocartelle numerate = moduli (⇒ corso), con nomi = corsi (⇒ macro).
 */
const NUMBERED = /^\d+[\s._-]/;

async function contentSubdirs(dir: string, whisper: boolean): Promise<string[]> {
  const out: string[] = [];
  for (const s of await subdirs(dir)) if (await hasIngestibleContent(s, whisper)) out.push(s);
  return out.sort((a, b) => a.localeCompare(b));
}

export async function classifyFolder(dir: string, whisper = false): Promise<"macro" | "course" | null> {
  const subs = await contentSubdirs(dir, whisper);
  if (!subs.length) return (await hasIngestibleContent(dir, whisper)) ? "course" : null;
  const numbered = subs.filter((s) => NUMBERED.test(path.basename(s))).length;
  return numbered >= subs.length - numbered ? "course" : "macro"; // parità ⇒ corso
}

/** Hash già noti per un dominio: ingested_files ∪ documents.meta.fileHash (DB precedenti). */
function knownHashes(domainId: number): Map<string, string> {
  const m = new Map<string, string>();
  const docs = sqlite.prepare(
    "SELECT source, json_extract(meta, '$.fileHash') AS h FROM documents WHERE domain_id = ? AND source IS NOT NULL"
  ).all(domainId) as { source: string; h: string | null }[];
  for (const d of docs) if (d.h) m.set(d.source, d.h);
  const files = sqlite.prepare("SELECT source, file_hash AS h FROM ingested_files WHERE domain_id = ?").all(domainId) as { source: string; h: string }[];
  for (const f of files) m.set(f.source, f.h);
  return m;
}

async function analyzeCourse(dir: string, whisper: boolean): Promise<CourseAnalysis> {
  const files = await walk(dir);
  const counts: FileCounts = { transcript: 0, html: 0, pdf: 0, text: 0, video: 0 };
  const transcriptStems = new Set<string>();
  for (const f of files) {
    const k = classify(f);
    if (k === "transcript") transcriptStems.add(stem(f));
    if (k !== "skip") counts[k]++;
  }
  const videosWithoutSubs = files.filter((f) => classify(f) === "video" && !transcriptStems.has(stem(f))).length;
  const work = selectWork(files, whisper);

  const existing = findByPath(dir);
  let changedFiles = work.length;
  if (existing) {
    const known = knownHashes(existing.id);
    changedFiles = 0;
    for (const w of work) {
      const h = known.get(w.file);
      if (!h || h !== fileHashOf(await fs.readFile(w.file))) changedFiles++;
    }
  }
  return {
    path: dir,
    name: existing?.name ?? path.basename(dir),
    existingId: existing?.id,
    parentId: existing ? existing.parentId : undefined,
    areas: existing?.areas ?? [],
    counts,
    videosWithoutSubs,
    status: !existing ? "new" : changedFiles ? "changed" : "upToDate",
    changedFiles,
  };
}

export async function analyzeFolder(
  dir: string,
  opts: { as?: "macro" | "course"; whisper?: boolean } = {}
): Promise<ItemAnalysis | null> {
  const whisper = !!opts.whisper;
  const kind = opts.as ?? (await classifyFolder(dir, whisper));
  if (!kind) return null;
  const existing = findByPath(dir);
  if (kind === "course") {
    const c = await analyzeCourse(dir, whisper);
    return { kind, path: dir, name: c.name, existingId: c.existingId, areas: c.areas, courses: [c] };
  }
  const courses: CourseAnalysis[] = [];
  for (const s of await contentSubdirs(dir, whisper)) courses.push(await analyzeCourse(s, whisper));
  if (!courses.length) return null;
  return {
    kind, path: dir,
    name: existing?.kind === "macro" ? existing.name : path.basename(dir),
    existingId: existing?.kind === "macro" ? existing.id : undefined,
    areas: existing?.kind === "macro" ? existing.areas : [],
    courses,
  };
}

/** La cartella-libreria non è mai un macro: ogni sottocartella è un elemento a sé. */
export async function analyzeLibrary(dir: string, whisper = false): Promise<ItemAnalysis[]> {
  const items: ItemAnalysis[] = [];
  for (const s of await safeSubdirs(dir)) {
    const it = await analyzeFolder(s, { whisper });
    if (it) items.push(it);
  }
  return items;
}

/** Rilevamento economico per la Libreria: niente hashing, solo path non ancora domini. */
export async function newInLibrary(dir: string): Promise<{ path: string; name: string }[]> {
  const out: { path: string; name: string }[] = [];
  for (const s of await safeSubdirs(dir)) {
    if (findByPath(s)) continue;
    if (await hasIngestibleContent(s)) out.push({ path: s, name: path.basename(s) });
  }
  return out;
}

async function safeSubdirs(dir: string): Promise<string[]> {
  try {
    return (await subdirs(dir)).filter((s) => !path.basename(s).startsWith(".")).sort((a, b) => a.localeCompare(b));
  } catch {
    return []; // cartella-libreria assente: nessun elemento
  }
}
```

Nota: `newInLibrary` controlla solo il path dell'elemento di primo livello. Un macro importato ha `path` = la sua cartella, un corso singolo pure: entrambi risultano "già importati".

- [ ] **Step 4: Esegui**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/libraryDir.ts src/lib/ingestPlanTypes.ts src/lib/ingestPlan.ts tests/ingestPlan.test.ts
git commit -m "Analisi import: classificazione macro/corso, stato per hash, rilevamento nuovi corsi

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Esecuzione del piano e API (`ingestTree.ts`, `jobs.ts`, route)

**Files:**
- Modify: `src/lib/ingestTree.ts` (riscrittura), `src/lib/jobs.ts`
- Modify: `src/app/api/ingest-folder/route.ts`
- Create: `src/app/api/ingest-folder/analyze/route.ts`, `src/app/api/library/route.ts`
- Delete: `src/app/api/domains/route.ts` — **solo nel Task 7** (il vecchio `page.tsx` la usa ancora fino ad allora).
- Test: `tests/ingestTree.test.ts`

**Interfaces:**
- Consumes: Task 2 (`LibraryError`, `cleanName`, `normalizeAreas`, `findByPath`, `updateDomain`, `createMacro`, `createCourse`), Task 4 (tipi del piano, `analyzeFolder`, `analyzeLibrary`, `LIBRARY_DIR`), `insideRoot` (`fsRoot.ts`), `ingestCourse`.
- Produces:
  - `parsePlan(body: unknown): IngestPlan` — lancia `LibraryError` (400 forma, 403 path fuori sandbox)
  - `applyPlan(plan: IngestPlan): IngestStep[]` con `interface IngestStep { dir: string; domainId: number; name: string; macro?: string }`
  - `runPlan(steps: IngestStep[], opts: { whisper?: boolean; report?: (c: CourseProgress[]) => void }): Promise<CourseProgress[]>`
  - `CourseProgress` invariato.
  - `activeJob(): IngestJob | undefined` (jobs.ts)
  - HTTP: `POST /api/ingest-folder/analyze { path?, as?, whisper? } → { items: ItemAnalysis[] }`; `POST /api/ingest-folder { plan } → { jobId }` (409 se un job è attivo); `GET /api/ingest-folder?job=<id>` → job | 404; `GET /api/ingest-folder?active=1 → { job: IngestJob | null }`; `GET /api/library → Library`; `PATCH /api/library { id, name?, areas?, parentId? }`; `POST /api/library { name, areas?, courseIds? } → { id }`; `DELETE /api/library { id }`.

- [ ] **Step 1: Scrivi i test (falliscono)**

`tests/ingestTree.test.ts`:

```ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { useTempDb } from "./helpers/db";
import { makeTree } from "./helpers/fs";

let I: typeof import("@/lib/ingestTree");
let P: typeof import("@/lib/ingestPlan");
let T: typeof import("@/lib/ingestPlanTypes");
let L: typeof import("@/lib/library");
let J: typeof import("@/lib/jobs");
let lib: string;

before(async () => {
  const { dir } = await useTempDb();
  // la sandbox (lib/fsRoot) è la home: le fixture devono stare lì sotto
  process.env.STUDYBUDDY_FS_ROOT = dir;
  I = await import("@/lib/ingestTree");
  P = await import("@/lib/ingestPlan");
  T = await import("@/lib/ingestPlanTypes");
  L = await import("@/lib/library");
  J = await import("@/lib/jobs");
  lib = path.join(dir, "libreria");
  makeTree(lib, {
    "Spec Beta/Corso-a/01_m/a.srt": "1\n00:00:01,000 --> 00:00:02,000\na\n",
    "Spec Beta/Corso-b/01_m/b.srt": "1\n00:00:01,000 --> 00:00:02,000\nb\n",
  });
});

test("parsePlan: rifiuta forma non valida e percorsi fuori sandbox", () => {
  assert.throws(() => I.parsePlan({}), L.LibraryError);
  const bad = { macros: [], courses: [{ path: "/etc", name: "x", areas: [], parent: null, include: true }], whisper: false };
  assert.throws(() => I.parsePlan(bad), (e: unknown) => e instanceof L.LibraryError && e.status === 403);
  const sneaky = { ...bad, courses: [{ ...bad.courses[0], path: path.join(os.tmpdir(), "..", "etc") }] };
  assert.throws(() => I.parsePlan(sneaky), (e: unknown) => e instanceof L.LibraryError && e.status === 403);
});

test("applyPlan: crea macro + corsi; re-import dopo spostamento manuale non disfa niente", async () => {
  const spec = path.join(lib, "Spec Beta");
  const plan = T.defaultPlan([(await P.analyzeFolder(spec))!]);
  const steps = I.applyPlan(I.parsePlan(plan));
  assert.equal(steps.length, 2);
  const a = L.findByPath(path.join(spec, "Corso-a"))!;
  const macro = L.findByPath(spec)!;
  assert.equal(macro.kind, "macro");
  assert.equal(a.parentId, macro.id);

  // organizzazione manuale
  const altro = L.createMacro("Altro");
  L.updateDomain(a.id, { parentId: altro, name: "Rinominato", areas: ["Web"] });

  // re-analisi + piano proposto + applicazione
  const again = T.defaultPlan([(await P.analyzeFolder(spec))!]);
  again.courses.forEach((c) => (c.include = true));
  I.applyPlan(I.parsePlan(again));
  const a2 = L.findByPath(path.join(spec, "Corso-a"))!;
  assert.equal(a2.parentId, altro);
  assert.equal(a2.name, "Rinominato");
  assert.deepEqual(a2.areas, ["Web"]);
});

test("applyPlan: macroKey sconosciuta ⇒ errore e nessuna modifica", () => {
  const p = path.join(lib, "Spec Beta", "Corso-b");
  const before = L.findByPath(p);
  const plan = { macros: [], courses: [{ path: p, name: "B", areas: [], parent: { macroKey: "boh" }, include: true }], whisper: false };
  assert.throws(() => I.applyPlan(I.parsePlan(plan)), L.LibraryError);
  assert.deepEqual(L.findByPath(p), before);
});

test("applyPlan: un path che è già un macro non diventa un corso", () => {
  const spec = path.join(lib, "Spec Beta");
  const plan = { macros: [], courses: [{ path: spec, name: "x", areas: [], parent: null, include: true }], whisper: false };
  assert.throws(() => I.applyPlan(I.parsePlan(plan)), L.LibraryError);
});

test("activeJob: c'è un solo job attivo alla volta", () => {
  assert.equal(J.activeJob(), undefined);
  const j = J.createJob();
  assert.equal(J.activeJob()?.id, j.id);
  j.status = "done";
  assert.equal(J.activeJob(), undefined);
});
```

Run: `npm test`
Expected: FAIL (`I.parsePlan is not a function`).

- [ ] **Step 2: `jobs.ts` — `activeJob`**

In `src/lib/jobs.ts` aggiungi in fondo:

```ts
/** Il job di ingestione in corso, se c'è: se ne esegue uno alla volta (stesso DB). */
export function activeJob(): IngestJob | undefined {
  for (const j of jobs.values()) if (j.status === "running") return j;
  return undefined;
}
```

- [ ] **Step 3: Riscrivi `src/lib/ingestTree.ts`**

```ts
import { sqlite } from "@/lib/db";
import { insideRoot } from "@/lib/fsRoot";
import {
  LibraryError, cleanName, normalizeAreas, findByPath, updateDomain, createMacro, createCourse,
} from "@/lib/library";
import { ingestCourse } from "@/lib/rag/sources/coursera";
import type { IngestPlan, PlanCourse, PlanMacro, PlanParent } from "@/lib/ingestPlanTypes";

/**
 * Esecuzione di un piano di import esplicito (costruito dall'anteprima in /add):
 * 1) `applyPlan` crea/aggiorna i domini come dice il piano, in una transazione;
 * 2) `runPlan` ingesta un corso alla volta riportando il progresso.
 * Il piano è l'unico punto, oltre alla Libreria, che cambia nome/macro/aree di un
 * dominio esistente: nessuna deduzione automatica dalle cartelle.
 */
export interface CourseProgress {
  name: string;
  macro?: string;
  total: number;
  done: number;
  documents: number;
  chunks: number;
  status: "pending" | "running" | "done" | "error";
  error?: string;
}

export interface IngestStep { dir: string; domainId: number; name: string; macro?: string }

function safePath(p: unknown): string {
  if (typeof p !== "string" || !p) throw new LibraryError("percorso mancante");
  const s = insideRoot(p);
  if (!s) throw new LibraryError("percorso fuori dalla root consentita", 403);
  return s;
}

function parseParent(p: unknown): PlanParent {
  if (p == null) return null;
  if (typeof p === "object" && "macroKey" in p && typeof p.macroKey === "string") return { macroKey: p.macroKey };
  if (typeof p === "object" && "existingId" in p && Number.isInteger(p.existingId)) return { existingId: Number(p.existingId) };
  throw new LibraryError("parent non valido");
}

/** Valida la forma del piano e la sandbox dei percorsi. Non tocca il DB. */
export function parsePlan(body: unknown): IngestPlan {
  const b = body as Partial<IngestPlan> | null;
  if (!b || !Array.isArray(b.macros) || !Array.isArray(b.courses)) throw new LibraryError("piano non valido");
  const macros: PlanMacro[] = b.macros.map((m) => ({
    key: String(m.key),
    existingId: Number.isInteger(m.existingId) ? m.existingId : undefined,
    name: cleanName(m.name),
    path: m.path == null ? null : safePath(m.path),
    areas: normalizeAreas(m.areas ?? []),
  }));
  const courses: PlanCourse[] = b.courses.map((c) => ({
    ...c,
    path: safePath(c.path),
    name: cleanName(c.name),
    areas: normalizeAreas(c.areas ?? []),
    parent: parseParent(c.parent),
    include: c.include === true,
  }));
  return { macros, courses, whisper: b.whisper === true };
}

export function applyPlan(plan: IngestPlan): IngestStep[] {
  return sqlite.transaction(() => {
    const included = plan.courses.filter((c) => c.include);
    const used = new Set(included.flatMap((c) => (c.parent && "macroKey" in c.parent ? [c.parent.macroKey] : [])));
    const byKey = new Map<string, { id: number; name: string }>();

    for (const m of plan.macros) {
      if (m.existingId != null) {
        updateDomain(m.existingId, { name: m.name, areas: m.areas });
        byKey.set(m.key, { id: m.existingId, name: m.name });
        continue;
      }
      if (!used.has(m.key)) continue; // niente macro vuoti
      const prev = m.path ? findByPath(m.path) : undefined;
      if (prev && prev.kind !== "macro") throw new LibraryError(`"${m.name}" è già importato come corso`);
      const id = prev ? (updateDomain(prev.id, { name: m.name, areas: m.areas }), prev.id) : createMacro(m.name, m.areas, [], m.path);
      byKey.set(m.key, { id, name: m.name });
    }

    const macroName = (id: number | null) =>
      id == null ? undefined : (sqlite.prepare("SELECT name FROM domains WHERE id = ?").get(id) as { name: string } | undefined)?.name;

    return included.map((c) => {
      let parentId: number | null = null;
      if (c.parent && "macroKey" in c.parent) {
        const m = byKey.get(c.parent.macroKey);
        if (!m) throw new LibraryError(`macro sconosciuto nel piano: ${c.parent.macroKey}`);
        parentId = m.id;
      } else if (c.parent) parentId = c.parent.existingId;

      const prev = findByPath(c.path);
      if (prev && prev.kind === "macro") throw new LibraryError(`"${c.name}" è già importato come macro`);
      const domainId = prev
        ? (updateDomain(prev.id, { name: c.name, areas: c.areas, parentId }), prev.id)
        : createCourse(c.name, c.path, parentId, c.areas);
      return { dir: c.path, domainId, name: c.name, macro: macroName(parentId) };
    });
  })();
}

export async function runPlan(
  steps: IngestStep[],
  opts: { whisper?: boolean; report?: (courses: CourseProgress[]) => void } = {}
): Promise<CourseProgress[]> {
  const courses: CourseProgress[] = steps.map((s) => ({
    name: s.name, macro: s.macro, total: 0, done: 0, documents: 0, chunks: 0, status: "pending",
  }));
  opts.report?.(courses);
  for (let i = 0; i < steps.length; i++) {
    courses[i].status = "running";
    opts.report?.(courses);
    try {
      const stats = await ingestCourse(steps[i].dir, steps[i].domainId, {
        whisper: !!opts.whisper,
        onProgress: (done, total) => { courses[i].done = done; courses[i].total = total; opts.report?.(courses); },
      });
      courses[i].documents = stats.documents;
      courses[i].chunks = stats.chunks;
      courses[i].status = "done";
    } catch (e) {
      courses[i].status = "error"; // un corso in errore non ferma gli altri
      courses[i].error = String(e);
    }
    opts.report?.(courses);
  }
  return courses;
}
```

Nota: `sqlite.transaction` di better-sqlite3 annulla tutto se una funzione interna lancia. È questo che garantisce "nessuna modifica" nel test della macroKey sconosciuta.

- [ ] **Step 4: Esegui i test**

Run: `npm test && npm run typecheck`
Expected: PASS. (Il typecheck fallisce su `src/app/api/ingest-folder/route.ts`, che importa ancora `ingestSelection`: è lo step successivo.)

- [ ] **Step 5: Route**

`src/app/api/ingest-folder/route.ts` (sostituisci tutto):

```ts
import { NextRequest, NextResponse } from "next/server";
import { activeJob, createJob, getJob } from "@/lib/jobs";
import { applyPlan, parsePlan, runPlan } from "@/lib/ingestTree";
import { LibraryError } from "@/lib/library";

export const runtime = "nodejs";

/** Avvia l'import (background) di un piano esplicito costruito dall'anteprima. Ritorna un jobId. */
export async function POST(req: NextRequest) {
  const { plan } = await req.json();
  if (activeJob()) return NextResponse.json({ error: "c'è già un import in corso" }, { status: 409 });
  let steps;
  try {
    const p = parsePlan(plan);
    steps = applyPlan(p);
    if (!steps.length) return NextResponse.json({ error: "nessun corso selezionato" }, { status: 400 });
    const job = createJob();
    // fire-and-forget: l'ingestione prosegue nel processo, il client fa polling su GET.
    runPlan(steps, { whisper: p.whisper, report: (courses) => { job.courses = courses; } })
      .then((courses) => { job.courses = courses; job.status = "done"; })
      .catch((e) => { job.status = "error"; job.error = String(e); });
    return NextResponse.json({ jobId: job.id });
  } catch (e) {
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Stato di un job (`?job=`) o il job attivo (`?active=1`). */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("active")) return NextResponse.json({ job: activeJob() ?? null });
  const id = req.nextUrl.searchParams.get("job");
  const job = id ? getJob(id) : undefined;
  if (!job) return NextResponse.json({ error: "job non trovato" }, { status: 404 });
  return NextResponse.json(job);
}
```

`src/app/api/ingest-folder/analyze/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { insideRoot } from "@/lib/fsRoot";
import { analyzeFolder, analyzeLibrary } from "@/lib/ingestPlan";
import { LIBRARY_DIR } from "@/lib/libraryDir";

export const runtime = "nodejs";

/** Analisi (sola lettura) della cartella-libreria, o di una cartella scelta col browser. */
export async function POST(req: NextRequest) {
  const { path, as, whisper } = await req.json();
  if (path == null) return NextResponse.json({ dir: LIBRARY_DIR, items: await analyzeLibrary(LIBRARY_DIR, !!whisper) });
  const dir = typeof path === "string" ? insideRoot(path) : null;
  if (!dir) return NextResponse.json({ error: "percorso fuori dalla root consentita" }, { status: 403 });
  const item = await analyzeFolder(dir, { as: as === "macro" || as === "course" ? as : undefined, whisper: !!whisper });
  if (!item) return NextResponse.json({ error: "nessun materiale importabile in questa cartella" }, { status: 422 });
  return NextResponse.json({ dir, items: [item] });
}
```

`src/app/api/library/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { LibraryError, createMacro, deleteMacro, getLibrary, updateDomain } from "@/lib/library";

export const runtime = "nodejs";

/** Organizzazione manuale della Libreria (thin wrapper su lib/library.ts). */
function handle(fn: () => unknown) {
  try {
    return NextResponse.json(fn() ?? { ok: true });
  } catch (e) {
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function GET() {
  return NextResponse.json(getLibrary());
}

export async function PATCH(req: NextRequest) {
  const { id, name, areas, parentId } = await req.json();
  return handle(() => updateDomain(Number(id), { name, areas, parentId }));
}

export async function POST(req: NextRequest) {
  const { name, areas, courseIds } = await req.json();
  return handle(() => ({ id: createMacro(name, areas ?? [], courseIds ?? []) }));
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  return handle(() => deleteMacro(Number(id)));
}
```

- [ ] **Step 6: Verifica**

Run: `npm run typecheck && npm test`
Expected: PASS.

Smoke HTTP (server di sviluppo sul DB reale, sola lettura):

```bash
npm run dev > /tmp/sb-dev.log 2>&1 &
sleep 12
curl -s -X POST localhost:3000/api/ingest-folder/analyze -H 'Content-Type: application/json' -d '{}' | head -c 600; echo
curl -s localhost:3000/api/library | head -c 300; echo
curl -s -X POST localhost:3000/api/ingest-folder/analyze -H 'Content-Type: application/json' -d '{"path":"/etc"}'; echo
kill %1
```

Expected: la prima risposta elenca gli elementi della cartella-libreria: `"kind":"macro"` per la specializzazione già importata (i suoi corsi `upToDate`, oppure `changed` con pochi file: sono i file senza documenti che `ingested_files` non conosce ancora, spariscono al primo re-import), `"kind":"course"` per i corsi singoli nuovi con `"status":"new"` (i moduli `01_…` **non** devono comparire come corsi). La seconda contiene `"macros"`; la terza è `403`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ingestTree.ts src/lib/jobs.ts src/app/api/ingest-folder/route.ts src/app/api/ingest-folder/analyze/route.ts src/app/api/library/route.ts tests/ingestTree.test.ts
git commit -m "Import da piano esplicito (parsePlan/applyPlan/runPlan), un job alla volta, API analyze e library

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Tailwind v4, font, token del vault, layout

**Files:**
- Modify: `package.json` (dipendenze), `src/app/globals.css`, `src/app/layout.tsx`
- Create: `postcss.config.mjs`, `src/lib/client/api.ts`

**Interfaces:**
- Produces: utility Tailwind con i token `bg`, `surface`, `surface-2`, `border`, `border-strong`, `fg`, `fg-muted`, `fg-dim`, `accent`, `accent-soft`, `danger`, `ok` (es. `bg-surface`, `text-fg-dim`, `border-border`), font `font-display` / `font-sans` / `font-mono`; alias legacy `--bg --panel --panel-2 --border --text --muted --accent --accent-2 --user`; `api<T>(method, path, body?)`, `post<T>(path, body)` in `src/lib/client/api.ts`; header globale con link Libreria e "+ Aggiungi".

Contesto: lo stile viene da `learning-vault/src/app/globals.css` (palette nero caldo + ambra, Fraunces/Geist/JetBrains Mono). Font self-hosted (`@fontsource-variable/*`): nessuna rete a runtime o in build. Il preflight di Tailwind azzera margini, liste e dimensioni dei titoli: le viste di studio con stili inline vanno ricontrollate (Task 7, Step 6).

- [ ] **Step 1: Dipendenze**

```bash
npm i -D tailwindcss@^4.3.3 @tailwindcss/postcss@^4.3.3 postcss
npm i @fontsource-variable/fraunces@^5.3.0 @fontsource-variable/geist@^5.3.0 @fontsource-variable/jetbrains-mono@^5.3.0
```

`postcss.config.mjs`:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 2: `globals.css` (sostituisci tutto)**

```css
@import "tailwindcss";

/* Linguaggio visivo condiviso con learning-vault: nero caldo, ambra, Fraunces per i titoli. */
@theme {
  --color-bg: #0A0908;
  --color-surface: #14110E;
  --color-surface-2: #1D1A16;
  --color-border: #2C2620;
  --color-border-strong: #44392E;
  --color-fg: #F4F2EC;
  --color-fg-muted: #C4BCAE;
  --color-fg-dim: #847C70;
  --color-accent: #E8B844;
  --color-accent-soft: #8E6B1C;
  --color-danger: #E07057;
  --color-ok: #6EE7A8;

  --font-display: "Fraunces Variable", ui-serif, Georgia, serif;
  --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;
}

/*
 * Alias dei vecchi token: le viste di studio (stili inline) e l'editor delle mappe
 * (components/mappe/studio.css) li usano ancora. Si tolgono con l'unione al vault.
 */
:root {
  --bg: var(--color-bg);
  --panel: var(--color-surface);
  --panel-2: var(--color-surface-2);
  --border: var(--color-border);
  --text: var(--color-fg);
  --muted: var(--color-fg-muted);
  --accent: var(--color-accent);
  --accent-2: var(--color-accent-soft);
  --user: #2A2318;
}

@layer base {
  html, body { height: 100%; }
  body {
    background: var(--color-bg);
    color: var(--color-fg);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }
  button { cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  ::selection { background: var(--color-accent); color: var(--color-bg); }
}

.spin {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--muted); border-top-color: transparent;
  display: inline-block; animation: spin 0.7s linear infinite; vertical-align: -2px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.slide-img svg, .slide-img img { width: 100%; height: 100%; display: block; object-fit: contain; }
.tabular { font-variant-numeric: tabular-nums; }
@keyframes fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.fade-up { animation: fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
```

- [ ] **Step 3: `layout.tsx` (sostituisci tutto)**

```tsx
import "@fontsource-variable/fraunces";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import "@/components/mappe/studio.css";
import Link from "next/link";

export const metadata = {
  title: "StudyBuddy",
  description: "Local-first RAG study companion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        <div className="h-dvh flex flex-col">
          <header className="h-12 shrink-0 border-b border-border px-4 md:px-8 flex items-center justify-between">
            <Link href="/" className="font-display text-xl tracking-tight">StudyBuddy</Link>
            <Link href="/add" className="text-[11px] uppercase tracking-[0.25em] text-fg-dim hover:text-fg transition-colors">
              + Aggiungi corso
            </Link>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: `src/lib/client/api.ts`**

```ts
/**
 * Fetch JSON per il client. Header JSON sempre presente: src/proxy.ts rifiuta le
 * scritture senza `Content-Type: application/json` (anche DELETE).
 */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

export const post = <T = unknown>(path: string, body: Record<string, unknown>) => api<T>("POST", path, body);
```

- [ ] **Step 5: Verifica**

Run: `npm run typecheck && npm run build`
Expected: build OK. (Il vecchio `page.tsx` usa `height: 100dvh` dentro il nuovo layout: provvisorio, si sistema nel Task 7.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json postcss.config.mjs src/app/globals.css src/app/layout.tsx src/lib/client/api.ts
git commit -m "Tailwind v4 e font self-hosted con la palette di learning-vault; header globale

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Area studio `/study/[id]` (estrazione delle viste da `page.tsx`)

**Files:**
- Create: `src/components/study/{types.ts,styles.ts,modes.ts,Markdown.tsx,TutorView.tsx,ReviewView.tsx,StudioView.tsx,StudyShell.tsx}`
- Create: `src/app/study/[id]/page.tsx`
- Modify: `src/app/page.tsx` → segnaposto che reindirizza alla Libreria (la Libreria vera arriva nel Task 8)
- Delete: `src/app/api/domains/route.ts`
- Test: `tests/modes.test.ts`

**Interfaces:**
- Consumes: `getLibrary`, `getTrail`, `Trail` (Task 2); `post` (Task 6); `MapStudio` (`components/mappe/MapStudio.tsx`, props `{ domainId?: number; onAskTutor: (text: string) => void }`).
- Produces: `type UrlMode = "tutor" | "quiz" | "review" | "studio"`, `MODES`, `parseMode(v: unknown): UrlMode`; `StudyShell` props `{ trail: Trail; tree: StudyTree; mode: UrlMode }` con `interface StudyTree { macros: { id: number; name: string; courses: { id: number; name: string }[] }[]; loose: { id: number; name: string }[] }`.

Contesto: oggi tutto sta in `src/app/page.tsx` (481 righe, client). Riferimenti nel file **al commit `f8175cb`** (vedi `git show f8175cb:src/app/page.tsx`): tipi a righe 10–41 (+ `SlideT` a 328), `mmss`/`sessionKey` 43–44, `Home` 46–268 (funzioni del ripasso `loadDue`…`nextCard` 100–131, `submitAnswer`/`send`/`placeholder` 133–169, render 171–266: player 190–200, thread + barra di input 213–263), `ReviewView` 270–325, `type Tool` 327, `StudioView` 330–415, `Markdown` 418–434, `chat`/`post` 436–448, oggetto stili `S` 450–481. In caso di dubbio valgono i nomi delle funzioni, non i numeri. Lo spostamento deve essere **comportamentalmente identico**: stessa sessione socratica in localStorage (`sb_session_<domainId>`), stesso player video, stessa mappa a tutta larghezza.

- [ ] **Step 1: Test di `parseMode` (fallisce)**

`tests/modes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMode } from "@/components/study/modes";

test("parseMode: valori validi, default tutor per mancante/invalido/array", () => {
  assert.equal(parseMode("quiz"), "quiz");
  assert.equal(parseMode("studio"), "studio");
  assert.equal(parseMode(undefined), "tutor");
  assert.equal(parseMode("socratic"), "tutor");
  assert.equal(parseMode(["review"]), "tutor");
});
```

Run: `npm test` → FAIL.

- [ ] **Step 2: `modes.ts`, `types.ts`, `styles.ts`, `Markdown.tsx`**

`src/components/study/modes.ts`:

```ts
/** Modalità dell'area studio, nell'URL (`?mode=`) così Indietro/ricarica/link funzionano. */
export type UrlMode = "tutor" | "quiz" | "review" | "studio";

export const MODES: { key: UrlMode; label: string }[] = [
  { key: "tutor", label: "Tutor" },
  { key: "quiz", label: "Quiz" },
  { key: "review", label: "Ripasso" },
  { key: "studio", label: "Studio" },
];

export function parseMode(v: unknown): UrlMode {
  return typeof v === "string" && MODES.some((m) => m.key === v) ? (v as UrlMode) : "tutor";
}
```

`src/components/study/types.ts`: sposta **verbatim** da `page.tsx` le interfacce `Citation`, `QuizQuestion`, `Grade`, `Msg`, `ReviewCard`, `ReviewResult`, `SlideT` e le costanti `mmss`, `sessionKey`, aggiungendo `export` a ciascuna.

`src/components/study/styles.ts`: sposta **verbatim** l'oggetto `S` (righe 450–481) come `export const S: Record<string, React.CSSProperties> = { … }`, con `import type React from "react";` in testa, e **cambia solo** `main` in:

```ts
  main: { width: "100%", margin: "0 auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 16px" },
```

(l'altezza ora la dà il layout: `100dvh` dentro l'header globale farebbe scorrere tutta la pagina).

`src/components/study/Markdown.tsx`: `"use client";` + la funzione `Markdown` verbatim (righe 418–434) come `export default function Markdown`.

- [ ] **Step 3: `TutorView.tsx` (socratico + quiz)**

Crea `src/components/study/TutorView.tsx` partendo da `Home` in `page.tsx`, **tenendo solo** la parte chat:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { post } from "@/lib/client/api";
import { S } from "./styles";
import { mmss, sessionKey, type Citation, type Grade, type Msg, type QuizQuestion } from "./types";

async function chat(body: Record<string, unknown>) {
  return post<{ reply: string; citations?: Citation[]; question?: QuizQuestion; grade?: Grade; sessionId?: number }>("/api/chat", body);
}

/** Thread del tutor: `socratic` (sessione salvata e ripresa) o `quiz` (domanda → valutazione). */
export default function TutorView({ domainId, mode, initialInput = "" }: { domainId: number; mode: "socratic" | "quiz"; initialInput?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(initialInput);
  const [loading, setLoading] = useState(false);
  const [pendingQ, setPendingQ] = useState<QuizQuestion | null>(null);
  const [sessionId, setSessionId] = useState<number | undefined>();
  const [video, setVideo] = useState<{ path: string; startSec: number; label: string } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Socratico: riprende la sessione salvata per questo dominio (il componente è rimontato per dominio/modalità).
  useEffect(() => {
    if (mode !== "socratic") return;
    const sid = Number(localStorage.getItem(sessionKey(domainId)) || 0);
    if (!sid) return;
    fetch(`/api/session?id=${sid}`).then((r) => r.json()).then((s) => {
      if (s.history?.length) {
        setSessionId(sid);
        setMsgs(s.history.map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content })));
      }
    }).catch(() => {});
  }, [domainId, mode]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, loading]);

  // submitAnswer, send, placeholder: copiare VERBATIM da page.tsx (righe 133–169),
  // invariati: usano domainId, mode, chat, setX già definiti qui sopra.

  return (
    <>
      {/* blocco `video && (…)` del player: VERBATIM da page.tsx righe 190–200, senza la condizione sul mode */}
      {/* thread + inputBar: VERBATIM da page.tsx righe 213–263 (il ramo `else` del render),
          con `disabled={!domainId}` invariato */}
    </>
  );
}
```

I tre commenti nel corpo vanno **sostituiti** dal codice citato (è codice esistente da spostare, non da riscrivere). Nel JSX del player togli `&& (mode === "socratic" || mode === "quiz")`.

- [ ] **Step 4: `ReviewView.tsx` e `StudioView.tsx`**

`src/components/study/ReviewView.tsx`: componente **con stato proprio**.

```tsx
"use client";

import { useEffect, useState } from "react";
import { post } from "@/lib/client/api";
import { S } from "./styles";
import type { ReviewCard, ReviewResult } from "./types";

/** Ripasso SM-2: coda delle carte in scadenza (figli inclusi se è un macro) + generazione carte. */
export default function ReviewView({ domainId }: { domainId: number }) {
  const [due, setDue] = useState(0);
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [genTopic, setGenTopic] = useState("");
  const [busy, setBusy] = useState(false);

  // loadDue, generateCards, submitReview, nextCard: VERBATIM da page.tsx righe 100–131
  // (sono funzioni di Home; qui domainId è sempre definito, i guard `!domainId` restano innocui).

  useEffect(() => { void loadDue(domainId); }, [domainId]); // eslint-disable-line react-hooks/exhaustive-deps

  // JSX: il corpo di `function ReviewView(p)` di page.tsx (righe 275–324) con `p.x` → variabili locali:
  // p.due→due, p.card→card, p.answer→answer, p.setAnswer→setAnswer, p.result→result,
  // p.genTopic→genTopic, p.setGenTopic→setGenTopic, p.onGenerate→generateCards,
  // p.onSubmit→submitReview, p.onNext→nextCard, p.busy→busy, p.disabled→false.
}
```

Anche qui i commenti vanno sostituiti dal codice citato.

`src/components/study/StudioView.tsx`: `"use client";` + `StudioView` **verbatim** (righe 330–415) come `export default function StudioView`, con import `useEffect, useState` da react, `MapStudio` da `@/components/mappe/MapStudio`, `Markdown` da `./Markdown`, `post` da `@/lib/client/api`, `S` da `./styles`, `SlideT` da `./types`. Modifiche: la firma diventa `{ domainId: number; onWide: … ; onAskTutor: … }`; nel JSX della slide aggiungi `className="list-disc"` all'`<ul>` dei bullet (il preflight di Tailwind toglie i pallini). `type Tool` resta locale.

- [ ] **Step 5: `StudyShell.tsx` e la pagina**

`src/components/study/StudyShell.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Trail } from "@/lib/library";
import { MODES, type UrlMode } from "./modes";
import TutorView from "./TutorView";
import ReviewView from "./ReviewView";
import StudioView from "./StudioView";

export interface StudyTree {
  macros: { id: number; name: string; courses: { id: number; name: string }[] }[];
  loose: { id: number; name: string }[];
}

/** Barra dell'area studio (breadcrumb, cambio corso, modalità) + la vista della modalità. */
export default function StudyShell({ trail, tree, mode }: { trail: Trail; tree: StudyTree; mode: UrlMode }) {
  const router = useRouter();
  const [wide, setWide] = useState(false);   // la mappa concettuale usa tutta la larghezza
  const [draft, setDraft] = useState("");    // testo passato dallo Studio al tutor ("chiedi al tutor")
  const go = (m: UrlMode) => router.push(`/study/${trail.id}?mode=${m}`, { scroll: false });
  const href = (id: number) => `/study/${id}?mode=${mode}`;

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full mx-auto px-4" style={{ maxWidth: mode === "studio" && wide ? 1600 : 900 }}>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-border">
        <nav className="flex items-center gap-2 text-sm min-w-0">
          <Link href="/" className="text-fg-dim hover:text-fg">Libreria</Link>
          {trail.macro && (<><span className="text-fg-dim">›</span>
            <Link href={href(trail.macro.id)} className="text-fg-muted hover:text-fg truncate">{trail.macro.name}</Link></>)}
          <span className="text-fg-dim">›</span>
          <span className="font-display text-lg truncate">{trail.name}</span>
          <details className="relative">
            <summary className="list-none cursor-pointer text-fg-dim hover:text-fg px-1" aria-label="Cambia corso">▾</summary>
            <div className="absolute z-20 mt-2 w-72 max-h-96 overflow-y-auto bg-surface border border-border rounded-lg p-2 shadow-xl">
              {tree.macros.map((m) => (
                <div key={m.id} className="mb-2">
                  <Link href={href(m.id)} className="block px-2 py-1 rounded text-sm font-medium hover:bg-surface-2">{m.name}</Link>
                  {m.courses.map((c) => (
                    <Link key={c.id} href={href(c.id)} className={`block pl-5 pr-2 py-1 rounded text-sm hover:bg-surface-2 ${c.id === trail.id ? "text-accent" : "text-fg-muted"}`}>{c.name}</Link>
                  ))}
                </div>
              ))}
              {tree.loose.map((c) => (
                <Link key={c.id} href={href(c.id)} className={`block px-2 py-1 rounded text-sm hover:bg-surface-2 ${c.id === trail.id ? "text-accent" : ""}`}>{c.name}</Link>
              ))}
            </div>
          </details>
        </nav>
        <div className="flex bg-surface-2 border border-border rounded-md overflow-hidden text-sm">
          {MODES.map((m) => (
            <button key={m.key} onClick={() => go(m.key)}
              className={`px-3.5 py-1.5 ${mode === m.key ? "bg-accent text-bg font-medium" : "text-fg-muted hover:text-fg"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {trail.kind === "macro" && (
        <div className="flex flex-wrap items-center gap-2 py-2 text-xs text-fg-dim">
          <span>Stai studiando tutti i {trail.courses.length} corsi:</span>
          {trail.courses.map((c) => (
            <Link key={c.id} href={href(c.id)} className="border border-border rounded-full px-2.5 py-0.5 hover:border-border-strong hover:text-fg">{c.name}</Link>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {mode === "studio" ? (
          <StudioView domainId={trail.id} onWide={setWide} onAskTutor={(text) => { setDraft(text); go("tutor"); }} />
        ) : mode === "review" ? (
          <ReviewView key={trail.id} domainId={trail.id} />
        ) : (
          <TutorView key={`${trail.id}-${mode}`} domainId={trail.id} mode={mode === "quiz" ? "quiz" : "socratic"} initialInput={mode === "tutor" ? draft : ""} />
        )}
      </div>
    </div>
  );
}
```

`src/app/study/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getLibrary, getTrail } from "@/lib/library";
import StudyShell, { type StudyTree } from "@/components/study/StudyShell";
import { parseMode } from "@/components/study/modes";

export const dynamic = "force-dynamic";

export default async function StudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { mode } = await searchParams;
  const n = Number(id);
  const trail = Number.isInteger(n) ? getTrail(n) : null;
  if (!trail) notFound();
  const lib = getLibrary();
  const tree: StudyTree = {
    macros: lib.macros.map((m) => ({ id: m.id, name: m.name, courses: m.courses.map(({ id, name }) => ({ id, name })) })),
    loose: lib.loose.map(({ id, name }) => ({ id, name })),
  };
  return <StudyShell key={trail.id} trail={trail} tree={tree} mode={parseMode(mode)} />;
}
```

`src/app/page.tsx` (provvisorio fino al Task 8, sostituisci tutto):

```tsx
import { redirect } from "next/navigation";
import { getLibrary } from "@/lib/library";

export const dynamic = "force-dynamic";

// Provvisorio: la Libreria vera arriva nel task successivo.
export default function Home() {
  const lib = getLibrary();
  const first = lib.macros[0]?.id ?? lib.loose[0]?.id;
  if (first != null) redirect(`/study/${first}`);
  return <p className="p-8 text-fg-dim">Nessun corso.</p>;
}
```

Elimina `src/app/api/domains/route.ts` (`git rm`).

- [ ] **Step 6: Verifica**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

Verifica nel browser (Playwright MCP, `npm run dev` sul DB reale, porta 3000):
1. `/study/<id del macro>?mode=tutor` → breadcrumb "Libreria › <macro>", chip dei corsi, thread vuoto con il testo della modalità socratica; una domanda riceve risposta con citazioni; clic su una citazione con ▶ apre il player.
2. Tab Quiz → l'URL diventa `?mode=quiz`; il tasto Indietro torna a `?mode=tutor`.
3. Ricarica su `?mode=review` → resta Ripasso, contatore carte visibile.
4. Studio → Mappa concettuale: la tela si vede, ci si entra con doppio clic (il preflight di Tailwind non deve rompere lo SVG); le slide mostrano i pallini.
5. `/study/999999` → pagina 404; `/study/<id>?mode=boh` → Tutor.
6. Screenshot di Tutor e Studio salvati in `.playwright-mcp/` per confronto con lo stile precedente.

- [ ] **Step 7: Commit**

```bash
git add src/components/study src/app/study src/app/page.tsx tests/modes.test.ts
git rm src/app/api/domains/route.ts
git commit -m "Area studio /study/[id]: viste estratte da page.tsx, modalità nell'URL, breadcrumb e cambio corso

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Libreria `/`

**Files:**
- Modify: `src/app/page.tsx` (sostituisce il provvisorio)
- Create: `src/components/library/{LibraryView,DomainMenu,AreaInput,NewMacroButton}.tsx`

**Interfaces:**
- Consumes: `getLibrary`, `Library`, `MacroNode`, `CourseNode` (Task 2); `newInLibrary` (Task 4); `LIBRARY_DIR`; `api` (Task 6); `PATCH/POST/DELETE /api/library` (Task 5).
- Produces: `AreaInput` props `{ value: string[]; onChange: (v: string[]) => void; suggestions: string[] }` (riusato in `/add`, Task 9).

- [ ] **Step 1: `AreaInput.tsx`**

```tsx
"use client";

import { useState } from "react";

/** Chip delle aree con suggerimenti dalle aree esistenti. Invio o virgola aggiunge. */
export default function AreaInput({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const [text, setText] = useState("");
  const listId = `areas-${suggestions.length}`;
  const add = (raw: string) => {
    const t = raw.trim();
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((a) => (
        <span key={a} className="inline-flex items-center gap-1 bg-surface-2 border border-border rounded-full pl-2.5 pr-1 py-0.5 text-xs">
          {a}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== a))} className="text-fg-dim hover:text-fg px-1" aria-label={`Rimuovi ${a}`}>×</button>
        </span>
      ))}
      <input value={text} list={listId} placeholder="+ area"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text); } }}
        onBlur={() => text && add(text)}
        className="bg-transparent border-b border-border focus:border-accent outline-none text-xs py-0.5 w-24" />
      <datalist id={listId}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}
```

- [ ] **Step 2: `DomainMenu.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import type { Library } from "@/lib/library";
import AreaInput from "./AreaInput";

/** Menu "⋯" di una card: rinomina, aree, sposta in macro / rendi sciolto, elimina macro. */
export default function DomainMenu(p: {
  id: number; kind: "macro" | "course"; name: string; areas: string[]; parentId: number | null; library: Library;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(p.name);
  const [areas, setAreas] = useState(p.areas);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); setOpen(false); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  const patch = (body: Record<string, unknown>) => run(() => api("PATCH", "/api/library", { id: p.id, ...body }));
  const showAreas = p.kind === "macro" || p.parentId == null; // le aree valgono per macro e corsi sciolti

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="text-fg-dim hover:text-fg px-2 leading-none text-lg" aria-label="Azioni">⋯</button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 bg-surface border border-border rounded-lg p-3 shadow-xl flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-fg-dim">Nome</span>
            <div className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 bg-surface-2 border border-border rounded px-2 py-1" />
              <button disabled={busy || name.trim() === p.name} onClick={() => patch({ name })} className="text-accent">Salva</button>
            </div>
          </label>
          {showAreas && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.2em] text-fg-dim">Aree</span>
              <AreaInput value={areas} onChange={setAreas} suggestions={p.library.areas} />
              <button disabled={busy} onClick={() => patch({ areas })} className="self-end text-accent">Salva aree</button>
            </div>
          )}
          {p.kind === "course" && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.2em] text-fg-dim">Macro</span>
              <select value={p.parentId ?? ""} disabled={busy}
                onChange={(e) => patch({ parentId: e.target.value === "" ? null : Number(e.target.value) })}
                className="bg-surface-2 border border-border rounded px-2 py-1">
                <option value="">— nessuno (corso sciolto) —</option>
                {p.library.macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          )}
          {p.kind === "macro" && (
            <button disabled={busy} className="self-start text-danger"
              onClick={() => confirm(`Eliminare il macro "${p.name}"? I suoi corsi diventano sciolti; nessun materiale viene cancellato.`)
                && run(() => api("DELETE", "/api/library", { id: p.id }))}>
              Elimina macro
            </button>
          )}
          {err && <p className="text-danger text-xs">{err}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `NewMacroButton.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import type { Library } from "@/lib/library";

/** Crea un macro a mano e ci mette dentro dei corsi sciolti. */
export default function NewMacroButton({ library }: { library: Library }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setErr(null);
    try {
      await api("POST", "/api/library", { name, courseIds: picked });
      setOpen(false); setName(""); setPicked([]); router.refresh();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="border border-border rounded-md px-3 py-1.5 text-sm hover:border-border-strong">Nuovo macro</button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 bg-surface border border-border rounded-lg p-3 shadow-xl flex flex-col gap-2 text-sm">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome del macro"
            className="bg-surface-2 border border-border rounded px-2 py-1" />
          {library.loose.length > 0 && <span className="text-[10px] uppercase tracking-[0.2em] text-fg-dim mt-1">Corsi da metterci dentro</span>}
          <div className="max-h-48 overflow-y-auto flex flex-col gap-1">
            {library.loose.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="checkbox" checked={picked.includes(c.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />
                {c.name}
              </label>
            ))}
          </div>
          <button disabled={!name.trim()} onClick={create} className="self-end bg-accent text-bg rounded px-3 py-1 font-medium">Crea</button>
          {err && <p className="text-danger text-xs">{err}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `LibraryView.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CourseNode, Library, MacroNode } from "@/lib/library";
import DomainMenu from "./DomainMenu";
import NewMacroButton from "./NewMacroButton";

type Entry = { type: "macro"; m: MacroNode } | { type: "course"; c: CourseNode };
const NONE = "Senza area";

function Due({ n }: { n: number }) {
  return n > 0 ? <span className="text-accent tabular">{n} {n === 1 ? "carta" : "carte"} da ripassare</span> : null;
}

function MacroCard({ m, library }: { m: MacroNode; library: Library }) {
  return (
    <div className="border border-border bg-surface rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/study/${m.id}`} className="group min-w-0">
          <div className="text-[10px] uppercase tracking-[0.25em] text-fg-dim">Macro</div>
          <div className="font-display text-xl leading-tight group-hover:text-accent transition-colors">{m.name}</div>
          <div className="text-xs text-fg-dim mt-1 flex gap-3">
            <span className="tabular">{m.courses.length} {m.courses.length === 1 ? "corso" : "corsi"}</span><Due n={m.due} />
          </div>
        </Link>
        <DomainMenu id={m.id} kind="macro" name={m.name} areas={m.areas} parentId={null} library={library} />
      </div>
      {m.courses.length > 0 && (
        <ul className="flex flex-col border-t border-border pt-2">
          {m.courses.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <Link href={`/study/${c.id}`} className="py-1 text-sm text-fg-muted hover:text-fg truncate">▸ {c.name}</Link>
              <DomainMenu id={c.id} kind="course" name={c.name} areas={c.areas} parentId={m.id} library={library} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CourseCard({ c, library }: { c: CourseNode; library: Library }) {
  return (
    <div className="border border-border bg-surface rounded-lg p-4 flex items-start justify-between gap-2">
      <Link href={`/study/${c.id}`} className="group min-w-0">
        <div className="text-[10px] uppercase tracking-[0.25em] text-fg-dim">Corso</div>
        <div className="font-display text-xl leading-tight group-hover:text-accent transition-colors">{c.name}</div>
        <div className="text-xs text-fg-dim mt-1 flex gap-3"><span className="tabular">{c.docs} documenti</span><Due n={c.due} /></div>
      </Link>
      <DomainMenu id={c.id} kind="course" name={c.name} areas={c.areas} parentId={null} library={library} />
    </div>
  );
}

export default function LibraryView({ library, fresh, libraryDirName }: {
  library: Library; fresh: { path: string; name: string }[]; libraryDirName: string;
}) {
  const [q, setQ] = useState("");
  const empty = !library.macros.length && !library.loose.length;

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    const entries: Entry[] = [
      ...library.macros.filter((m) => match(m.name) || m.courses.some((c) => match(c.name))).map((m) => ({ type: "macro" as const, m })),
      ...library.loose.filter((c) => match(c.name)).map((c) => ({ type: "course" as const, c })),
    ];
    const by = new Map<string, Entry[]>();
    for (const e of entries) {
      const areas = e.type === "macro" ? e.m.areas : e.c.areas;
      for (const a of areas.length ? areas : [NONE]) by.set(a, [...(by.get(a) ?? []), e]);
    }
    return [...by.entries()].sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)));
  }, [library, q]);

  return (
    <div className="max-w-5xl w-full mx-auto px-4 md:px-8 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8 fade-up">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-fg-dim mb-2">Libreria</div>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight leading-none">I tuoi corsi</h1>
        </div>
        {!empty && (
          <div className="flex flex-wrap gap-2 items-center">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtra…"
              className="bg-surface-2 border border-border rounded-md px-3 py-1.5 text-sm w-44" />
            <NewMacroButton library={library} />
            <Link href="/add" className="bg-accent text-bg rounded-md px-3 py-1.5 text-sm font-medium">+ Aggiungi corso</Link>
          </div>
        )}
      </header>

      {fresh.length > 0 && (
        <Link href="/add" className="block mb-8 border border-accent-soft bg-surface rounded-lg px-4 py-3 text-sm hover:border-accent transition-colors">
          <b className="text-accent">{fresh.length} {fresh.length === 1 ? "nuovo corso trovato" : "nuovi corsi trovati"}</b>{" "}
          in {libraryDirName}/: {fresh.map((f) => f.name).join(", ")} — <span className="underline">Importa</span>
        </Link>
      )}

      {empty ? (
        <div className="border border-dashed border-border rounded-lg px-8 py-14 text-center">
          <p className="text-fg-muted mb-4">Nessun corso ancora. Copia un corso scaricato in <code>{libraryDirName}/</code> oppure scegli una cartella.</p>
          <Link href="/add" className="bg-accent text-bg rounded-md px-4 py-2 font-medium">+ Aggiungi corso</Link>
        </div>
      ) : sections.length === 0 ? (
        <p className="text-fg-dim">Nessun risultato per “{q}”.</p>
      ) : (
        sections.map(([area, entries]) => (
          <section key={area} className="mb-10">
            <h2 className="text-xs uppercase tracking-[0.3em] text-fg-dim mb-3">{area}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {entries.map((e) => e.type === "macro"
                ? <MacroCard key={`m${e.m.id}`} m={e.m} library={library} />
                : <CourseCard key={`c${e.c.id}`} c={e.c} library={library} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 5: `src/app/page.tsx` (sostituisci il provvisorio)**

```tsx
import path from "node:path";
import { getLibrary } from "@/lib/library";
import { newInLibrary } from "@/lib/ingestPlan";
import { LIBRARY_DIR } from "@/lib/libraryDir";
import LibraryView from "@/components/library/LibraryView";

export const dynamic = "force-dynamic";

/** Libreria: legge il DB lato server (niente flash di lista vuota), azioni via /api/library. */
export default async function LibraryPage() {
  const library = getLibrary();
  const fresh = await newInLibrary(LIBRARY_DIR);
  return <LibraryView library={library} fresh={fresh} libraryDirName={path.basename(LIBRARY_DIR)} />;
}
```

- [ ] **Step 6: Verifica**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

Nel browser (DB reale):
1. `/` mostra la specializzazione già importata come card macro con i suoi corsi, in "Senza area"; il banner segnala i corsi nuovi in `Courses/` non ancora importati.
2. ⋯ sul macro → aggiungi area "Web" → Salva aree → la card passa nella sezione "Web".
3. Filtro "react" → resta solo il macro che contiene un corso con quel nome.
4. Nuovo macro "Prova" senza corsi → compare; ⋯ → Elimina macro → sparisce.
5. Sposta un corso dal macro a "— nessuno —" e poi rimettilo: torna dentro la card.
6. Clic su un corso → `/study/<id>` con la breadcrumb giusta.

Ripristina l'organizzazione com'era (o come preferisce l'utente) dopo le prove.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx src/components/library
git commit -m "Libreria: card macro/corsi per area, filtro, banner nuovi corsi, organizzazione manuale

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Aggiungi corso `/add`

**Files:**
- Create: `src/app/add/page.tsx`, `src/components/add/{AddWizard,PlanEditor,FolderBrowser,ImportProgress}.tsx`

**Interfaces:**
- Consumes: tipi e `defaultPlan`/`groupIntoNewMacro` (`ingestPlanTypes.ts`, Task 4); `AreaInput` (Task 8); `api`/`post` (Task 6); API di Task 5 (`/api/ingest-folder/analyze`, `/api/ingest-folder`, `/api/library`); `GET /api/fs?path=` (esistente: `{ path, parent, root, dirs: { name, path }[] }`); `IngestJob`/`CourseProgress` (solo tipi).

- [ ] **Step 1: `ImportProgress.tsx`**

```tsx
"use client";

import Link from "next/link";
import type { IngestJob } from "@/lib/jobs";

export default function ImportProgress({ job, lost }: { job: IngestJob | null; lost: boolean }) {
  if (lost) {
    return (
      <div className="border border-danger rounded-lg p-4 text-sm">
        L’import si è interrotto (server riavviato?). Rilancialo: riparte dai file mancanti, quelli già fatti vengono saltati.
        <div className="mt-3"><Link href="/add" className="text-accent underline">Ricomincia</Link></div>
      </div>
    );
  }
  if (!job) return null;
  const done = job.status !== "running";
  return (
    <div className="flex flex-col gap-3">
      {job.courses.map((c, i) => {
        const pct = c.total ? Math.round((c.done / c.total) * 100) : c.status === "done" ? 100 : 0;
        return (
          <div key={i} className="border border-border bg-surface rounded-lg p-3">
            <div className="flex justify-between text-sm">
              <span>{c.macro ? <span className="text-fg-dim">{c.macro} › </span> : null}{c.name}</span>
              <span className={c.status === "error" ? "text-danger" : c.status === "done" ? "text-ok" : "text-fg-dim"}>
                {c.status === "pending" ? "in attesa" : c.status === "running" ? `${c.done}/${c.total} file` : c.status === "done" ? `${c.documents} documenti · ${c.chunks} chunk` : "errore"}
              </span>
            </div>
            <div className="h-1 bg-surface-2 rounded mt-2 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
            {c.error && <p className="text-danger text-xs mt-2 break-all">{c.error}</p>}
          </div>
        );
      })}
      {done && (
        <div className="flex gap-3 mt-2">
          <Link href="/" className="bg-accent text-bg rounded-md px-4 py-2 font-medium">Vai alla libreria</Link>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `FolderBrowser.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

interface Listing { path: string; parent: string | null; dirs: { name: string; path: string }[] }

/** Browser cartelle (sandbox lato server in /api/fs). */
export default function FolderBrowser({ onAnalyze, onCancel }: { onAnalyze: (path: string) => void; onCancel: () => void }) {
  const [cur, setCur] = useState<string | undefined>();
  const [list, setList] = useState<Listing | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/fs${cur ? `?path=${encodeURIComponent(cur)}` : ""}`).then((r) => r.json()).then((j) => {
      if (j.error) setErr(j.error); else { setErr(null); setList(j); }
    }).catch((e) => setErr(String(e)));
  }, [cur]);

  return (
    <div className="border border-border bg-surface rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <code className="text-fg-muted truncate">{list?.path}</code>
        <button onClick={onCancel} className="text-fg-dim hover:text-fg">Annulla</button>
      </div>
      <div className="max-h-80 overflow-y-auto flex flex-col">
        {list?.parent && <button onClick={() => setCur(list.parent!)} className="text-left px-2 py-1 rounded hover:bg-surface-2 text-fg-dim">↑ ..</button>}
        {list?.dirs.map((d) => (
          <button key={d.path} onClick={() => setCur(d.path)} className="text-left px-2 py-1 rounded hover:bg-surface-2">📁 {d.name}</button>
        ))}
      </div>
      {err && <p className="text-danger text-xs">{err}</p>}
      <button disabled={!list} onClick={() => list && onAnalyze(list.path)} className="self-end bg-accent text-bg rounded-md px-3 py-1.5 text-sm font-medium">
        Analizza questa cartella
      </button>
    </div>
  );
}
```

- [ ] **Step 3: `PlanEditor.tsx`**

```tsx
"use client";

import { useState } from "react";
import AreaInput from "@/components/library/AreaInput";
import { groupIntoNewMacro, type IngestPlan, type ItemAnalysis, type PlanCourse, type PlanParent } from "@/lib/ingestPlanTypes";

const STATUS: Record<PlanCourse["status"], string> = { new: "nuovo", upToDate: "aggiornato", changed: "" };

function summary(c: PlanCourse) {
  const n = c.counts;
  return [n.transcript && `${n.transcript} trascrizioni`, n.html && `${n.html} html`, n.pdf && `${n.pdf} pdf`, n.text && `${n.text} txt`, n.video && `${n.video} video`]
    .filter(Boolean).join(" · ");
}

const parentValue = (p: PlanParent) => (p == null ? "" : "macroKey" in p ? `k:${p.macroKey}` : `e:${p.existingId}`);
const parseParentValue = (v: string): PlanParent => (v === "" ? null : v.startsWith("k:") ? { macroKey: v.slice(2) } : { existingId: Number(v.slice(2)) });

/** Anteprima modificabile del piano di import. */
export default function PlanEditor(p: {
  items: ItemAnalysis[];
  plan: IngestPlan;
  setPlan: (plan: IngestPlan) => void;
  existingMacros: { id: number; name: string }[];
  areaSuggestions: string[];
  onToggleKind: (itemPath: string, as: "macro" | "course") => void;
  onImport: () => void;
  busy: boolean;
}) {
  const [groupName, setGroupName] = useState("");
  const { plan, setPlan } = p;
  const updCourse = (path: string, patch: Partial<PlanCourse>) =>
    setPlan({ ...plan, courses: plan.courses.map((c) => (c.path === path ? { ...c, ...patch } : c)) });
  const updMacro = (key: string, patch: Partial<IngestPlan["macros"][number]>) =>
    setPlan({ ...plan, macros: plan.macros.map((m) => (m.key === key ? { ...m, ...patch } : m)) });

  // Macro selezionabili come genitore: quelli esistenti nel DB + quelli nuovi del piano.
  const parentOptions = [
    ...p.existingMacros.map((m) => ({ value: `e:${m.id}`, label: m.name })),
    ...plan.macros.filter((m) => m.existingId == null).map((m) => ({ value: `k:${m.key}`, label: `${m.name} (nuovo)` })),
  ];
  const included = plan.courses.filter((c) => c.include);
  const looseIncluded = included.filter((c) => c.parent == null);
  const needsWhisper = included.some((c) => c.videosWithoutSubs > 0);

  const row = (c: PlanCourse) => (
    <div key={c.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-t border-border first:border-t-0">
      <input type="checkbox" checked={c.include} onChange={(e) => updCourse(c.path, { include: e.target.checked })} aria-label={`Importa ${c.name}`} />
      <input value={c.name} onChange={(e) => updCourse(c.path, { name: e.target.value })}
        className="bg-transparent border-b border-transparent hover:border-border focus:border-accent outline-none min-w-0 flex-1" />
      <span className="text-xs text-fg-dim">{summary(c)}</span>
      <span className={`text-xs ${c.status === "upToDate" ? "text-fg-dim" : "text-accent"}`}>
        {c.status === "changed" ? `${c.changedFiles} file nuovi o modificati` : STATUS[c.status]}
      </span>
      {c.videosWithoutSubs > 0 && <span className="text-xs text-danger">⚠ {c.videosWithoutSubs} video senza sottotitoli</span>}
      <select value={parentValue(c.parent)} onChange={(e) => updCourse(c.path, { parent: parseParentValue(e.target.value) })}
        className="bg-surface-2 border border-border rounded px-1.5 py-0.5 text-xs max-w-48">
        <option value="">nessun macro</option>
        {parentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {c.parent == null && <AreaInput value={c.areas} onChange={(areas) => updCourse(c.path, { areas })} suggestions={p.areaSuggestions} />}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {p.items.map((it) => {
        const macro = plan.macros.find((m) => m.key === it.path);
        const courses = plan.courses.filter((c) => it.courses.some((x) => x.path === c.path));
        return (
          <div key={it.path} className="border border-border bg-surface rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              {macro ? (
                <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
                  <span className="text-[10px] uppercase tracking-[0.25em] text-fg-dim">Macro</span>
                  <input value={macro.name} onChange={(e) => updMacro(macro.key, { name: e.target.value })}
                    className="font-display text-lg bg-transparent border-b border-transparent hover:border-border focus:border-accent outline-none min-w-0" />
                  <AreaInput value={macro.areas} onChange={(areas) => updMacro(macro.key, { areas })} suggestions={p.areaSuggestions} />
                </div>
              ) : (
                <span className="text-[10px] uppercase tracking-[0.25em] text-fg-dim">Corso singolo</span>
              )}
              <button onClick={() => p.onToggleKind(it.path, it.kind === "macro" ? "course" : "macro")} className="text-xs text-fg-dim hover:text-fg underline">
                {it.kind === "macro" ? "è un corso singolo" : "è una specializzazione (macro)"}
              </button>
            </div>
            {courses.map(row)}
          </div>
        );
      })}

      {looseIncluded.length >= 2 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg-dim">Raggruppa i {looseIncluded.length} corsi singoli selezionati in un nuovo macro:</span>
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Nome del macro"
            className="bg-surface-2 border border-border rounded px-2 py-1" />
          <button disabled={!groupName.trim()} onClick={() => { setPlan(groupIntoNewMacro(plan, looseIncluded.map((c) => c.path), groupName.trim())); setGroupName(""); }}
            className="border border-border rounded px-2 py-1 hover:border-border-strong">Raggruppa</button>
        </div>
      )}

      {needsWhisper && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={plan.whisper} onChange={(e) => setPlan({ ...plan, whisper: e.target.checked })} />
          Trascrivi con Whisper i video senza sottotitoli <span className="text-fg-dim">(lento: minuti per ogni ora di video)</span>
        </label>
      )}

      <button disabled={p.busy || !included.length} onClick={p.onImport} className="self-end bg-accent text-bg rounded-md px-4 py-2 font-medium">
        {included.length ? `Importa ${included.length} ${included.length === 1 ? "corso" : "corsi"}` : "Niente da importare"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: `AddWizard.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { api, post } from "@/lib/client/api";
import type { IngestJob } from "@/lib/jobs";
import { defaultPlan, type IngestPlan, type ItemAnalysis } from "@/lib/ingestPlanTypes";
import type { Library } from "@/lib/library";
import FolderBrowser from "./FolderBrowser";
import ImportProgress from "./ImportProgress";
import PlanEditor from "./PlanEditor";

type Phase = "loading" | "edit" | "browse" | "importing";

/** Aggiungi corso: analisi della cartella-libreria → anteprima modificabile → import con progresso. */
export default function AddWizard({ libraryDirName }: { libraryDirName: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [source, setSource] = useState<string | null>(null); // null = cartella-libreria
  const [items, setItems] = useState<ItemAnalysis[]>([]);
  const [plan, setPlan] = useState<IngestPlan | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [job, setJob] = useState<IngestJob | null>(null);
  const [lost, setLost] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function analyze(path: string | null) {
    setPhase("loading"); setErr(null); setSource(path);
    try {
      const r = await post<{ items: ItemAnalysis[] }>("/api/ingest-folder/analyze", path ? { path } : {});
      setItems(r.items); setPlan(defaultPlan(r.items)); setPhase("edit");
    } catch (e) { setErr((e as Error).message); setItems([]); setPlan(null); setPhase("edit"); }
  }

  function poll(id: string) {
    setPhase("importing");
    timer.current = setInterval(async () => {
      const r = await fetch(`/api/ingest-folder?job=${id}`);
      if (r.status === 404) { setLost(true); clearInterval(timer.current!); return; }
      const j: IngestJob = await r.json();
      setJob(j);
      if (j.status !== "running") clearInterval(timer.current!);
    }, 1000);
  }

  useEffect(() => {
    // Un import alla volta: se ce n'è uno in corso si mostra quello.
    fetch("/api/ingest-folder?active=1").then((r) => r.json()).then((r) => {
      if (r.job) { setJob(r.job); poll(r.job.id); } else void analyze(null);
    }).catch(() => void analyze(null));
    api<Library>("GET", "/api/library").then(setLibrary).catch(() => {});
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleKind(itemPath: string, as: "macro" | "course") {
    try {
      const r = await post<{ items: ItemAnalysis[] }>("/api/ingest-folder/analyze", { path: itemPath, as });
      const next = items.map((it) => (it.path === itemPath ? r.items[0] : it));
      setItems(next); setPlan(defaultPlan(next)); // le modifiche fatte all'anteprima si azzerano
    } catch (e) { setErr((e as Error).message); }
  }

  async function startImport() {
    if (!plan) return;
    setBusy(true); setErr(null);
    try { const r = await post<{ jobId: string }>("/api/ingest-folder", { plan }); poll(r.jobId); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-4xl w-full mx-auto px-4 md:px-8 py-10 flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-fg-dim mb-2">Aggiungi corso</div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight leading-none">
            {phase === "importing" ? "Import in corso" : source ? source.split("/").pop() : `Cartella ${libraryDirName}/`}
          </h1>
          {phase === "edit" && !source && (
            <p className="text-sm text-fg-muted mt-2">Copia i corsi scaricati in <code>{libraryDirName}/</code>: compaiono qui. Scegliere un’altra cartella serve solo se il corso sta altrove.</p>
          )}
        </div>
        {phase === "edit" && (
          <div className="flex gap-3 text-sm">
            {source && <button onClick={() => analyze(null)} className="text-fg-dim hover:text-fg">← {libraryDirName}/</button>}
            <button onClick={() => analyze(source)} className="text-fg-dim hover:text-fg">Controlla aggiornamenti</button>
            <button onClick={() => setPhase("browse")} className="text-fg-dim hover:text-fg">Scegli un’altra cartella…</button>
          </div>
        )}
      </header>

      {err && <p className="text-danger text-sm">{err}</p>}
      {phase === "loading" && <p className="text-fg-dim"><span className="spin" /> analizzo la cartella…</p>}
      {phase === "browse" && <FolderBrowser onAnalyze={(p) => analyze(p)} onCancel={() => setPhase("edit")} />}
      {phase === "edit" && plan && (items.length ? (
        <PlanEditor items={items} plan={plan} setPlan={setPlan} busy={busy}
          existingMacros={(library?.macros ?? []).map(({ id, name }) => ({ id, name }))}
          areaSuggestions={library?.areas ?? []} onToggleKind={toggleKind} onImport={startImport} />
      ) : (
        <p className="text-fg-dim">Nessun corso trovato{source ? " in questa cartella" : ` in ${libraryDirName}/`}.</p>
      ))}
      {phase === "importing" && <ImportProgress job={job} lost={lost} />}
    </div>
  );
}
```

- [ ] **Step 5: `src/app/add/page.tsx`**

```tsx
import path from "node:path";
import { LIBRARY_DIR } from "@/lib/libraryDir";
import AddWizard from "@/components/add/AddWizard";

export const dynamic = "force-dynamic";

export default function AddPage() {
  return <AddWizard libraryDirName={path.basename(LIBRARY_DIR)} />;
}
```

- [ ] **Step 6: Verifica end-to-end su DB e cartella-libreria temporanei**

Non si usa il DB reale: si crea una libreria di prova (serve Ollama per gli embedding: i file sono minuscoli).

```bash
E2E=/tmp/sb-e2e && rm -rf $E2E && mkdir -p "$E2E/lib/Spec Prova/Corso-uno/01_m" "$E2E/lib/Spec Prova/Corso-due/01_m" "$E2E/lib/corso dell'arte/01_intro" "$E2E/lib/corso dell'arte/02_altro"
printf '1\n00:00:01,000 --> 00:00:04,000\nThe box model describes margin, border, padding and content.\n' > "$E2E/lib/Spec Prova/Corso-uno/01_m/a.srt"
printf '<html><body><p>Flexbox aligns items along a main axis.</p></body></html>' > "$E2E/lib/Spec Prova/Corso-due/01_m/b.html"
printf '1\n00:00:01,000 --> 00:00:04,000\nPerspective drawing uses vanishing points.\n' > "$E2E/lib/corso dell'arte/01_intro/x.srt"
printf '1\n00:00:01,000 --> 00:00:04,000\nColor theory: hue, saturation, value.\n' > "$E2E/lib/corso dell'arte/02_altro/y.srt"
DB_PATH=$E2E/e2e.db npx tsx scripts/create-db.ts
DB_PATH=$E2E/e2e.db STUDYBUDDY_LIBRARY_DIR=$E2E/lib STUDYBUDDY_FS_ROOT=$E2E npx next dev -p 3100 > $E2E/dev.log 2>&1 &
```

(`STUDYBUDDY_FS_ROOT` serve: la sandbox di default è la home e `parsePlan` rifiuterebbe i percorsi in `/tmp` con 403.)

Con Playwright su `http://localhost:3100`:
1. `/` → Libreria vuota con il banner "2 nuovi corsi trovati in lib/".
2. `/add` → "Spec Prova" come macro con due corsi, "corso dell'arte" come corso singolo, tutti "nuovo" e selezionati.
3. Cambia "corso dell'arte" in macro e poi rimettilo come corso singolo (l'anteprima si aggiorna).
4. Aggiungi l'area "Test" al macro → Importa 3 corsi → progresso fino a "Vai alla libreria".
5. Libreria: sezione "Test" con il macro, "Senza area" con il corso singolo; nessun banner.
6. Sposta "Corso-uno" fuori dal macro (⋯ → nessuno), poi `/add` → Controlla aggiornamenti: tutti "aggiornato", Corso-uno proposto con "nessun macro". Modifica `a.srt` sul disco → Controlla aggiornamenti → "1 file nuovi o modificati" solo su Corso-uno; importa → Corso-uno resta sciolto.
7. Studia "corso dell'arte" in Tutor: una domanda sui vanishing points cita `x.srt`.
8. Durante un import, apri `/add` in un'altra scheda: mostra il progresso, non una nuova analisi.

Chiudi il server (`kill %1`) e cancella `/tmp/sb-e2e`.

- [ ] **Step 7: Commit**

```bash
git add src/app/add src/components/add
git commit -m "Aggiungi corso: analisi della cartella-libreria, anteprima modificabile, import con progresso

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Documentazione e verifica finale

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Aggiorna `CLAUDE.md`**

1. In "Stato attuale (fatto)" sostituisci il punto `UI (app/page.tsx, client): …` con:

```markdown
- UI a pagine: **Libreria** `/` (Server Component: card macro/corsi raggruppate per **aree**, filtro, banner dei corsi nuovi trovati nella cartella-libreria, organizzazione manuale via `/api/library`), **area studio** `/study/[id]?mode=tutor|quiz|review|studio` (`components/study/*`: breadcrumb, cambio corso, citazioni → video al minuto, quiz, ripasso SM-2, Studio), **Aggiungi** `/add` (analisi della cartella-libreria → anteprima modificabile → import con progresso). Stile e palette condivisi con `learning-vault` (Tailwind v4, font `@fontsource-variable/*`); le viste di studio usano ancora stili inline con gli alias `--panel`/`--accent`… definiti in `globals.css`.
```

2. In "Sorgente dati" aggiungi dopo il primo paragrafo:

```markdown
**Cartella-libreria**: i corsi si copiano a mano in `Courses/` (override `STUDYBUDDY_LIBRARY_DIR`, `lib/libraryDir.ts`) e si importano da `/add`. Ogni sottocartella è un elemento: **macro** se la maggioranza delle sue sottocartelle con materiale ha nomi non numerati (corsi di una specializzazione), **corso** se sono numerate (moduli `01_…`) — `classifyFolder` in `lib/ingestPlan.ts`, correggibile nell'anteprima. Gerarchia a 2 livelli macro → corsi (`resolveScope`); le **aree** (`domains.areas`) sono solo layout.
```

3. In "Note tecniche" aggiungi:

```markdown
- Organizzazione: `lib/library.ts` valida gli invarianti (macro senza genitore, corsi solo dentro macro, elimina solo macro senza dati di studio propri). Un dominio esistente cambia nome/macro/aree solo dalla Libreria o da un piano esplicito di `/add` (`parsePlan`/`applyPlan` in `lib/ingestTree.ts`): re-importare non disfa gli spostamenti manuali.
- `ingested_files` registra ogni file elaborato (anche senza chunk): l'analisi di `/add` confronta gli hash (`fileHashOf`, include `PARSER_VERSION`) per dire nuovo/aggiornato/modificato. Un import alla volta (`activeJob`, 409).
- **Non usare `npm run db:push` sul DB reale**: le tabelle virtuali `vec_chunks`/`chunks_fts` non sono nello schema Drizzle. Migrazioni = SQL esplicito dopo un backup. DB nuovo: `DB_PATH=… npx tsx scripts/create-db.ts`.
- Test: `npm test` (`node:test` via tsx, DB temporaneo per file con `tests/helpers/db.ts`, nessuna dipendenza da Ollama). `learning-vault/` è escluso dal typecheck e i suoi dati sono gitignored.
```

4. In "Comandi" aggiungi `· npm test`.

- [ ] **Step 2: Verifica finale**

Run: `npm test && npm run typecheck && npm run build`
Expected: tutto PASS.

Run: `git status --short`
Expected: nessun file di `Courses/` o `learning-vault/data` in stage o non tracciato inatteso.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: libreria, cartella-libreria, aree, test

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Consegna all'utente**

Riepilogo per l'utente: cosa è cambiato, come importare i corsi nuovi presenti in `Courses/` (Libreria → banner → `/add`, eventualmente raggruppandoli in un macro), che il README in inglese e i suoi screenshot mostrano ancora la vecchia UI (aggiornarli è un passo a parte), e che l'unione con `learning-vault` è il prossimo sotto-progetto.
