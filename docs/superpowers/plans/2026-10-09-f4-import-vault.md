# F4 — Import del vault e passaggio: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** uno script, `npm run import-vault`, crea un DB **nuovo** di StudyBuddy che contiene tutto quello che c'è oggi più i dati del vault: domini, note e tabelle SF6. Gli originali non si toccano. Poi l'app passa a quel DB.

**Architecture:** la logica sta in `src/lib/vaultImport/`, divisa in tre file:
- `read.ts` copia il DB del vault (con il WAL), legge la copia e importa i domini dal codice del vault. Niente `@/lib/db`.
- `plan.ts` calcola il piano sul DB di StudyBuddy aperto (agganci, domini nuovi, esclusi, note → inbox) e lo applica in una transazione con la verifica dei conteggi.
- `report.ts` stampa il resoconto (puro).

Lo script `scripts/import-vault.ts` fa le operazioni sui file:
1. fa il backup online del DB sorgente in un **file di lavoro** accanto al target;
2. punta `DB_PATH` sul file di lavoro, così `@/lib/db` esegue `ensureHubSchema()` (che crea le tabelle `sf6_*` e converte le aree);
3. esegue piano e import sul file di lavoro.

Il dry-run fa **esattamente** lo stesso lavoro e alla fine butta il file. `--apply` lo collega al target, che non deve esistere.

**Tech Stack:** better-sqlite3 13 (`backup()`, WAL), tsx (import dinamico del `domains.ts` del vault), TypeScript 7, `node:test` via tsx, drizzle-kit (solo per `schemaSql.ts`).

**Spec:** `docs/superpowers/specs/2026-10-09-unione-vault-design.md`: sezione 1 (righe `sf6_combos`, `sf6_tips`, paragrafo «Aggancio ai domini del vault»), sezione 5 «Migrazione dei dati e passaggio», sezione 6 riga F4.

**Fuori da F4:**
- **Codice e pagine SF6** (`/sf6/**`, `/api/sf6/*`, roster, notazione) e la registrazione di `sf6` in `lib/modules.ts`: arrivano in F5. Qui nascono solo le due tabelle, perché l'import le popola.
- **Collegamento del dominio al modulo.** Lo script assegna `module` solo ai domini il cui slug è un modulo **registrato**, e oggi il registro è vuoto. Dopo la F5 il modulo si imposta da Impostazioni: il selettore compare appena il registro non è vuoto.
- **Altro:** cancellare `~/learning-vault`, `learning-vault/` o `studybuddy-v2.db`; nuovi screenshot.

## Global Constraints

- **Gli originali non si toccano mai.**
  - Il DB del vault: si copiano i file e si apre la copia. Aprire l'originale farebbe il checkpoint, cioè lo modificherebbe.
  - Il DB sorgente di StudyBuddy: si apre solo `readonly`, per il backup.
  - Il DB unito è un file **nuovo** (`data/studybuddy.db`), e lo script rifiuta un target che esiste già.
- **I dati del vault stanno quasi tutti nel WAL.** Si copia `vault.db` insieme a `vault.db-wal`. Il `-shm` non si copia: è un indice che SQLite ricostruisce dal WAL all'apertura della copia, e uno vecchio potrebbe solo confonderlo.
- **I domini del vault** si leggono dal suo codice (`import()` dinamico di `<vault>/src/lib/domains.ts`, export `DOMAINS`): la lista non entra mai nel repo.
- **Aggancio:**
  - un dominio del vault con lo stesso slug di un'area è **lo stesso dominio**: l'area prende simbolo, tagline e modulo dal vault e tiene il suo nome;
  - lo stesso vale per lo stesso **nome** a meno delle maiuscole, perché i nomi dei domini sono unici (`checkNameFree` in `lib/areas.ts`, la stessa regola di `convertAreaNames`);
  - gli altri domini del vault diventano domini nuovi con il **loro slug**, in coda (`position`), tranne quelli esclusi con `--skip`.
- **Note:**
  - le note dei domini esclusi e quelle con un dominio che non è in `DOMAINS` finiscono nell'**inbox**, e il dry-run lo dice;
  - si portano con id e date originali. Se un id è già usato nel target, **tutte** le note del vault prendono id nuovi, con le date originali, e il resoconto lo dice;
  - `course_id` è sempre null.
- **`settings` del vault:** non si porta. Per le chiavi si stampa solo il **nome**, mai il valore: `groq_api_key` si segnala come da spostare in `.env` (`GROQ_API_KEY`), le altre come scartate.
- **Transazione e verifica:** domini, note e `sf6_*` si scrivono in **una** transazione, che alla fine ricontrolla i conteggi. Se un controllo fallisce, la transazione non lascia niente. Un piano con errori non si applica e lo script esce con codice 1 senza lasciare file.
- **App generica:** niente nomi reali di domini, corsi o persone nel codice, nei test, negli esempi e nei messaggi. Nei test si usano nomi finti (Alfa, Beta…).
- **Mai `npm run db:push`.** Le tabelle nuove le crea `ensureHubSchema()` con `ensureTable` (stesso SQL di un DB nuovo). Dopo aver cambiato `schema.ts` si esegue `npm run db:schema`.
- **Non toccare** `studybuddy-v2.db`, `~/learning-vault/data/`, `learning-vault/data/` e `Courses/` nei Task 1–4, nemmeno in lettura. Il codice di `learning-vault/` si può leggere. Il Task 5 tocca i dati reali solo dopo un ok **esplicito** dell'utente a ogni passo.
- **Lingua:** messaggi della CLI e commenti in italiano, README in inglese.
- **Git:** branch `f4-import-vault`. Commit in italiano con `git add` di **file espliciti** (mai `-A` o `.`). Niente push né merge senza ok.

## Fatti verificati che il piano usa

- **`src/lib/db/index.ts`:**
  - apre `DB_PATH` **all'import**, poi esegue `initSchema()`, `ensureLibrarySchema()` e `ensureHubSchema()`;
  - `ensureHubSchema()` chiama `ensureTable(name)`, che cerca in `SCHEMA_SQL` l'istruzione che inizia con ``CREATE TABLE `name` `` e la esegue se la tabella manca. Crea solo la tabella, non gli indici;
  - poi converte i nomi liberi di `domains.areas` in slug (`convertAreaNames`).
- **`SCHEMA_SQL`** (`src/lib/db/schemaSql.ts`) è un modulo puro: si può importare senza aprire un DB.
- **`src/lib/areas.ts`:**
  - esporta `SAFE_AREAS` e `VISIBLE` (frammenti SQL su `domains d`) e `createArea`, `listAreas`;
  - ha private `cleanName` (non vuoto, spazi compattati, ≤ 60), `cleanTagline` (≤ 140, null → `''`) e `cleanSymbol` (≤ 2 grafemi, vuoto → `'·'`), che lanciano `LibraryError`;
  - `checkNameFree` impone nomi unici a meno delle maiuscole.
- **Altri moduli:**
  - `src/lib/slug.ts`: `SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`;
  - `src/lib/modules.ts`: `MODULES: Record<string, ModuleInfo>` vuoto, con `ModuleInfo = { title, href }`.
- **Tabella `notes`** di StudyBuddy: `id`, `content`, `domain`, `course_id`, `created_at` (secondi). Inbox = `domain IS NULL AND course_id IS NULL`.
- **Il vault** (`learning-vault@439b105`, codice letto):
  - `src/lib/db.ts` crea con SQL `notes(id, content, domain, created_at)`, `settings(key, value)`, `sf6_combos(id, character_slug, notation, situation, status, damage, drive_cost, notes, created_at)` e `sf6_tips(id, character_slug, type, title, content, notation, source_title, source_url, created_at)`;
  - `created_at` è in secondi (default `strftime('%s','now')`, e Drizzle `mode: "timestamp"`);
  - il DB sta in `<vault>/data/vault.db` (`DATABASE_PATH` di default);
  - `src/lib/domains.ts` esporta `DOMAINS: { slug, name, tagline, symbol }[]` senza import.
- **better-sqlite3:**
  - `db.backup(dest)` restituisce una Promise e funziona da una connessione `readonly`;
  - `close()` dell'ultima connessione fa il checkpoint e cancella il `-wal`.
- **Docker:** `docker-compose.yml` usa `DB_PATH=/app/data/studybuddy.db` con `./data:/app/data`, quindi il target naturale è `data/studybuddy.db`. `data/` è in `.gitignore` e oggi non esiste.
- **Script e test esistenti:**
  - gli script CLI usano `tsx --env-file-if-exists=.env.local` (`npm run ingest`), così `DB_PATH` di `.env.local` arriva allo script;
  - i test importano gli script con percorsi relativi (`../scripts/schema-sql`), e `node --test` esegue ogni file in un processo a sé.

## Review Focus

