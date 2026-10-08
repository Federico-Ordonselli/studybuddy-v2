# F1 — Docker + GPU: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** far girare lo StudyBuddy di oggi (nessun codice del vault) in un container Docker con GPU: reranker e Whisper su CUDA, Ollama sull'host, dati in `./data`, corsi montati in sola lettura allo stesso percorso dell'host.

**Architecture:** un `Dockerfile` multi-stage su `nvidia/cuda:13.0.2-cudnn-runtime-ubuntu24.04` con Node 24 copiato dall'immagine ufficiale; `next build` + `next start` (niente `standalone`: i pacchetti nativi non si tracciano bene). Le lib CUDA 12 che servono a Whisper arrivano da pip nella `.venv` dell'immagine e `scripts/with-cuda.sh` le mette in `LD_LIBRARY_PATH`, come fuori da Docker. Un DB nuovo si crea da solo all'avvio (oggi serve `scripts/create-db.ts` con drizzle-kit, che nell'immagine non c'è). `/api/health` dice se DB, Ollama, reranker e Whisper funzionano.

**Tech Stack:** Docker Compose, NVIDIA Container Toolkit (runtime `nvidia` già presente), Next 16.3, Node 24.16, onnxruntime-node 1.30 (CUDA 13), faster-whisper 1.2.1 / ctranslate2 4.8 (CUDA 12 + cuDNN 9), better-sqlite3 13, sqlite-vec, `node:test` via tsx.

**Spec:** `docs/superpowers/specs/2026-10-09-unione-vault-design.md` (sezioni 4 e 6, fase F1).

## Global Constraints

- Local-first: Ollama resta sull'host (`OLLAMA_BASE_URL`, default `http://localhost:11434`); nessuna API cloud richiesta.
- Niente codice del vault in F1.
- Corsi montati **allo stesso percorso assoluto dell'host**, **in sola lettura** (`${COURSES_DIR}:${COURSES_DIR}:ro`).
- `STUDYBUDDY_LIBRARY_DIR=${COURSES_DIR}`, `STUDYBUDDY_FS_ROOT=${COURSES_DIR}`.
- Dati in `./data` (DB `/app/data/studybuddy.db`, modelli `/app/data/models`), `data/` gitignored.
- `network_mode: host`; GPU via `deploy.resources.reservations.devices`; override `compose.cpu.yaml` senza GPU.
- Utente `1000:1000` (sovrascrivibile).
- **Non toccare** `studybuddy-v2.db`, `learning-vault/`, `Courses/`: la verifica usa DB e cartella corsi temporanei.
- `npm run dev` / `npm start` fuori da Docker continuano a funzionare come oggi.
- Commit in italiano, `git add` di file espliciti, branch `f1-docker-gpu`, niente push senza ok.
- Versioni d'immagine esatte e verificate il 2026-10-09: `nvidia/cuda:13.0.2-cudnn-runtime-ubuntu24.04`, `node:24.16.0-bookworm-slim`.

## Fatti verificati che il piano usa

- `onnxruntime-node` 1.30.0 (installato): il provider CUDA dipende da **CUDA 13** (`libcublas.so.13`, `libcudart.so.13`, `libcurand.so.10`) e fa `dlopen` di `libcudnn.so` → base CUDA 13 **con** cuDNN. Il commento in `config.ts` e CLAUDE.md («compilato per CUDA 12») è superato: lo si corregge nel Task 5.
- `ctranslate2` 4.8.0 (faster-whisper 1.2.1) usa **CUDA 12 + cuDNN 9**: nella `.venv` dell'immagine servono `nvidia-cublas-cu12` e `nvidia-cudnn-cu12`. Sonames diversi (`.so.12` / `.so.13`): convivono.
- Driver host 615.71 (CUDA 13), runtime Docker `nvidia` presente.
- `transcribe.ts` cerca `.venv/bin/python` e `scripts/whisper_sidecar.py` relativi a `process.cwd()` → nell'immagine `WORKDIR /app` con `.venv` e `scripts/` lì. Whisper scrive solo in `os.tmpdir()`.
- Il sidecar accetta `WHISPER_DEVICE=cuda` e, se CUDA fallisce, scrive su stderr `[whisper] device=cuda non utilizzabile (…); fallback CPU/int8`.
- `reranker.cacheDir` oggi è `".models"` fisso; Transformers.js e faster-whisper scaricano i modelli al primo uso.
- `src/lib/db/index.ts` apre `DB_PATH` all'import; su un file nuovo non crea tabelle (lo fa `scripts/create-db.ts` con `drizzle-kit/api`, devDependency).
- `tests/helpers/db.ts` crea lo schema con `drizzle-kit/api` dopo aver importato `@/lib/db`.
- Non esiste `public/`.

## Review Focus