1. **Vault con i dati solo nel WAL** (il caso reale): l'import li vede tutti. Copiare il solo `vault.db` darebbe un DB senza tabelle, e `readVault` lo dice invece di importare zero note (Task 2, test «solo nel WAL»).
2. **Originali intatti dopo dry-run, apply ed errori:** `vault.db`, `vault.db-wal`, `vault.db-shm` e il `.db` sorgente restano byte per byte uguali (Task 2, test «l'originale non cambia»; Task 4, test e2e con impronte).
3. **Errore a metà strada** (`--skip` di un dominio inesistente, simbolo troppo lungo nel vault, due domini del vault sulla stessa area): exit 1, nessun target, nessun file `*.partial-*` rimasto, niente scritto (Task 3, test «errori»; Task 4, test «errore nel piano»).
4. **Dominio del vault con lo stesso nome ma un altro slug** di un'area di StudyBuddy (es. un'area nata dalla conversione dei nomi): diventa lo stesso dominio, non un doppione con lo stesso nome. Le sue note vanno sull'area esistente (Task 3, test «aggancio per nome»).
5. **Target con già delle note** (scritte in StudyBuddy dopo la F3): nessuna si perde. Le note del vault prendono id nuovi con le date originali, e il resoconto lo dice (Task 3, test «id già usati»).

---

### Task 1: tabelle `sf6_combos` e `sf6_tips`

**Files:**
- Modify: `src/lib/db/schema.ts` (in fondo, dopo `conceptMaps`)
- Modify: `src/lib/db/schemaSql.ts` (rigenerato con `npm run db:schema`, non a mano)
- Modify: `src/lib/db/index.ts` (`ensureHubSchema()`)
- Modify: `tests/schemaSql.test.ts` (lista tabelle)
- Test: `tests/hubSchemaSf6.test.ts`

**Interfaces:**
- Produces: tabelle `sf6_combos` e `sf6_tips` con le colonne del vault, nello stesso ordine. Su un DB nuovo le crea `initSchema()`, su uno esistente `ensureHubSchema()`. Export Drizzle `sf6Combos` e `sf6Tips` da `@/lib/db/schema`, per la F5.

- [ ] **Step 1: test del DB «di prima della F4»**

`tests/hubSchemaSf6.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "@/lib/db/schemaSql";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-f4-"));
const file = path.join(dir, "pre-f4.db");

// DB «di ieri»: tutto lo schema di oggi tranne le tabelle sf6, con una nota dentro.
const old = new Database(file);
for (const s of SCHEMA_SQL.filter((s) => !s.includes("`sf6_"))) old.exec(s);
old.prepare("INSERT INTO notes (content, created_at) VALUES ('nota', 1700000000)").run();
old.close();
process.env.DB_PATH = file;

const cols = (db: Database.Database, t: string) =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

test("DB pre-F4: sf6_combos e sf6_tips create con le colonne del vault, dati esistenti intatti", async () => {
  const { sqlite, ensureHubSchema } = await import("@/lib/db");
  assert.deepEqual(cols(sqlite, "sf6_combos"),
    ["id", "character_slug", "notation", "situation", "status", "damage", "drive_cost", "notes", "created_at"]);
  assert.deepEqual(cols(sqlite, "sf6_tips"),
    ["id", "character_slug", "type", "title", "content", "notation", "source_title", "source_url", "created_at"]);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM notes").get() as { n: number }).n, 1);
  ensureHubSchema(); // idempotente
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'sf6_%' AND type = 'table'").get() as { n: number }).n, 2);
});
```

In `tests/schemaSql.test.ts`, nella lista del test «DB nuovo», aggiungi `"sf6_combos", "sf6_tips"` dopo `"notes"`.

- [ ] **Step 2: i test falliscono**

Run: `npx tsx --test tests/hubSchemaSf6.test.ts tests/schemaSql.test.ts`
Expected: FAIL. `hubSchemaSf6` fallisce su `deepEqual` (tabella assente: `[]`), e `schemaSql` fallisce su `sf6_combos`.

- [ ] **Step 3: schema Drizzle**

In fondo a `src/lib/db/schema.ts`:

```ts
/**
 * Modulo SF6 (codice in F5, da `learning-vault@439b105`): combo e consigli per personaggio,
 * con le colonne del vault. Le tabelle nascono in F4 perché l'import del vault le popola.
 * `character_slug` è una stringa: il roster sta nel codice del modulo.
 */
export const sf6Combos = sqliteTable("sf6_combos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  characterSlug: text("character_slug").notNull(),
  notation: text("notation").notNull(),
  situation: text("situation"),
  status: text("status").notNull().default("learning"), // learning | practicing | consolidated
  damage: integer("damage"),
  driveCost: integer("drive_cost"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const sf6Tips = sqliteTable("sf6_tips", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  characterSlug: text("character_slug").notNull(),
  type: text("type").notNull(), // combo | tech | strategy | matchup | general
  title: text("title").notNull(),
  content: text("content").notNull(),
  notation: text("notation"),
  sourceTitle: text("source_title"),
  sourceUrl: text("source_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

Gli indici del vault (`idx_sf6_*`) non si portano: le tabelle hanno poche centinaia di righe, e `ensureTable` crea solo la tabella.

Run: `npm run db:schema` (rigenera `src/lib/db/schemaSql.ts`).

- [ ] **Step 4: `ensureHubSchema()`**

In `src/lib/db/index.ts`:
- aggiorna il commento di `ensureHubSchema()` in «crea le tabelle `areas`, `notes`, `sf6_combos` e `sf6_tips` e la colonna `sessions.updated_at`…»;
- aggiungi, subito dopo `ensureTable("notes");`:

```ts
  ensureTable("sf6_combos");
  ensureTable("sf6_tips");
```

- [ ] **Step 5: i test passano**

Run: `npx tsx --test tests/hubSchemaSf6.test.ts tests/schemaSql.test.ts && npm test && npm run typecheck`
Expected: PASS, tutti i test e il typecheck.

- [ ] **Step 6: commit**

```bash
git add src/lib/db/schema.ts src/lib/db/schemaSql.ts src/lib/db/index.ts tests/schemaSql.test.ts tests/hubSchemaSf6.test.ts
git commit -m "Schema: tabelle sf6_combos e sf6_tips (colonne del vault), create da ensureHubSchema"
```

---

### Task 2: lettura del vault da una copia (`vaultImport/read.ts`)

**Files:**
- Create: `src/lib/vaultImport/read.ts`
- Create: `tests/helpers/vault.ts` (vault finto, impronte dei file; lo usano anche i Task 3 e 4)
- Test: `tests/vaultRead.test.ts`

**Interfaces:**
- Produces (`@/lib/vaultImport/read`):
  - `interface VaultDomain { slug: string; name: string; tagline: string; symbol: string }`
  - `interface VaultNote { id: number; content: string; domain: string | null; createdAt: number }` (`createdAt` in secondi)
  - `type Row = Record<string, string | number | null>`
  - `interface VaultData { notes: VaultNote[]; combos: Row[]; tips: Row[]; settingKeys: string[] }`
  - `const SF6_COMBO_COLS: readonly string[]`, `const SF6_TIP_COLS: readonly string[]`
  - `function vaultDbPath(vaultDir: string): string` → `<vaultDir>/data/vault.db`
  - `function snapshotVaultDb(vaultDir: string, intoDir: string): string`: copia `.db` e `-wal` e restituisce il percorso della copia
  - `function readVault(file: string): VaultData`: lancia se manca `notes`
  - `async function loadVaultDomains(vaultDir: string): Promise<VaultDomain[]>`
- Produces (`tests/helpers/vault.ts`):
  - `makeFakeVault(opts): { dir: string; files: string[]; close(): void }`
  - `fingerprint(files: string[]): string[]`

- [ ] **Step 1: helper del vault finto**

`tests/helpers/vault.ts`:

```ts
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

export interface FakeDomain { slug: string; name: string; tagline?: string; symbol?: string }
export interface FakeNote { content: string; domain: string | null; createdAt?: number }

/**
 * Vault finto per i test F4: `src/lib/domains.ts` e `data/vault.db` con lo schema del vault
 * (`learning-vault@439b105`, src/lib/db.ts). Come nel vault vero i dati restano SOLO nel
 * WAL: la connessione resta aperta con l'autocheckpoint spento. `close()` alla fine del
 * file di test (chiudere fa il checkpoint).
 */
export function makeFakeVault(opts: {
  domains: FakeDomain[];
  notes?: FakeNote[];
  combos?: number;
  tips?: number;
  settings?: Record<string, string>;
  sf6?: boolean; // false: vault senza tabelle sf6
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-fakevault-"));
  fs.mkdirSync(path.join(dir, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data"));
  const domains = opts.domains.map((d) => ({ tagline: "", symbol: "·", ...d }));
  fs.writeFileSync(path.join(dir, "src", "lib", "domains.ts"),
    `export type DomainConfig = { slug: string; name: string; tagline: string; symbol: string };\n` +
    `export const DOMAINS: DomainConfig[] = ${JSON.stringify(domains, null, 2)};\n`);

  const file = path.join(dir, "data", "vault.db");
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("wal_autocheckpoint = 0");
  db.exec(`
    CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, domain TEXT,
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (opts.sf6 !== false) db.exec(`
    CREATE TABLE sf6_combos (id INTEGER PRIMARY KEY AUTOINCREMENT, character_slug TEXT NOT NULL, notation TEXT NOT NULL,
      situation TEXT, status TEXT NOT NULL DEFAULT 'learning', damage INTEGER, drive_cost INTEGER, notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)));
    CREATE TABLE sf6_tips (id INTEGER PRIMARY KEY AUTOINCREMENT, character_slug TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, content TEXT NOT NULL, notation TEXT, source_title TEXT, source_url TEXT,
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)));
  `);
  const note = db.prepare("INSERT INTO notes (content, domain, created_at) VALUES (?, ?, ?)");
  (opts.notes ?? []).forEach((n, i) => note.run(n.content, n.domain, n.createdAt ?? 1700000000 + i));
  for (let i = 0; i < (opts.combos ?? 0); i++) {
    db.prepare("INSERT INTO sf6_combos (character_slug, notation, status, damage, created_at) VALUES ('pg-a', ?, 'learning', ?, ?)")
      .run(`combo ${i}`, 1000 + i, 1700000100 + i);
  }
  for (let i = 0; i < (opts.tips ?? 0); i++) {
    db.prepare("INSERT INTO sf6_tips (character_slug, type, title, content, created_at) VALUES ('pg-a', 'general', ?, 'testo', ?)")
      .run(`tip ${i}`, 1700000200 + i);
  }
  for (const [k, v] of Object.entries(opts.settings ?? {})) db.prepare("INSERT INTO settings VALUES (?, ?)").run(k, v);

  return { dir, files: [file, `${file}-wal`, `${file}-shm`], close: () => db.close() };
}

/** sha256 di ogni file, «assente» se non c'è: per controllare che gli originali non cambino. */
export function fingerprint(files: string[]): string[] {
  return files.map((f) => (fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : "assente"));
}
```

- [ ] **Step 2: test**

`tests/vaultRead.test.ts`:

```ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeFakeVault, fingerprint } from "./helpers/vault";
import { loadVaultDomains, readVault, snapshotVaultDb, vaultDbPath } from "@/lib/vaultImport/read";

const v = makeFakeVault({
  domains: [{ slug: "alfa", name: "Alfa", symbol: "✦", tagline: "cose" }, { slug: "beta", name: "Beta" }],
  notes: [{ content: "prima", domain: "alfa", createdAt: 1700000000 }, { content: "seconda", domain: null, createdAt: 1700000500 }],
  combos: 2,
  tips: 1,
  settings: { groq_api_key: "gsk_SEGRETO_finto", ollama_model: "m" },
});
after(() => v.close());
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sb-snap-"));

test("i dati del vault finto stanno solo nel WAL: il solo .db non ha tabelle", () => {
  const d = tmp();
  fs.copyFileSync(vaultDbPath(v.dir), path.join(d, "vault.db"));
  assert.throws(() => readVault(path.join(d, "vault.db")), /nessuna tabella notes/);
});

test("snapshot + readVault: note, sf6 e solo le CHIAVI delle impostazioni", () => {
  const data = readVault(snapshotVaultDb(v.dir, tmp()));
  assert.deepEqual(data.notes, [
    { id: 1, content: "prima", domain: "alfa", createdAt: 1700000000 },
    { id: 2, content: "seconda", domain: null, createdAt: 1700000500 },
  ]);
  assert.equal(data.combos.length, 2);
  assert.deepEqual(Object.keys(data.combos[0]),
    ["id", "character_slug", "notation", "situation", "status", "damage", "drive_cost", "notes", "created_at"]);
  assert.equal(data.combos[1].damage, 1001);
  assert.equal(data.tips.length, 1);
  assert.deepEqual(data.settingKeys, ["groq_api_key", "ollama_model"]);
  assert.ok(!JSON.stringify(data).includes("gsk_SEGRETO"));
});

test("l'originale non cambia (né .db, né -wal, né -shm)", () => {
  const before = fingerprint(v.files);
  readVault(snapshotVaultDb(v.dir, tmp()));
  assert.deepEqual(fingerprint(v.files), before);
});

test("vault senza tabelle sf6: combo e tip vuoti", () => {
  const w = makeFakeVault({ domains: [{ slug: "alfa", name: "Alfa" }], notes: [{ content: "x", domain: null }], sf6: false });
  try {
    const data = readVault(snapshotVaultDb(w.dir, tmp()));
    assert.deepEqual([data.notes.length, data.combos, data.tips], [1, [], []]);
  } finally { w.close(); }
});

test("snapshot di una cartella senza vault: errore leggibile", () => {
  assert.throws(() => snapshotVaultDb(tmp(), tmp()), /non trovo .*vault\.db/);
});

test("loadVaultDomains: legge DOMAINS dal codice del vault", async () => {
  assert.deepEqual(await loadVaultDomains(v.dir), [
    { slug: "alfa", name: "Alfa", tagline: "cose", symbol: "✦" },
    { slug: "beta", name: "Beta", tagline: "", symbol: "·" },
  ]);
  await assert.rejects(loadVaultDomains(tmp()), /non trovo .*domains\.ts/);
});
```

- [ ] **Step 3: il test fallisce**

Run: `npx tsx --test tests/vaultRead.test.ts`
Expected: FAIL con «Cannot find module '@/lib/vaultImport/read'».

- [ ] **Step 4: implementazione**

`src/lib/vaultImport/read.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

/**
 * Lettura di learning-vault per l'import (F4). Mai sull'originale: i dati del vault stanno
 * quasi tutti nel WAL, e aprire il file farebbe il checkpoint, cioè lo modificherebbe. Si
 * copiano `vault.db` e `vault.db-wal` e si apre la copia. Il `-shm` no: è un indice che
 * SQLite ricostruisce dal WAL. Non usa `@/lib/db`.
 */
export interface VaultDomain { slug: string; name: string; tagline: string; symbol: string }
export interface VaultNote { id: number; content: string; domain: string | null; createdAt: number } // secondi
export type Row = Record<string, string | number | null>;
export interface VaultData { notes: VaultNote[]; combos: Row[]; tips: Row[]; settingKeys: string[] }

export const SF6_COMBO_COLS = ["id", "character_slug", "notation", "situation", "status", "damage", "drive_cost", "notes", "created_at"] as const;
export const SF6_TIP_COLS = ["id", "character_slug", "type", "title", "content", "notation", "source_title", "source_url", "created_at"] as const;

export const vaultDbPath = (vaultDir: string) => path.join(vaultDir, "data", "vault.db");

/** Copia `vault.db` (+ `-wal` se c'è) in `intoDir`, che deve essere vuota; restituisce la copia. */
export function snapshotVaultDb(vaultDir: string, intoDir: string): string {
  const src = vaultDbPath(vaultDir);
  if (!fs.existsSync(src)) throw new Error(`non trovo ${src}`);
  const dst = path.join(intoDir, "vault.db");
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  if (fs.existsSync(`${src}-wal`)) fs.copyFileSync(`${src}-wal`, `${dst}-wal`, fs.constants.COPYFILE_EXCL);
  return dst;
}

/** Legge la COPIA del DB del vault. Delle impostazioni restituisce solo le chiavi (i valori possono essere segreti). */
export function readVault(file: string): VaultData {
  const db = new Database(file, { fileMustExist: true });
  try {
    const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    if (!has("notes")) throw new Error(`${file}: nessuna tabella notes (copiato senza il -wal?)`);
    const rows = (t: string, cols: readonly string[]) =>
      has(t) ? (db.prepare(`SELECT ${cols.join(", ")} FROM ${t} ORDER BY id`).all() as Row[]) : [];
    return {
      notes: db.prepare("SELECT id, content, domain, created_at AS createdAt FROM notes ORDER BY id").all() as VaultNote[],
      combos: rows("sf6_combos", SF6_COMBO_COLS),
      tips: rows("sf6_tips", SF6_TIP_COLS),
      settingKeys: has("settings")
        ? (db.prepare("SELECT key FROM settings ORDER BY key").all() as { key: string }[]).map((r) => r.key)
        : [],
    };
  } finally {
    db.close();
  }
}

/** I domini del vault dal suo codice (`src/lib/domains.ts`, export `DOMAINS`): la lista non entra nel repo. */
export async function loadVaultDomains(vaultDir: string): Promise<VaultDomain[]> {
  const file = path.join(vaultDir, "src", "lib", "domains.ts");
  if (!fs.existsSync(file)) throw new Error(`non trovo ${file}`);
  const mod = (await import(pathToFileURL(file).href)) as { DOMAINS?: unknown };
  if (!Array.isArray(mod.DOMAINS)) throw new Error(`${file}: manca l'export DOMAINS`);
  return mod.DOMAINS.map((d: unknown, i: number) => {
    const o = (d ?? {}) as Record<string, unknown>;
    if (typeof o.slug !== "string" || typeof o.name !== "string") throw new Error(`${file}: DOMAINS[${i}] senza slug o name`);
    return {
      slug: o.slug,
      name: o.name,
      tagline: typeof o.tagline === "string" ? o.tagline : "",
      symbol: typeof o.symbol === "string" ? o.symbol : "·",
    };
  });
}
```

- [ ] **Step 5: i test passano**

Run: `npx tsx --test tests/vaultRead.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: commit**

```bash
git add src/lib/vaultImport/read.ts tests/helpers/vault.ts tests/vaultRead.test.ts
git commit -m "Import vault: lettura da una copia del DB (con il WAL) e domini dal codice del vault"
```

---

### Task 3: piano, applicazione e resoconto (`vaultImport/plan.ts`, `report.ts`)

**Files:**
- Modify: `src/lib/areas.ts` (esporta `cleanName`, `cleanTagline`, `cleanSymbol`)
- Create: `src/lib/vaultImport/plan.ts`
- Create: `src/lib/vaultImport/report.ts`
- Test: `tests/vaultImport.test.ts`

**Interfaces:**
- Consumes: `VaultData`, `VaultDomain`, `Row`, `SF6_COMBO_COLS`, `SF6_TIP_COLS` da `@/lib/vaultImport/read` (Task 2); tabelle `sf6_*` (Task 1); `sqlite` da `@/lib/db`; `SAFE_AREAS`, `VISIBLE`, `cleanName`, `cleanTagline`, `cleanSymbol` da `@/lib/areas`; `MODULES`, `ModuleInfo` da `@/lib/modules`; `SLUG_RE` da `@/lib/slug`.
- Produces (`@/lib/vaultImport/plan`):
  - `interface DomainStep { vault: VaultDomain; action: "hook" | "new" | "skip"; by: "slug" | "name" | null; target: string | null; name: string; module: string | null; notes: number }`
  - `interface AreaLink { slug: string; name: string; courses: number; vault: string | null }`
  - `interface NoteRow { id: number | null; content: string; domain: string | null; createdAt: number }`
  - `interface ImportPlan { steps: DomainStep[]; notes: NoteRow[]; renumbered: boolean; inbox: { fromVault: number; skipped: number; unknown: { slug: string; notes: number }[] }; combos: Row[]; tips: Row[]; settings: { dropped: string[]; toEnv: { key: string; env: string }[] }; areas: AreaLink[]; errors: string[] }`
  - `interface ImportResult { areas: number; notes: number; inbox: number; combos: number; tips: number }` (totali nel DB **dopo** l'import)
  - `function planImport(vault: VaultData, domains: VaultDomain[], opts?: { skip?: string[]; modules?: Record<string, ModuleInfo> }): ImportPlan`
  - `function applyImport(plan: ImportPlan): ImportResult`: lancia se `plan.errors` non è vuoto o se la verifica fallisce, e la transazione non lascia niente
- Produces (`@/lib/vaultImport/report`): `function formatReport(plan: ImportPlan, result?: ImportResult): string`

- [ ] **Step 1: test**

`tests/vaultImport.test.ts`:

```ts
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import type { VaultData, VaultDomain } from "@/lib/vaultImport/read";

let sqlite: import("better-sqlite3").Database;
let createArea: typeof import("@/lib/areas").createArea;
let listAreas: typeof import("@/lib/areas").listAreas;
let planImport: typeof import("@/lib/vaultImport/plan").planImport;
let applyImport: typeof import("@/lib/vaultImport/plan").applyImport;
let formatReport: typeof import("@/lib/vaultImport/report").formatReport;

before(async () => {
  ({ sqlite } = await useTempDb()); // prima di importare i moduli che usano @/lib/db
  ({ createArea, listAreas } = await import("@/lib/areas"));
  ({ planImport, applyImport } = await import("@/lib/vaultImport/plan"));
  ({ formatReport } = await import("@/lib/vaultImport/report"));
});

const vault = (p: Partial<VaultData>): VaultData => ({ notes: [], combos: [], tips: [], settingKeys: [], ...p });
const dom = (slug: string, name: string, extra: Partial<VaultDomain> = {}): VaultDomain => ({ slug, name, tagline: "", symbol: "·", ...extra });
const note = (id: number, domain: string | null, createdAt = 1700000000 + id) => ({ id, content: `nota ${id}`, domain, createdAt });
const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
const notesBy = () => sqlite.prepare("SELECT id, content, domain, course_id AS courseId, created_at AS createdAt FROM notes ORDER BY id").all();

beforeEach(() => {
  sqlite.exec("DELETE FROM notes; DELETE FROM areas; DELETE FROM domains; DELETE FROM sf6_combos; DELETE FROM sf6_tips; DELETE FROM sqlite_sequence;");
});

test("aggancio per slug: l'area tiene il nome, prende simbolo e tagline; le note la seguono", () => {
  createArea({ name: "Alfa" });
  sqlite.prepare("INSERT INTO domains (name, kind, areas) VALUES ('Corso', 'course', '[\"alfa\"]')").run();
  const plan = planImport(vault({ notes: [note(1, "alfa")] }), [dom("alfa", "Alfa Vault", { symbol: "✦", tagline: "cose" })]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.steps.map((s) => [s.action, s.by, s.target, s.name, s.notes]), [["hook", "slug", "alfa", "Alfa", 1]]);
  assert.deepEqual(plan.areas, [{ slug: "alfa", name: "Alfa", courses: 1, vault: "alfa" }]);
  applyImport(plan);
  const [a] = listAreas();
  assert.deepEqual([a.slug, a.name, a.symbol, a.tagline, a.notes], ["alfa", "Alfa", "✦", "cose", 1]);
});

test("aggancio per nome: stesso nome a meno delle maiuscole, slug diverso → stesso dominio", () => {
  createArea({ name: "Gamma Uno" }); // slug gamma-uno
  const plan = planImport(vault({ notes: [note(1, "gamma")] }), [dom("gamma", "gamma uno")]);
  assert.deepEqual(plan.steps.map((s) => [s.action, s.by, s.target]), [["hook", "name", "gamma-uno"]]);
  applyImport(plan);
  assert.deepEqual(listAreas().map((a) => [a.slug, a.name, a.notes]), [["gamma-uno", "Gamma Uno", 1]]);
});

test("dominio nuovo: tiene lo slug del vault, va in coda, prende il modulo solo se registrato", () => {
  createArea({ name: "Alfa" });
  const modules = { beta: { title: "Beta", href: "/beta" } };
  const plan = planImport(vault({}), [dom("beta", "Beta", { symbol: "♪" }), dom("delta", "Delta")], { modules });
  assert.deepEqual(plan.steps.map((s) => [s.action, s.target, s.module]), [["new", "beta", "beta"], ["new", "delta", null]]);
  applyImport(plan);
  assert.deepEqual(listAreas().map((a) => [a.slug, a.symbol, a.module, a.position]),
    [["alfa", "·", null, 0], ["beta", "♪", "beta", 1], ["delta", "·", null, 2]]);
});

test("esclusi e domini sconosciuti → inbox, e il piano lo dice", () => {
  const plan = planImport(
    vault({ notes: [note(1, "alfa"), note(2, "delta"), note(3, "zeta"), note(4, null), note(5, "")] }),
    [dom("alfa", "Alfa"), dom("delta", "Delta")],
    { skip: ["delta"] },
  );
  assert.deepEqual(plan.steps.map((s) => [s.vault.slug, s.action, s.notes]), [["alfa", "new", 1], ["delta", "skip", 1]]);
  assert.deepEqual(plan.inbox, { fromVault: 2, skipped: 1, unknown: [{ slug: "zeta", notes: 1 }] });
  const r = applyImport(plan);
  assert.equal(r.inbox, 4);
  assert.deepEqual(listAreas().map((a) => a.slug), ["alfa"]);
});

test("note con id e date originali; corso mai assegnato", () => {
  applyImport(planImport(vault({ notes: [note(5, null, 1600000000), note(9, null, 1650000000)] }), []));
  assert.deepEqual(notesBy(), [
    { id: 5, content: "nota 5", domain: null, courseId: null, createdAt: 1600000000 },
    { id: 9, content: "nota 9", domain: null, courseId: null, createdAt: 1650000000 },
  ]);
});

test("id già usati nel target: le note del vault prendono id nuovi, nessuna si perde", () => {
  sqlite.prepare("INSERT INTO notes (id, content, created_at) VALUES (5, 'già qui', 1690000000)").run();
  const plan = planImport(vault({ notes: [note(5, null, 1600000000), note(6, null, 1600000001)] }), []);
  assert.equal(plan.renumbered, true);
  applyImport(plan);
  const rows = notesBy() as { id: number; content: string; createdAt: number }[];
  assert.deepEqual(rows.map((r) => [r.content, r.createdAt]),
    [["già qui", 1690000000], ["nota 5", 1600000000], ["nota 6", 1600000001]]);
  assert.match(formatReport(plan), /id nuovi/);
});

test("sf6: righe copiate con id e colonne", () => {
  const combos = [{ id: 3, character_slug: "pg-a", notation: "c", situation: null, status: "practicing", damage: 1200, drive_cost: 2, notes: null, created_at: 1700000000 }];
  const tips = [{ id: 7, character_slug: "pg-a", type: "general", title: "t", content: "x", notation: null, source_title: "s", source_url: null, created_at: 1700000001 }];
  const r = applyImport(planImport(vault({ combos, tips }), []));
  assert.deepEqual([r.combos, r.tips], [1, 1]);
  assert.deepEqual(sqlite.prepare("SELECT * FROM sf6_combos").get(), combos[0]);
  assert.deepEqual(sqlite.prepare("SELECT * FROM sf6_tips").get(), tips[0]);
});

test("impostazioni: groq_api_key da spostare in .env, le altre scartate; mai valori", () => {
  const plan = planImport(vault({ settingKeys: ["groq_api_key", "ollama_model", "use_claude"] }), []);
  assert.deepEqual(plan.settings, { dropped: ["ollama_model", "use_claude"], toEnv: [{ key: "groq_api_key", env: "GROQ_API_KEY" }] });
  assert.match(formatReport(plan), /GROQ_API_KEY/);
});

test("errori: niente si applica e niente si scrive", () => {
  createArea({ name: "Alfa" });
  const plan = planImport(
    vault({ notes: [note(1, null)] }),
    [dom("alfa", "Alfa"), dom("ALFA2", "Alfa"), dom("beta", "Beta", { symbol: "abcd" }), dom("beta", "Beta bis")],
    { skip: ["omega"] },
  );
  const text = plan.errors.join("\n");
  assert.match(text, /--skip omega/);
  assert.match(text, /ALFA2.*slug non valido/);
  assert.match(text, /finiscono entrambi su «Alfa»/);
  assert.match(text, /beta.*simbolo/);
  assert.match(text, /due domini con slug «beta»/);
  assert.throws(() => applyImport(plan), /non applicabile/);
  assert.equal(count("SELECT count(*) AS n FROM notes"), 0);
  assert.deepEqual(listAreas().map((a) => [a.slug, a.symbol]), [["alfa", "·"]]);
  assert.match(formatReport(plan), /Errori/);
});

test("sf6 già popolate nel target: errore invece di mescolare", () => {
  sqlite.prepare("INSERT INTO sf6_tips (character_slug, type, title, content, created_at) VALUES ('p', 'general', 't', 'c', 1)").run();
  const tips = [{ id: 1, character_slug: "pg-a", type: "general", title: "t", content: "x", notation: null, source_title: null, source_url: null, created_at: 1 }];
  assert.match(planImport(vault({ tips }), []).errors.join(), /sf6_tips/);
});

test("formatReport: domini, note, mappa delle aree e totali dopo l'import", () => {
  createArea({ name: "Alfa" });
  sqlite.prepare("INSERT INTO domains (name, kind, areas) VALUES ('Corso', 'course', '[\"alfa\"]')").run();
  const plan = planImport(vault({ notes: [note(1, "alfa"), note(2, "delta")], combos: [], tips: [] }),
    [dom("alfa", "Alfa", { symbol: "✦" }), dom("beta", "Beta"), dom("delta", "Delta")], { skip: ["delta"] });
  const before = formatReport(plan);
  assert.match(before, /alfa .*agganciato a «Alfa» \(alfa, stesso slug\)/);
  assert.match(before, /beta .*nuovo dominio «Beta» \(beta\)/);
  assert.match(before, /delta .*escluso \(--skip\): 1 nota va nell'inbox/);
  assert.match(before, /alfa +Alfa · 1 corso ← vault alfa/);
  assert.doesNotMatch(before, /Dopo l'import/);
  const after = formatReport(plan, applyImport(plan));
  assert.match(after, /Dopo l'import: 2 domini, 2 note \(1 nell'inbox\), 0 combo, 0 tip/);
});
```

- [ ] **Step 2: il test fallisce**

Run: `npx tsx --test tests/vaultImport.test.ts`
Expected: FAIL con «Cannot find module '@/lib/vaultImport/plan'».

- [ ] **Step 3: esporta i validatori di `areas.ts`**

In `src/lib/areas.ts`, aggiungi `export` alle tre funzioni, senza cambiarne il corpo: `export function cleanName`, `export function cleanTagline`, `export function cleanSymbol`. Sopra `cleanName` aggiungi il commento: `// esportati anche per l'import del vault (lib/vaultImport/plan.ts)`.

- [ ] **Step 4: `plan.ts`**

`src/lib/vaultImport/plan.ts`:

```ts
import { sqlite } from "@/lib/db";
import { SAFE_AREAS, VISIBLE, cleanName, cleanSymbol, cleanTagline } from "@/lib/areas";
import { MODULES, type ModuleInfo } from "@/lib/modules";
import { SLUG_RE } from "@/lib/slug";
import { SF6_COMBO_COLS, SF6_TIP_COLS, type Row, type VaultData, type VaultDomain } from "./read";

/**
 * Piano dell'import del vault sul DB aperto (`@/lib/db`), poi applicazione in una
 * transazione con verifica dei conteggi. Un dominio del vault con lo stesso slug (o, se no,
 * lo stesso nome a meno delle maiuscole: i nomi sono unici) di un'area è lo stesso dominio:
 * l'area prende simbolo, tagline e modulo e tiene il nome. Gli altri diventano domini nuovi
 * con il loro slug, tranne gli esclusi. Le note degli esclusi e dei domini sconosciuti → inbox.
 */
export interface DomainStep {
  vault: VaultDomain;
  action: "hook" | "new" | "skip";
  by: "slug" | "name" | null; // hook: come è stato riconosciuto
  target: string | null;      // slug in `areas` dopo l'import; null se escluso
  name: string;               // nome dopo l'import (hook: quello dell'area)
  module: string | null;
  notes: number;              // note del vault in questo dominio
}
export interface AreaLink { slug: string; name: string; courses: number; vault: string | null }
export interface NoteRow { id: number | null; content: string; domain: string | null; createdAt: number }
export interface ImportPlan {
  steps: DomainStep[];
  notes: NoteRow[];
  renumbered: boolean; // un id del vault è già usato nel target: tutte le note prendono id nuovi
  inbox: { fromVault: number; skipped: number; unknown: { slug: string; notes: number }[] };
  combos: Row[];
  tips: Row[];
  settings: { dropped: string[]; toEnv: { key: string; env: string }[] };
  areas: AreaLink[]; // domini di StudyBuddy prima dell'import, con il dominio del vault agganciato
  errors: string[];
}
export interface ImportResult { areas: number; notes: number; inbox: number; combos: number; tips: number }

/** Impostazioni del vault che hanno un equivalente in `.env` (si segnala il nome, mai il valore). */
const ENV_KEYS: Record<string, string> = { groq_api_key: "GROQ_API_KEY" };
const INBOX = "SELECT count(*) AS n FROM notes WHERE domain IS NULL AND course_id IS NULL";
const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function planImport(
  vault: VaultData,
  domains: VaultDomain[],
  opts: { skip?: string[]; modules?: Record<string, ModuleInfo> } = {},
): ImportPlan {
  const modules = opts.modules ?? MODULES;
  const skip = new Set(opts.skip ?? []);
  const errors: string[] = [];
  for (const s of skip) if (!domains.some((d) => d.slug === s)) errors.push(`--skip ${s}: il vault non ha questo dominio`);

  const existing = sqlite.prepare("SELECT slug, name, module FROM areas ORDER BY position, name COLLATE NOCASE").all() as
    { slug: string; name: string; module: string | null }[];
  const bySlug = new Map(existing.map((a) => [a.slug, a]));
  const byName = new Map(existing.map((a) => [a.name.toLowerCase(), a]));
  const claimed = new Map<string, string>(); // slug dell'area → slug del vault
  const seen = new Set<string>();
  const newNames = new Set<string>();

  const steps = domains.map((d): DomainStep => {
    const notes = vault.notes.filter((n) => n.domain === d.slug).length;
    if (seen.has(d.slug)) errors.push(`il vault ha due domini con slug «${d.slug}»`);
    seen.add(d.slug);
    if (skip.has(d.slug)) return { vault: d, action: "skip", by: null, target: null, name: d.name, module: null, notes };

    if (!SLUG_RE.test(d.slug)) errors.push(`dominio «${d.slug}»: slug non valido`);
    let name = d.name;
    try {
      name = cleanName(d.name);
      cleanTagline(d.tagline);
      cleanSymbol(d.symbol);
    } catch (e) {
      errors.push(`dominio «${d.slug}»: ${message(e)}`);
    }
    const module = Object.hasOwn(modules, d.slug) ? d.slug : null;

    const area = bySlug.get(d.slug) ?? byName.get(name.toLowerCase());
    if (area) {
      const prev = claimed.get(area.slug);
      if (prev) errors.push(`i domini del vault «${prev}» e «${d.slug}» finiscono entrambi su «${area.name}»`);
      claimed.set(area.slug, d.slug);
      const by = area.slug === d.slug ? "slug" : "name";
      return { vault: d, action: "hook", by, target: area.slug, name: area.name, module: module ?? area.module, notes };
    }
    if (newNames.has(name.toLowerCase())) errors.push(`il vault ha due domini di nome «${name}»`);
    newNames.add(name.toLowerCase());
    return { vault: d, action: "new", by: null, target: d.slug, name, module, notes };
  });

  // note: dominio del vault → slug dell'area; esclusi e sconosciuti → inbox
  const dest = new Map(steps.filter((s) => s.target).map((s) => [s.vault.slug, s.target!]));
  const unknown = new Map<string, number>();
  let skipped = 0;
  let fromVault = 0;
  const mapped: NoteRow[] = vault.notes.map((n) => {
    let domain: string | null = null;
    if (!n.domain) fromVault++;
    else if (dest.has(n.domain)) domain = dest.get(n.domain)!;
    else if (skip.has(n.domain)) skipped++;
    else unknown.set(n.domain, (unknown.get(n.domain) ?? 0) + 1);
    return { id: n.id, content: n.content, domain, createdAt: n.createdAt };
  });
  const used = sqlite.prepare("SELECT 1 FROM notes WHERE id = ?");
  const renumbered = mapped.some((n) => used.get(n.id));

  for (const [t, rows] of [["sf6_combos", vault.combos], ["sf6_tips", vault.tips]] as const) {
    const n = count(`SELECT count(*) AS n FROM ${t}`);
    if (rows.length && n) errors.push(`il target ha già ${n} righe in ${t}: l'import vuole le tabelle sf6 vuote`);
  }

  const courses = sqlite.prepare(`SELECT count(*) AS n FROM domains d, json_each(${SAFE_AREAS}) j WHERE ${VISIBLE} AND j.value = ?`);
  return {
    steps,
    notes: renumbered ? mapped.map((n) => ({ ...n, id: null })) : mapped,
    renumbered,
    inbox: { fromVault, skipped, unknown: [...unknown].map(([slug, notes]) => ({ slug, notes })) },
    combos: vault.combos,
    tips: vault.tips,
    settings: {
      dropped: vault.settingKeys.filter((k) => !Object.hasOwn(ENV_KEYS, k)),
      toEnv: vault.settingKeys.filter((k) => Object.hasOwn(ENV_KEYS, k)).map((k) => ({ key: k, env: ENV_KEYS[k] })),
    },
    areas: existing.map((a) => ({
      slug: a.slug,
      name: a.name,
      courses: (courses.get(a.slug) as { n: number }).n,
      vault: claimed.get(a.slug) ?? null,
    })),
    errors,
  };
}

function totals(): ImportResult {
  return {
    areas: count("SELECT count(*) AS n FROM areas"),
    notes: count("SELECT count(*) AS n FROM notes"),
    inbox: count(INBOX),
    combos: count("SELECT count(*) AS n FROM sf6_combos"),
    tips: count("SELECT count(*) AS n FROM sf6_tips"),
  };
}

/** Scrive il piano in una transazione e ricontrolla i conteggi: se qualcosa non torna, non resta niente. */
export function applyImport(plan: ImportPlan): ImportResult {
  if (plan.errors.length) throw new Error(`import non applicabile:\n- ${plan.errors.join("\n- ")}`);
  return sqlite.transaction(() => {
    const before = totals();
    const now = Math.floor(Date.now() / 1000);
    let pos = count("SELECT coalesce(max(position) + 1, 0) AS n FROM areas");
    const hook = sqlite.prepare("UPDATE areas SET symbol = ?, tagline = ?, module = ? WHERE slug = ?");
    const add = sqlite.prepare("INSERT INTO areas (slug, name, tagline, symbol, module, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const s of plan.steps) {
      if (s.action === "hook") hook.run(cleanSymbol(s.vault.symbol), cleanTagline(s.vault.tagline), s.module, s.target);
      if (s.action === "new") add.run(s.target, s.name, cleanTagline(s.vault.tagline), cleanSymbol(s.vault.symbol), s.module, pos++, now);
    }
    const note = sqlite.prepare("INSERT INTO notes (id, content, domain, course_id, created_at) VALUES (?, ?, ?, NULL, ?)");
    for (const n of plan.notes) note.run(n.id, n.content, n.domain, n.createdAt);
    for (const [t, cols, rows] of [["sf6_combos", SF6_COMBO_COLS, plan.combos], ["sf6_tips", SF6_TIP_COLS, plan.tips]] as const) {
      const ins = sqlite.prepare(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
      for (const r of rows) ins.run(...cols.map((c) => r[c] ?? null));
    }

    const after = totals();
    const want: ImportResult = {
      areas: before.areas + plan.steps.filter((s) => s.action === "new").length,
      notes: before.notes + plan.notes.length,
      inbox: before.inbox + plan.notes.filter((n) => !n.domain).length,
      combos: before.combos + plan.combos.length,
      tips: before.tips + plan.tips.length,
    };
    for (const k of Object.keys(want) as (keyof ImportResult)[]) {
      if (after[k] !== want[k]) throw new Error(`verifica fallita su ${k}: attesi ${want[k]}, trovati ${after[k]}`);
    }
    const area = sqlite.prepare("SELECT 1 FROM areas WHERE slug = ?");
    for (const s of plan.steps) if (s.target && !area.get(s.target)) throw new Error(`verifica fallita: manca il dominio ${s.target}`);
    return after;
  }).immediate();
}
```

- [ ] **Step 5: `report.ts`**

`src/lib/vaultImport/report.ts`:

```ts
import type { ImportPlan, ImportResult } from "./plan";

/** Resoconto in italiano per il terminale (dry-run e apply). Mai valori delle impostazioni. */
export function formatReport(plan: ImportPlan, result?: ImportResult): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const L: string[] = ["Domini del vault:"];
  if (!plan.steps.length) L.push("  (nessuno)");
  for (const s of plan.steps) {
    const what =
      s.action === "skip" ? `escluso (--skip)${s.notes ? `: ${n(s.notes, "nota va", "note vanno")} nell'inbox` : ""}`
      : s.action === "hook" ? `agganciato a «${s.name}» (${s.target}, stesso ${s.by === "slug" ? "slug" : "nome"})`
      : `nuovo dominio «${s.name}» (${s.target})`;
    const mod = s.module ? ` · modulo ${s.module}` : "";
    const notes = s.action === "skip" ? "" : ` · ${n(s.notes, "nota", "note")}`;
    L.push(`  ${s.vault.slug.padEnd(12)} ${s.vault.symbol} ${s.vault.name} → ${what}${mod}${notes}`);
  }

  const inbox = plan.notes.filter((x) => !x.domain).length;
  const parts = [`${plan.inbox.fromVault} già senza dominio`, `${plan.inbox.skipped} da domini esclusi`,
    ...plan.inbox.unknown.map((u) => `${u.notes} con dominio sconosciuto «${u.slug}»`)];
  L.push(`Note: ${plan.notes.length}, di cui ${inbox} nell'inbox (${parts.join(", ")})`);
  if (plan.renumbered) L.push("  alcuni id sono già usati nel DB: le note del vault prendono id nuovi (date originali)");
  L.push(`SF6: ${plan.combos.length} combo, ${plan.tips.length} tip`);
  if (plan.settings.dropped.length) L.push(`Impostazioni del vault non portate: ${plan.settings.dropped.join(", ")} (i modelli stanno in config.ts)`);
  for (const e of plan.settings.toEnv) L.push(`Impostazione ${e.key}: non copiata; se ti serve mettila in .env come ${e.env}`);

  L.push("Domini di StudyBuddy prima dell'import:");
  if (!plan.areas.length) L.push("  (nessuno)");
  for (const a of plan.areas) L.push(`  ${a.slug.padEnd(12)} ${a.name} · ${n(a.courses, "corso", "corsi")}${a.vault ? ` ← vault ${a.vault}` : ""}`);

  if (plan.errors.length) {
    L.push("Errori (niente da applicare):");
    for (const e of plan.errors) L.push(`  - ${e}`);
  }
  if (result) {
    L.push(`Dopo l'import: ${n(result.areas, "dominio", "domini")}, ${n(result.notes, "nota", "note")} (${result.inbox} nell'inbox), ${result.combos} combo, ${result.tips} tip`);
  }
  return L.join("\n");
}
```

- [ ] **Step 6: i test passano**

Run: `npx tsx --test tests/vaultImport.test.ts && npm test && npm run typecheck`
Expected: PASS. Se un'asserzione di `formatReport` non torna per un dettaglio di formato (spazi del `padEnd`), correggi **il test o il formato** in modo che il resoconto resti leggibile in colonna. Non indebolire le asserzioni sul contenuto.

- [ ] **Step 7: commit**

```bash
git add src/lib/areas.ts src/lib/vaultImport/plan.ts src/lib/vaultImport/report.ts tests/vaultImport.test.ts
git commit -m "Import vault: piano (aggancio per slug o nome, esclusi → inbox), applicazione in transazione con verifica, resoconto"
```

---

### Task 4: CLI `scripts/import-vault.ts` e documentazione

**Files:**
- Create: `scripts/import-vault.ts`
- Modify: `package.json` (script `import-vault`)
- Modify: `README.md`, `CLAUDE.md`
- Test: `tests/importVaultCli.test.ts`

**Interfaces:**
- Consumes: `snapshotVaultDb`, `readVault`, `loadVaultDomains` (Task 2); `planImport`, `applyImport` (Task 3); `formatReport` (Task 3); `@/lib/db` (dinamico, **dopo** aver impostato `DB_PATH`).
- Produces:
  - `npm run import-vault -- --vault <dir> --target <nuovo.db> [--from <db>] [--skip <slug>]… [--apply]`, che esce con 0 se va tutto bene e con 1 se c'è un errore o un piano non applicabile;
  - export `parseArgs(argv: string[], env?: NodeJS.ProcessEnv): { vault: string; target: string; from: string; skip: string[]; apply: boolean }`, con percorsi assoluti e `--from` che di default vale `env.DB_PATH`.

- [ ] **Step 1: test end-to-end**

`tests/importVaultCli.test.ts`:

```ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "@/lib/db/schemaSql";
import { makeFakeVault, fingerprint } from "./helpers/vault";
import { parseArgs } from "../scripts/import-vault";

const v = makeFakeVault({
  domains: [{ slug: "alfa", name: "Alfa", symbol: "✦" }, { slug: "beta", name: "Beta" }, { slug: "gamma", name: "Gamma" }],
  notes: [
    { content: "a1", domain: "alfa" }, { content: "a2", domain: "alfa" },
    { content: "b1", domain: "beta" }, { content: "g1", domain: "gamma" }, { content: "libera", domain: null },
  ],
  combos: 2,
  tips: 1,
  settings: { groq_api_key: "gsk_SEGRETO_finto", ollama_model: "m" },
});
after(() => v.close());

// DB sorgente di StudyBuddy: schema completo, un corso con un'area ancora come NOME libero
// (la conversione in slug la fa ensureHubSchema() sul file di lavoro, non sul sorgente).
const work = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cli-"));
const from = path.join(work, "sorgente.db");
const src = new Database(from);
src.pragma("journal_mode = WAL");
for (const s of SCHEMA_SQL) src.exec(s);
src.prepare("INSERT INTO domains (name, kind, areas) VALUES ('Corso', 'course', '[\"Alfa\"]')").run();
src.close();
const out = path.join(work, "data");
const target = path.join(out, "studybuddy.db");

const tsx = path.resolve("node_modules/.bin/tsx");
const baseEnv = { ...process.env };
delete baseEnv.DB_PATH; // il --from lo passa il test
const run = (...args: string[]) =>
  spawnSync(tsx, ["scripts/import-vault.ts", "--vault", v.dir, "--from", from, ...args], { encoding: "utf8", env: baseEnv });
const originals = () => fingerprint([...v.files, from]);
const leftovers = () => (fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.includes(".partial-")) : []);