1. **Primo avvio su `./data` vuota**: il DB non esiste → si crea con lo schema e l'app funziona (Task 1, test «DB nuovo»).
2. **DB esistente con dati**: lo schema automatico non deve eseguire niente (nessun `CREATE` su tabelle esistenti, righe intatte) (Task 1, test «DB esistente»).
3. **Ollama spento o irraggiungibile**: `/api/health` risponde in ≤ ~2 s con `ollama.ok = false` e un errore leggibile, senza bloccare (Task 2, test con porta chiusa).
4. **Senza GPU** (`compose.cpu.yaml`, o driver assente): il container parte, il reranker ripiega su CPU e `/api/health?warm=1` dice `cpu` (Task 4, verifica manuale passo CPU).
5. **`COURSES_DIR` non impostata**: `docker compose` si rifiuta con un messaggio chiaro invece di montare la radice (Task 4, passo `docker compose config`).

---

### Task 1: schema automatico su un DB nuovo

Oggi un DB nuovo si crea con `scripts/create-db.ts`, che usa `drizzle-kit/api` (devDependency, assente nell'immagine). Si genera una volta lo SQL dello schema in un modulo TS committato; `lib/db/index.ts` lo esegue solo se il DB non ha tabelle. Un test impedisce che il modulo generato resti indietro rispetto a `schema.ts`.

**Files:**
- Create: `scripts/schema-sql.ts` (generatore + CLI)
- Create: `src/lib/db/schemaSql.ts` (generato, committato)
- Modify: `src/lib/db/index.ts` (funzione `initSchema()` prima di `ensureLibrarySchema()`)
- Modify: `tests/helpers/db.ts` (niente più migrazione manuale)
- Modify: `scripts/create-db.ts` (basta aprire il DB)
- Modify: `package.json` (script `db:schema`)
- Test: `tests/schemaSql.test.ts`

**Interfaces:**
- Produces: `SCHEMA_SQL: string[]` in `src/lib/db/schemaSql.ts`; `initSchema(): void` esportata da `src/lib/db/index.ts`; `generateSchemaSql(): Promise<string[]>` in `scripts/schema-sql.ts`; script `npm run db:schema`.

- [ ] **Step 1: crea il branch**

```bash
git checkout main && git checkout -b f1-docker-gpu
```

- [ ] **Step 2: scrivi il generatore**

`scripts/schema-sql.ts`:

```ts
/**
 * Genera `src/lib/db/schemaSql.ts`: lo SQL che crea lo schema Drizzle su un DB vuoto.
 * Serve a creare un DB nuovo senza drizzle-kit (devDependency, assente in Docker).
 * Le tabelle virtuali vec0/FTS5 le crea l'app al primo uso.
 *
 *   npm run db:schema
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function generateSchemaSql(): Promise<string[]> {
  const schema = await import("@/lib/db/schema");
  const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import("drizzle-kit/api");
  const prev = await generateSQLiteDrizzleJson({});
  const cur = await generateSQLiteDrizzleJson({ ...schema });
  return generateSQLiteMigration(prev, cur);
}

export function renderModule(stmts: string[]): string {
  return (
    "// Generato da `npm run db:schema` (scripts/schema-sql.ts): non modificare a mano.\n" +
    "// Lo esegue `initSchema()` in lib/db/index.ts solo su un DB senza tabelle.\n" +
    `export const SCHEMA_SQL: string[] = ${JSON.stringify(stmts, null, 2)};\n`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.resolve("src/lib/db/schemaSql.ts");
  generateSchemaSql()
    .then((s) => { fs.writeFileSync(out, renderModule(s)); console.log(`Scritto ${out} (${s.length} istruzioni)`); })
    .catch((e) => { console.error(e); process.exit(1); });
}
```

In `package.json`, dentro `"scripts"`, dopo `"db:studio"`:

```json
    "db:schema": "tsx scripts/schema-sql.ts",
```

- [ ] **Step 3: genera il modulo**

Run: `npm run db:schema`
Expected: `Scritto …/src/lib/db/schemaSql.ts (N istruzioni)` con N > 0; il file contiene `CREATE TABLE \`domains\``.

- [ ] **Step 4: scrivi i test (falliscono: `initSchema` non esiste)**

`tests/schemaSql.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { generateSchemaSql, renderModule } from "../scripts/schema-sql";

const tables = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

test("schemaSql.ts è allineato a schema.ts (altrimenti: npm run db:schema)", async () => {
  const committed = fs.readFileSync(path.resolve("src/lib/db/schemaSql.ts"), "utf8");
  assert.equal(committed, renderModule(await generateSchemaSql()));
});

test("DB nuovo: initSchema crea le tabelle; una seconda chiamata non fa nulla", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-schema-"));
  process.env.DB_PATH = path.join(dir, "nuovo.db");
  const { sqlite, initSchema } = await import("@/lib/db");
  for (const t of ["domains", "documents", "chunks", "cards", "sessions", "concept_maps", "ingested_files"]) {
    assert.ok(tables(sqlite).includes(t), t);
  }
  sqlite.prepare("INSERT INTO domains (name, kind) VALUES ('x', 'course')").run();
  initSchema(); // idempotente
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM domains").get() as { n: number }).n, 1);
});
```

`tests/schemaExisting.test.ts` (file a sé: `@/lib/db` apre `DB_PATH` all'import, un DB per processo):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

test("DB esistente con dati: initSchema non esegue niente e i dati restano", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-schema-"));
  const file = path.join(dir, "esistente.db");
  const pre = new Database(file);
  // forma minima di un DB reale: domains c'è già (con la colonna areas)
  pre.exec("CREATE TABLE domains (id integer PRIMARY KEY AUTOINCREMENT, name text NOT NULL, description text, parent_id integer, kind text DEFAULT 'course' NOT NULL, path text, areas text DEFAULT '[]' NOT NULL, created_at integer)");
  pre.prepare("INSERT INTO domains (name, kind) VALUES ('mio corso', 'course')").run();
  pre.close();
  process.env.DB_PATH = file;
  const { sqlite } = await import("@/lib/db");
  const names = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
  assert.ok(!names.includes("documents"), "initSchema non deve creare tabelle su un DB che ne ha già");
  assert.equal((sqlite.prepare("SELECT name FROM domains").get() as { name: string }).name, "mio corso");
});
```

(Le colonne sono quelle di `domains` in `src/lib/db/schema.ts`; `ensureLibrarySchema()` all'import aggiunge `ingested_files`, ed è giusto così: il test controlla solo che `initSchema()` non crei le tabelle dello schema.)

- [ ] **Step 5: esegui i test e verifica che falliscono**

Run: `npx tsx --test tests/schemaSql.test.ts tests/schemaExisting.test.ts`
Expected: FAIL nel test «DB nuovo» (tabelle mancanti / `initSchema` non è una funzione). Il test di allineamento passa già; «DB esistente» può già passare (oggi nessuno crea tabelle): è la guardia per lo Step 6.

- [ ] **Step 6: implementa `initSchema()`**

In `src/lib/db/index.ts`, aggiungi l'import e la funzione, e chiamala prima di `ensureLibrarySchema()`:

```ts
import { SCHEMA_SQL } from "./schemaSql";
```

```ts
/**
 * DB nuovo (nessuna tabella): crea lo schema Drizzle da `schemaSql.ts`, così il primo
 * avvio funziona anche dove drizzle-kit non c'è (Docker). Su un DB che ha già tabelle
 * non fa nulla: le aggiunte successive le fanno le `ensure*Schema()`.
 */
export function initSchema() {
  const n = (sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
  if (n > 0) return;
  sqlite.transaction(() => { for (const stmt of SCHEMA_SQL) sqlite.exec(stmt); })();
}
```

e in fondo, al posto della chiamata singola:

```ts
initSchema();
ensureLibrarySchema();
```

- [ ] **Step 7: semplifica l'helper dei test e `create-db.ts`**

`tests/helpers/db.ts`, corpo di `useTempDb`:

```ts
export async function useTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  const { sqlite } = await import("@/lib/db"); // initSchema crea lo schema sul DB nuovo
  return { dir, sqlite };
}
```

(aggiorna anche il commento sopra la funzione: lo schema lo crea `initSchema()`).

`scripts/create-db.ts`, corpo di `main()` dopo il controllo di esistenza:

```ts
  await import("@/lib/db"); // initSchema() crea lo schema sul file nuovo
  console.log(`Creato ${target}`);
```

e nel commento in testa: «Crea un DB nuovo (lo schema lo crea `initSchema()` all'apertura).»

- [ ] **Step 8: tutta la suite e typecheck**

Run: `npm test && npm run typecheck`
Expected: tutti i test PASS (52 + 3 nuovi), typecheck senza errori.

- [ ] **Step 9: commit**

```bash
git add scripts/schema-sql.ts src/lib/db/schemaSql.ts src/lib/db/index.ts tests/helpers/db.ts scripts/create-db.ts package.json tests/schemaSql.test.ts tests/schemaExisting.test.ts
git commit -m "DB: lo schema si crea da solo su un DB nuovo

SQL dello schema generato in lib/db/schemaSql.ts (npm run db:schema),
eseguito da initSchema() solo se il DB non ha tabelle: il primo avvio
funziona anche senza drizzle-kit (Docker). Un test tiene il file
allineato a schema.ts.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `/api/health`

Una route che dice se DB, Ollama, reranker e Whisper funzionano. Con `?warm=1` carica il reranker (serve a verificare la GPU nel container senza fare una domanda al tutor).

**Files:**
- Create: `src/lib/health.ts`
- Create: `src/app/api/health/route.ts`
- Modify: `src/lib/rag/reranker.ts` (stato del caricamento)
- Modify: `src/lib/providers/ollama.ts` (esporta l'URL base)
- Test: `tests/health.test.ts`

**Interfaces:**
- Consumes: `sqlite` da `@/lib/db`; `whisperAvailable(): boolean` da `@/lib/transcribe`.
- Produces: `type RerankerState = "idle" | "loading" | "cuda" | "cpu" | "error"`; `rerankerState(): RerankerState` e `warmReranker(): Promise<void>` da `src/lib/rag/reranker.ts`; `ollamaBaseUrl(): string` da `src/lib/providers/ollama.ts`; `getHealth(opts?: { warm?: boolean }): Promise<Health>` da `src/lib/health.ts` con

```ts
export interface Health {
  ok: boolean; // db.ok && ollama.ok
  db: { ok: boolean; error?: string };
  ollama: { ok: boolean; url: string; models?: string[]; error?: string };
  reranker: RerankerState;
  whisper: { available: boolean };
}
```

- [ ] **Step 1: scrivi il test (fallisce: `@/lib/health` non esiste)**

`tests/health.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { useTempDb } from "./helpers/db";

let H: typeof import("@/lib/health");
let server: http.Server;
let base: string;

before(async () => {
  await useTempDb();
  H = await import("@/lib/health");
  server = http.createServer((req, res) => {
    if (req.url === "/api/tags") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ models: [{ name: "gemma4:12b" }, { name: "qwen3-embedding:0.6b" }] })); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test("health: DB ok, Ollama raggiungibile con i suoi modelli, reranker non ancora caricato", async () => {
  process.env.OLLAMA_BASE_URL = base;
  const h = await H.getHealth();
  assert.equal(h.db.ok, true);
  assert.equal(h.ollama.ok, true);
  assert.deepEqual(h.ollama.models, ["gemma4:12b", "qwen3-embedding:0.6b"]);
  assert.equal(h.reranker, "idle");
  assert.equal(typeof h.whisper.available, "boolean");
  assert.equal(h.ok, true);
});

test("health: Ollama spento ⇒ ok:false con errore leggibile, in fretta", async () => {
  // porta appena liberata: connessione rifiutata
  const tmp = http.createServer();
  await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", r));
  const port = (tmp.address() as AddressInfo).port;
  await new Promise<void>((r) => tmp.close(() => r()));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  const h = await H.getHealth();
  assert.ok(Date.now() - t0 < 4000, "non deve bloccare"); // margine: whisperAvailable() avvia Python
  assert.equal(h.ollama.ok, false);
  assert.ok(h.ollama.error && h.ollama.error.length > 0);
  assert.equal(h.ok, false);
  assert.equal(h.db.ok, true);
});
```

- [ ] **Step 2: esegui e verifica che fallisce**

Run: `npx tsx --test tests/health.test.ts`
Expected: FAIL, `Cannot find module '@/lib/health'`.

- [ ] **Step 3: stato del reranker**

In `src/lib/rag/reranker.ts`, sotto la dichiarazione di `modelPromise`:

```ts
export type RerankerState = "idle" | "loading" | "cuda" | "cpu" | "error";
let state: RerankerState = "idle";

/** Dove gira il cross-encoder: `idle` finché nessuno lo ha caricato. */
export const rerankerState = (): RerankerState => state;

/** Carica il modello senza fare un rerank (per /api/health?warm=1). */
export async function warmReranker(): Promise<void> {
  await load();
}
```

Dentro `load()`: all'inizio dell'IIFE `state = "loading";`; prima di `return { tokenizer, model };` nel ramo CUDA `state = "cuda";`; prima del `return` nel ramo CPU `state = "cpu";`; nel `modelPromise.catch(...)` esistente aggiungi `state = "error";`:

```ts
    modelPromise.catch(() => { modelPromise = null; state = "error"; });
```

- [ ] **Step 4: URL base di Ollama esportato**

In `src/lib/providers/ollama.ts` sostituisci la riga 4:

```ts
/** URL di Ollama (letto a ogni chiamata: i test e Docker lo cambiano via env). */
export const ollamaBaseUrl = () => process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const BASE = ollamaBaseUrl;
```

- [ ] **Step 5: `lib/health.ts`**

```ts
import { sqlite } from "@/lib/db";
import { ollamaBaseUrl } from "@/lib/providers/ollama";
import { rerankerState, warmReranker, type RerankerState } from "@/lib/rag/reranker";
import { whisperAvailable } from "@/lib/transcribe";

export interface Health {
  ok: boolean; // db.ok && ollama.ok
  db: { ok: boolean; error?: string };
  ollama: { ok: boolean; url: string; models?: string[]; error?: string };
  reranker: RerankerState;
  whisper: { available: boolean };
}

const msg = (e: unknown) => (e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e));

function checkDb(): Health["db"] {
  try {
    sqlite.prepare("SELECT count(*) FROM domains").get();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

async function checkOllama(): Promise<Health["ollama"]> {
  const url = ollamaBaseUrl();
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { ok: false, url, error: `HTTP ${r.status}` };
    const j = (await r.json()) as { models?: { name: string }[] };
    return { ok: true, url, models: (j.models ?? []).map((m) => m.name) };
  } catch (e) {
    return { ok: false, url, error: msg(e) };
  }
}

/** Stato dei pezzi che servono all'app. `warm` carica il reranker (GPU o CPU) prima di rispondere. */
export async function getHealth(opts: { warm?: boolean } = {}): Promise<Health> {
  if (opts.warm) await warmReranker().catch(() => {}); // l'errore resta in rerankerState()
  const db = checkDb();
  const ollama = await checkOllama();
  return { ok: db.ok && ollama.ok, db, ollama, reranker: rerankerState(), whisper: { available: whisperAvailable() } };
}
```

- [ ] **Step 6: la route**

`src/app/api/health/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stato di DB, Ollama, reranker, Whisper. `?warm=1` carica il reranker (verifica GPU). */
export async function GET(req: NextRequest) {
  const h = await getHealth({ warm: req.nextUrl.searchParams.get("warm") === "1" });
  return NextResponse.json(h, { status: h.db.ok ? 200 : 503 });
}
```

- [ ] **Step 7: test, suite, typecheck**

Run: `npx tsx --test tests/health.test.ts && npm test && npm run typecheck`
Expected: PASS ovunque.

- [ ] **Step 8: commit**

```bash
git add src/lib/health.ts src/app/api/health/route.ts src/lib/rag/reranker.ts src/lib/providers/ollama.ts tests/health.test.ts
git commit -m "Health: /api/health con stato di DB, Ollama, reranker e Whisper

?warm=1 carica il reranker e dice se gira su GPU o CPU. Ollama con
timeout di 2 s: spento ⇒ errore leggibile, niente attese.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: immagine Docker

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `src/lib/config.ts` (`reranker.cacheDir` da env; commento CUDA corretto)

**Interfaces:**
- Consumes: `scripts/with-cuda.sh` (invariato), `scripts/whisper_sidecar.py`, `npm run build`.
- Produces: immagine `studybuddy:local`; env letti dall'app: `STUDYBUDDY_MODELS_DIR` (cache reranker), `HF_HOME` (cache faster-whisper), `HOST`, `PORT`.

- [ ] **Step 1: cache dei modelli configurabile**

In `src/lib/config.ts`, nel blocco `reranker`:

```ts
  cacheDir: process.env.STUDYBUDDY_MODELS_DIR ?? ".models", // in Docker: /app/data/models
```

e nel commento sopra `export const reranker`, sostituisci la riga «Le librerie CUDA 12 richieste da onnxruntime-node le aggiunge `scripts/with-cuda.sh`.» con:

```ts
 * onnxruntime-node 1.30 usa CUDA 13 (lib di sistema, o dell'immagine Docker); le lib
 * CUDA 12 che aggiunge `scripts/with-cuda.sh` servono a ctranslate2 (Whisper).
```

Run: `npm run typecheck` → nessun errore.

- [ ] **Step 2: `.dockerignore`**

```
# niente dati, segreti o artefatti locali nel contesto di build
.git
node_modules
.next
.venv
.models
.run
data
Courses
learning-vault
studio-mappe
.playwright-mcp
.claude
*.db
*.db-wal
*.db-shm
*.db.bak*
.env
.env.*
studybuddy.sh
docs/screenshots
```

- [ ] **Step 3: `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
# StudyBuddy con GPU. CUDA 13 + cuDNN per onnxruntime-node 1.30 (reranker);
# CUDA 12 + cuDNN 9 per ctranslate2 (Whisper) arrivano da pip nella .venv e
# scripts/with-cuda.sh le mette in LD_LIBRARY_PATH (sonames diversi: convivono).
FROM node:24.16.0-bookworm-slim AS node

FROM nvidia/cuda:13.0.2-cudnn-runtime-ubuntu24.04 AS base
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dipendenze Node (moduli nativi: toolchain solo qui) ----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build Next ----
# Le devDependencies restano: `next start` carica next.config.ts, e tsx serve alla
# CLI `npm run ingest` dentro il container. Il peso è trascurabile accanto a CUDA.
FROM deps AS build
COPY . .
RUN npm run build

# ---- venv Python: Whisper su GPU + yt-dlp ----
FROM base AS venv
RUN python3 -m venv /app/.venv \
 && /app/.venv/bin/pip install --no-cache-dir \
      faster-whisper==1.2.1 \
      nvidia-cublas-cu12 "nvidia-cudnn-cu12>=9,<10" \
      yt-dlp

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production \
    HOME=/tmp \
    HOST=127.0.0.1 \
    PORT=3000 \
    DB_PATH=/app/data/studybuddy.db \
    STUDYBUDDY_MODELS_DIR=/app/data/models \
    HF_HOME=/app/data/models/hf
COPY --from=venv /app/.venv ./.venv
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
RUN mkdir -p /app/data && chown -R 1000:1000 /app/.next /app/data
USER 1000:1000
EXPOSE 3000
CMD ["sh", "-c", "exec scripts/with-cuda.sh node_modules/.bin/next start -H \"$HOST\" -p \"$PORT\""]
```

- [ ] **Step 4: build**

Run: `docker build -t studybuddy:local .`
Expected: build completata. Non serve `ONNXRUNTIME_NODE_INSTALL`: in 1.30 il postinstall su linux/x64 scarica già il provider CUDA (in locale c'è `node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_cuda.so`). Lo Step 5 controlla che ci sia anche nell'immagine.

- [ ] **Step 5: controlli dentro l'immagine (GPU)**

Run:

```bash
docker run --rm --gpus all --entrypoint sh studybuddy:local -c '
  node -v
  ls node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_cuda.so
  ldconfig -p | grep -c "libcublas.so.13"
  scripts/with-cuda.sh sh -c "echo \$LD_LIBRARY_PATH" | tr ":" "\n" | grep -c nvidia
  .venv/bin/python -c "import faster_whisper, ctranslate2; print(ctranslate2.get_cuda_device_count())"
  .venv/bin/yt-dlp --version
'
```

Expected: `v24.16.0`; il `.so` esiste; conteggio `libcublas.so.13` ≥ 1; conteggio `nvidia` ≥ 2 (cublas, cudnn); `ctranslate2.get_cuda_device_count()` = `1`; una versione di yt-dlp.

- [ ] **Step 6: Whisper su GPU nel container**

```bash
docker run --rm --gpus all --entrypoint sh -e HF_HOME=/tmp/hf -e WHISPER_DEVICE=cuda studybuddy:local -c '
  ffmpeg -loglevel error -f lavfi -i "sine=frequency=440:duration=5" -f lavfi -i "color=c=black:s=320x240:d=5" -shortest /tmp/t.mp4
  scripts/with-cuda.sh .venv/bin/python scripts/whisper_sidecar.py /tmp/t.mp4 tiny 2>&1 >/dev/null | grep -c "fallback CPU" || true
'
```

Expected: stampa `0` (nessun fallback su CPU: CUDA e cuDNN 12 caricati). Il modello `tiny` si scarica (serve rete).

- [ ] **Step 7: commit**

```bash
git add Dockerfile .dockerignore src/lib/config.ts
git commit -m "Docker: immagine con GPU (CUDA 13 per il reranker, CUDA 12 + cuDNN 9 per Whisper)

Base nvidia/cuda 13.0.2 cudnn-runtime con Node 24.16; next build +
next start; venv con faster-whisper e yt-dlp. Cache dei modelli in
STUDYBUDDY_MODELS_DIR / HF_HOME (in Docker sotto /app/data/models).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Compose, override CPU e verifica end-to-end

**Files:**
- Create: `docker-compose.yml`
- Create: `compose.cpu.yaml`
- Create: `.env.example`
- Modify: `.gitignore` (aggiungi `data/`)

**Interfaces:**
- Consumes: immagine del Task 3, `/api/health` del Task 2, schema automatico del Task 1.
- Produces: `docker compose up -d` con `COURSES_DIR` in `.env`.

- [ ] **Step 1: `docker-compose.yml`**

```yaml
# StudyBuddy in Docker con GPU. Ollama gira sull'host (network_mode: host).
#   mkdir -p data && cp .env.example .env   # imposta COURSES_DIR
#   docker compose up -d --build            → http://localhost:3000
# Senza GPU: docker compose -f docker-compose.yml -f compose.cpu.yaml up -d --build
services:
  studybuddy:
    build: .
    image: studybuddy:local
    container_name: studybuddy
    restart: unless-stopped
    user: "${STUDYBUDDY_UID:-1000}:${STUDYBUDDY_GID:-1000}"
    network_mode: host
    env_file:
      - path: .env
        required: false
    environment:
      DB_PATH: /app/data/studybuddy.db
      OLLAMA_BASE_URL: ${OLLAMA_BASE_URL:-http://127.0.0.1:11434}
      # i corsi stanno allo stesso percorso dell'host: i percorsi già nel DB restano validi
      STUDYBUDDY_LIBRARY_DIR: ${COURSES_DIR:?imposta COURSES_DIR in .env (percorso assoluto della cartella dei corsi)}
      STUDYBUDDY_FS_ROOT: ${COURSES_DIR}
      HOST: ${HOST:-127.0.0.1}
      PORT: ${PORT:-3000}
    volumes:
      - ./data:/app/data
      - ${COURSES_DIR}:${COURSES_DIR}:ro
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

- [ ] **Step 2: `compose.cpu.yaml`**

```yaml
# Override senza GPU: reranker e Whisper ripiegano da soli su CPU.
services:
  studybuddy:
    deploy: !reset {}
```

- [ ] **Step 3: `.env.example` e `.gitignore`**

`.env.example`:

```bash
# Percorso ASSOLUTO della cartella dei corsi sull'host (montata in sola lettura,
# allo stesso percorso dentro il container).
COURSES_DIR=/home/utente/StudyBuddy/Courses

# Opzionali
# OLLAMA_BASE_URL=http://127.0.0.1:11434
# PORT=3000
# HOST=127.0.0.1                  # 0.0.0.0 + STUDYBUDDY_ALLOWED_HOSTS per la LAN
# STUDYBUDDY_UID=1000
# STUDYBUDDY_GID=1000
# ANTHROPIC_API_KEY=              # solo se abiliti un task su Anthropic in config.ts
```

In `.gitignore`, dopo il blocco `# database SQLite locale`:

```
# dati del container (DB, modelli, backup): mai nel repo
data/
```

- [ ] **Step 4: `COURSES_DIR` mancante ⇒ errore chiaro** (Review Focus 5)

Run (in una shell senza `.env` con `COURSES_DIR`): `env -u COURSES_DIR docker compose config >/dev/null`
Expected: errore che contiene `imposta COURSES_DIR in .env`.

- [ ] **Step 5: ambiente di prova temporaneo**

Corsi e dati di prova nella scratchpad (mai `Courses/`, mai `studybuddy-v2.db`). Un corso con un modulo, un `.srt` e il suo `.mp4` (per il video al minuto) e un video senza sottotitoli (per Whisper):

```bash
T=<scratchpad>/f1
mkdir -p $T/courses/corso-prova/01_intro $T/data
cat > $T/courses/corso-prova/01_intro/01_lezione.en.srt <<'EOF'
1
00:00:01,000 --> 00:00:06,000
A closure is a function that remembers the variables of the scope where it was created.

2
00:00:06,000 --> 00:00:12,000
Closures let inner functions keep access to outer variables after the outer function returns.
EOF
ffmpeg -loglevel error -f lavfi -i "color=c=black:s=320x240:d=12" -f lavfi -i "sine=frequency=440:duration=12" -shortest $T/courses/corso-prova/01_intro/01_lezione.mp4
```

e un `.env` **di prova** passato con `--env-file` (non il `.env` del repo):

```bash
printf 'COURSES_DIR=%s\nPORT=3124\n' $T/courses > $T/test.env
```

Per non usare `./data` del repo, avvia con un override del volume dati:

```bash
cat > $T/compose.test.yaml <<EOF
services:
  studybuddy:
    volumes: !override
      - $T/data:/app/data
      - $T/courses:$T/courses:ro
EOF
docker compose --env-file $T/test.env -f docker-compose.yml -f $T/compose.test.yaml up -d --build
```

- [ ] **Step 6: primo avvio, DB nuovo, GPU** (Review Focus 1)

```bash
until curl -sf localhost:3124/api/health >/dev/null; do sleep 1; done
curl -s localhost:3124/api/health | jq '{ok, db, ollama: {ok: .ollama.ok}, reranker, whisper}'
curl -s "localhost:3124/api/health?warm=1" | jq .reranker
ls -la $T/data
```

Expected: `db.ok: true`, `ollama.ok: true` (Ollama acceso sull'host), `reranker: "idle"`, `whisper.available: true`; con `warm=1` → `"cuda"`; in `$T/data` ci sono `studybuddy.db` e `models/` di proprietà dell'utente 1000.

- [ ] **Step 7: import, chat, video al minuto, Whisper — via UI (Playwright)**

Con Playwright su `http://localhost:3124`:
1. `/add`: la cartella-libreria (il `$T/courses` montato) propone `corso-prova` → Importa → import completato.
2. `/study/<id>?mode=tutor`: domanda «What is a closure?» → risposta con almeno una citazione `01_lezione` con link al minuto.
3. Clic sulla citazione → il video si apre (richiesta `/api/video` con `206 Partial Content` nei network requests).
4. `docker compose logs studybuddy | grep reranker` → contiene `su CUDA (fp16)`.

5. CLI nel container: `docker compose --env-file $T/test.env -f docker-compose.yml -f $T/compose.test.yaml exec studybuddy npm run ingest -- $T/courses/corso-prova corso-cli` → termina senza errori e stampa le statistiche (la CLI usa `tsx` e i sorgenti `src/`, copiati nell'immagine apposta).

L'import da UI non attiva Whisper (solo la CLI con `--whisper`); la GPU di Whisper è verificata al Task 3 Step 6 con lo stesso sidecar e la stessa `.venv`.

- [ ] **Step 8: senza GPU** (Review Focus 4)

```bash
docker compose --env-file $T/test.env -f docker-compose.yml -f $T/compose.test.yaml -f compose.cpu.yaml up -d
until curl -sf localhost:3124/api/health >/dev/null; do sleep 1; done
curl -s "localhost:3124/api/health?warm=1" | jq .reranker
```

Expected: `"cpu"`; una domanda al tutor risponde comunque (più lento).

- [ ] **Step 9: pulizia**

```bash
docker compose --env-file $T/test.env -f docker-compose.yml -f $T/compose.test.yaml down
rm -rf $T
```

(i file in `$T/data` sono dell'utente 1000 = tu: si cancellano senza sudo.)

- [ ] **Step 10: commit**

```bash
git add docker-compose.yml compose.cpu.yaml .env.example .gitignore
git commit -m "Docker: compose con GPU, override CPU, corsi in sola lettura allo stesso percorso

network_mode host per Ollama sull'host; ./data per DB e modelli;
COURSES_DIR obbligatoria (errore chiaro se manca). Verificato su DB e
corsi temporanei: reranker su CUDA, import, chat con citazioni, video.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: documentazione

**Files:**
- Modify: `README.md` (sezione Docker, in inglese)
- Modify: `CLAUDE.md` (note tecniche)

- [ ] **Step 1: README**

Aggiungi una sezione `## Run with Docker (GPU)` dopo la sezione di installazione esistente (leggi prima il README per collocarla e seguirne il tono):

````markdown
## Run with Docker (GPU)

Requirements: Docker with the NVIDIA Container Toolkit, and [Ollama](https://ollama.com) running on the host with the models in `src/lib/config.ts` pulled.

```bash
mkdir -p data
cp .env.example .env        # set COURSES_DIR to the absolute path of your courses folder
docker compose up -d --build
```

Open http://localhost:3000. Courses are mounted read-only at the same path as on the host; the database and model caches live in `./data`. Check the setup at http://localhost:3000/api/health (`?warm=1` loads the reranker and reports `cuda` or `cpu`).

No GPU: `docker compose -f docker-compose.yml -f compose.cpu.yaml up -d --build` (reranker and Whisper fall back to CPU).
````

- [ ] **Step 2: CLAUDE.md**

Nelle «Note tecniche»:
- sostituisci il punto che inizia con «onnxruntime-node è compilato per **CUDA 12**» con: «onnxruntime-node 1.30 usa **CUDA 13** (lib di sistema; in Docker quelle dell'immagine `nvidia/cuda:13.0.2-cudnn-runtime`). Le lib CUDA 12 nella `.venv` (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`…) servono a ctranslate2/Whisper; `scripts/with-cuda.sh` le mette in `LD_LIBRARY_PATH` prima di avviare Node (`npm run dev`/`start` e il container).»
- nel punto «DB: percorso da `DB_PATH`…» sostituisci «DB nuovo: `DB_PATH=… npx tsx scripts/create-db.ts`» (nel punto «Non usare db:push») con: «DB nuovo: si crea da solo all'apertura (`initSchema()` da `lib/db/schemaSql.ts`, generato con `npm run db:schema`: rigeneralo quando cambi `schema.ts`, un test lo controlla).»
- aggiungi: «**Docker**: `docker compose up -d --build` (vedi README). `network_mode: host` (Ollama sull'host), `./data` per DB e cache modelli (`STUDYBUDDY_MODELS_DIR`, `HF_HOME`), corsi montati `:ro` allo stesso percorso dell'host (`COURSES_DIR`) così `documents.source` resta valido. `/api/health?warm=1` dice se il reranker è su `cuda`. La CLI funziona anche nel container: `docker compose exec studybuddy npm run ingest -- <dir> <dominio>`.»
- in «Comandi» aggiungi `npm run db:schema` · `docker compose up -d --build`.

- [ ] **Step 3: commit**

```bash
git add README.md CLAUDE.md
git commit -m "Docs: Docker con GPU nel README, note tecniche aggiornate (CUDA 13, schema automatico)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Dopo F1

`npm test` e `npm run typecheck` verdi, verifica del Task 4 riuscita. Merge in `main` e push **solo col tuo ok**. Usare il container sul DB reale (`studybuddy-v2.db` copiato in `data/`) non fa parte di F1: arriva con F4 (import e passaggio), sempre dopo il tuo ok.