test("dry-run: resoconto, niente target, niente file di lavoro, originali intatti, nessun segreto", () => {
  const before = originals();
  const r = run("--target", target, "--skip", "gamma");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /alfa .*agganciato a «Alfa»/);
  assert.match(r.stdout, /beta .*nuovo dominio «Beta»/);
  assert.match(r.stdout, /gamma .*escluso/);
  assert.match(r.stdout, /GROQ_API_KEY/);
  assert.match(r.stdout, /Dry-run/);
  assert.doesNotMatch(r.stdout + r.stderr, /gsk_SEGRETO/);
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(leftovers(), []);
  assert.deepEqual(originals(), before);
});

test("--apply: crea il target con domini, note e sf6; originali intatti", () => {
  const before = originals();
  const r = run("--target", target, "--skip", "gamma", "--apply");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Creato/);
  assert.deepEqual(leftovers(), []);
  assert.deepEqual(originals(), before);
  const db = new Database(target, { readonly: true });
  try {
    const q = (sql: string) => db.prepare(sql).all();
    assert.deepEqual(q("SELECT slug, name, symbol FROM areas ORDER BY position"),
      [{ slug: "alfa", name: "Alfa", symbol: "✦" }, { slug: "beta", name: "Beta", symbol: "·" }]);
    assert.deepEqual(q("SELECT areas FROM domains"), [{ areas: '["alfa"]' }]);
    assert.deepEqual(q("SELECT content, domain FROM notes ORDER BY id"), [
      { content: "a1", domain: "alfa" }, { content: "a2", domain: "alfa" },
      { content: "b1", domain: "beta" }, { content: "g1", domain: null }, { content: "libera", domain: null },
    ]);
    assert.deepEqual(q("SELECT count(*) AS n FROM sf6_combos"), [{ n: 2 }]);
    assert.deepEqual(q("SELECT count(*) AS n FROM sf6_tips"), [{ n: 1 }]);
  } finally {
    db.close();
  }
});

test("target esistente: rifiuta e non lo tocca", () => {
  const before = fingerprint([target]);
  const r = run("--target", target, "--apply");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /esiste già/);
  assert.deepEqual(fingerprint([target]), before);
});

test("piano con errori: exit 1, niente target, niente file di lavoro", () => {
  const other = path.join(out, "altro.db");
  const r = run("--target", other, "--skip", "omega", "--apply");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /--skip omega/);
  assert.equal(fs.existsSync(other), false);
  assert.deepEqual(leftovers(), []);
});

test("parseArgs: --from di default da DB_PATH, argomenti obbligatori e sconosciuti", () => {
  const a = parseArgs(["--vault", "v", "--target", "t.db", "--skip", "x", "--skip", "y"], { DB_PATH: "s.db" });
  assert.deepEqual(a, { vault: path.resolve("v"), target: path.resolve("t.db"), from: path.resolve("s.db"), skip: ["x", "y"], apply: false });
  assert.throws(() => parseArgs(["--target", "t.db"], { DB_PATH: "s.db" }), /Uso:/);
  assert.throws(() => parseArgs(["--vault", "v", "--target", "t.db"], {}), /DB_PATH/);
  assert.throws(() => parseArgs(["--vault", "v", "--target", "t.db", "--boh"], { DB_PATH: "s.db" }), /sconosciuto/);
  assert.throws(() => parseArgs(["--vault", "--target", "t.db"], { DB_PATH: "s.db" }), /vuole un valore/);
});
```

- [ ] **Step 2: il test fallisce**

Run: `npx tsx --test tests/importVaultCli.test.ts`
Expected: FAIL con «Cannot find module '../scripts/import-vault'».

- [ ] **Step 3: lo script**

`scripts/import-vault.ts`:

```ts
/**
 * Import di learning-vault in un DB NUOVO di StudyBuddy (F4).
 *
 *   npm run import-vault -- --vault <cartella del vault> --target data/studybuddy.db [--from <db>] [--skip <slug>]… [--apply]
 *
 * Gli originali non si toccano:
 * - il DB di StudyBuddy (`--from`, di default DB_PATH) si apre in sola lettura e si copia
 *   con il backup online di SQLite in un file di lavoro accanto al target;
 * - il DB del vault si copia (con il WAL) in una cartella temporanea e si legge la copia.
 * Sul file di lavoro gira tutto l'import (ensureHubSchema + una transazione con verifica).
 * Senza `--apply` (dry-run) stampa il resoconto e butta il file di lavoro; con `--apply` il
 * file diventa il target, che non deve esistere.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { loadVaultDomains, readVault, snapshotVaultDb } from "@/lib/vaultImport/read";

export interface Args { vault: string; target: string; from: string; skip: string[]; apply: boolean }

const USAGE = "Uso: npm run import-vault -- --vault <cartella> --target <nuovo.db> [--from <db>] [--skip <slug>]… [--apply]";

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Args {
  let vault: string | undefined, target: string | undefined, from: string | undefined;
  const skip: string[] = [];
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${k} vuole un valore\n${USAGE}`);
      return v;
    };
    if (k === "--vault") vault = value();
    else if (k === "--target") target = value();
    else if (k === "--from") from = value();
    else if (k === "--skip") skip.push(value());
    else if (k === "--apply") apply = true;
    else throw new Error(`argomento sconosciuto: ${k}\n${USAGE}`);
  }
  from ??= env.DB_PATH;
  if (!vault || !target) throw new Error(USAGE);
  if (!from) throw new Error(`manca --from e DB_PATH non è impostato\n${USAGE}`);
  return { vault: path.resolve(vault), target: path.resolve(target), from: path.resolve(from), skip, apply };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (fs.existsSync(args.target)) throw new Error(`${args.target} esiste già: lo script crea solo DB nuovi`);
  if (!fs.existsSync(args.from)) throw new Error(`non trovo il DB di StudyBuddy ${args.from}`);
  fs.mkdirSync(path.dirname(args.target), { recursive: true });
  const work = `${args.target}.partial-${process.pid}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-vault-"));
  let sqlite: Database.Database | undefined;
  try {
    // 1. vault: copia del .db + WAL, lettura della copia; domini dal codice del vault
    const vault = readVault(snapshotVaultDb(args.vault, tmp));
    const domains = await loadVaultDomains(args.vault);

    // 2. StudyBuddy: backup online (coerente anche col WAL) da una connessione in sola lettura
    const src = new Database(args.from, { readonly: true, fileMustExist: true });
    try { await src.backup(work); } finally { src.close(); }

    // 3. il file di lavoro diventa il DB dell'app: l'import di @/lib/db esegue ensureHubSchema()
    process.env.DB_PATH = work;
    ({ sqlite } = await import("@/lib/db"));
    const { planImport, applyImport } = await import("@/lib/vaultImport/plan");
    const { formatReport } = await import("@/lib/vaultImport/report");

    const plan = planImport(vault, domains, { skip: args.skip });
    if (plan.errors.length) {
      console.log(formatReport(plan));
      throw new Error("import non applicabile: vedi gli errori sopra");
    }
    console.log(formatReport(plan, applyImport(plan)));
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    sqlite.close();
    sqlite = undefined;

    if (args.apply) {
      fs.linkSync(work, args.target); // fallisce se nel frattempo il target è comparso: mai sovrascrivere
      console.log(`\nCreato ${args.target}`);
    } else {
      console.log(`\nDry-run: niente scritto. Per creare ${args.target} riesegui con --apply.`);
    }
  } finally {
    sqlite?.close();
    for (const f of [work, `${work}-wal`, `${work}-shm`]) fs.rmSync(f, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
```

In `package.json`, dopo `"ingest"`:

```json
    "import-vault": "tsx --env-file-if-exists=.env.local scripts/import-vault.ts",
```

- [ ] **Step 4: i test passano**

Run: `npx tsx --test tests/importVaultCli.test.ts && npm test && npm run typecheck`
Expected: PASS.

Se `fs.linkSync` fallisce su un filesystem senza hard link (non è il caso di `data/` in locale), **non** sostituirlo con `renameSync`: segnala il problema al controller.

- [ ] **Step 5: `README.md`**

Dopo la sezione «Adding courses», aggiungi:

````markdown
## Migrating from learning-vault

StudyBuddy absorbs learning-vault, the earlier personal hub: its domains, notes and Street Fighter 6 data move into a **new** database. Nothing is modified in place. The script reads a copy of the vault database, including its WAL, and makes an online backup of yours.

```bash
npm run import-vault -- --vault ~/learning-vault --target data/studybuddy.db            # dry run: prints the plan, writes nothing
npm run import-vault -- --vault ~/learning-vault --target data/studybuddy.db --apply    # creates data/studybuddy.db
```

- A vault domain with the same slug or name as one of your domains is merged into it: symbol and tagline come from the vault, the name stays yours.
- `--skip <slug>` leaves a domain out, and its notes go to the inbox.
- The vault's settings are not copied. A Groq key, if you had one, belongs in `.env` as `GROQ_API_KEY`.
- The database source defaults to `DB_PATH` from `.env.local` (`--from` to override).
- `data/studybuddy.db` is what Docker uses.
````

learning-vault non ha un remote: niente link nel README.

Nell'albero dei sorgenti, dopo la riga `home.ts`, aggiungi:

```
  vaultImport/     learning-vault import: read a WAL-safe copy, plan (merge/new/skip), apply with count checks
```

- [ ] **Step 6: `CLAUDE.md`**

- **Comandi:** aggiungi `npm run import-vault -- --vault <dir> --target <nuovo.db> [--skip <slug>] [--apply]` dopo `npm run ingest …`.
- **Note tecniche**, dopo la riga «Note (F3)», aggiungi:
  «- Import del vault (F4): `scripts/import-vault.ts` + `lib/vaultImport/` (`read.ts` copia `vault.db`+`-wal` e legge la copia, perché aprire l'originale farebbe il checkpoint; i domini vengono da `<vault>/src/lib/domains.ts` via `import()`. `plan.ts` aggancia per slug o nome, i nuovi domini tengono lo slug del vault, esclusi e sconosciuti → inbox, note con id originali salvo collisioni. `report.ts`). Lavora su un file `*.partial-<pid>` accanto al target, ottenuto con il backup online del DB sorgente: il dry-run fa tutto e lo butta, `--apply` lo collega al target (`linkSync`, mai sovrascrivere). `settings` del vault non si porta (si stampano solo i nomi delle chiavi). Tabelle `sf6_combos`/`sf6_tips` già nello schema (F4), codice SF6 in F5.»
- **Stato attuale:** in fondo all'elenco delle route aggiungi «CLI `npm run import-vault` (import di learning-vault in un DB nuovo)».

- [ ] **Step 7: commit**

```bash
git add scripts/import-vault.ts package.json tests/importVaultCli.test.ts README.md CLAUDE.md
git commit -m "Import vault: CLI npm run import-vault (dry-run di default, --apply su un DB nuovo), docs"
```

---

### Task 5: dati reali e passaggio (solo con ok esplicito dell'utente a ogni passo)

Lo esegue il controller, non un subagente. **Fermarsi e chiedere l'ok prima di ogni step.** La shell dell'utente è **fish**: i comandi bash vanno dentro `bash -c '…'`.

- [ ] **Step 1: scelte con l'utente** (nessun dato toccato)

Chiedi:
- quale cartella del vault usare: `~/learning-vault` (l'originale) o `learning-vault/` nel repo. Sono identiche, e lo script non apre nessuna delle due;
- se `.env.local` punta ancora a `studybuddy-v2.db` (`DB_PATH`): è il `--from` di default;
- se l'app (`npm run dev` o il container) è ferma: le note scritte nel vecchio DB **dopo** l'apply non finirebbero in quello nuovo.

- [ ] **Step 2: dry-run sui dati reali**

```bash
npm run import-vault -- --vault <cartella scelta> --target data/studybuddy.db
```

Mostra il resoconto all'utente: domini (agganciati, nuovi), note per dominio, inbox, SF6, impostazioni, domini di StudyBuddy. L'utente decide i `--skip`. Se cambia idea su un `--skip`, rilancia il dry-run: non scrive niente.

- [ ] **Step 3: apply**

Con l'ok sul resoconto:

```bash
npm run import-vault -- --vault <cartella scelta> --target data/studybuddy.db [--skip <slug>]… --apply
```

Mostra «Dopo l'import: …». I conteggi devono essere quelli del dry-run più quelli che il DB aveva già.

- [ ] **Step 4: passaggio**

Con l'ok dell'utente:
1. Controlla che `.env` esista con `COURSES_DIR`, poi esegui `docker compose up -d --build`.
2. Verifica a mano, su `http://localhost:${STUDYBUDDY_PORT:-3000}`:
   - `/`: inbox con le note del vault;
   - sidebar con i domini;
   - `/d/<slug>` di un dominio con note;
   - `/corsi` come prima;
   - un corso con chat e citazione → video al minuto;
   - il ripasso;
   - `/settings`: domini con simboli e tagline del vault;
   - `/api/health?warm=1`: reranker `cuda`.
3. Chiedi se aggiornare anche `.env.local` (`DB_PATH=data/studybuddy.db`) per `npm run dev`. È un file locale, fuori dal repo: si modifica solo con l'ok.

Le pagine SF6 non ci sono ancora: le tabelle `sf6_*` restano piene ma senza UI fino alla F5.

- [ ] **Step 5: chiusura**

Riepilogo all'utente: cosa è stato importato, dove sta il nuovo DB, cosa resta come backup (`studybuddy-v2.db`, il vault). Aggiorna la memoria del progetto (F4 fatta; prossimo passo: piano F5). Merge `--no-ff` in `main` e push **solo** dopo il suo ok.
