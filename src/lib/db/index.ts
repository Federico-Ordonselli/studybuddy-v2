import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { EMBED_DIM } from "@/lib/config";
import { SCHEMA_SQL } from "./schemaSql";
import { slugify, uniqueSlug } from "@/lib/slug";

const path = process.env.DB_PATH ?? "studybuddy.db";

export const sqlite = new Database(path);
sqlite.pragma("journal_mode = WAL");
sqliteVec.load(sqlite);

export const db = drizzle(sqlite, { schema });

/**
 * DB nuovo (nessuna tabella): crea lo schema Drizzle da `schemaSql.ts`, così il primo
 * avvio funziona anche dove drizzle-kit non c'è (Docker). Su un DB che ha già tabelle
 * non fa nulla: le aggiunte successive le fanno le `ensure*Schema()`.
 */
export function initSchema() {
  const tables = () => (sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
  // Caso comune (DB con tabelle): una lettura, nessun lock di scrittura.
  if (tables() > 0) return;
  // DB vuoto: ricontrollo e creazione nella stessa transazione IMMEDIATE, perché `next build`
  // apre il DB da più worker in parallelo e su un file nuovo il primo check corre.
  sqlite.transaction(() => {
    if (tables() > 0) return;
    for (const stmt of SCHEMA_SQL) sqlite.exec(stmt);
  }).immediate();
}

/**
 * Aggiorna un DB già esistente alle aggiunte della Libreria (`domains.areas`,
 * `ingested_files`) senza `db:push`, che non conosce vec_chunks/chunks_fts.
 * Idempotente; su un DB nuovo non serve (lo schema completo lo crea `initSchema()`).
 */
export function ensureLibrarySchema() {
  const cols = sqlite.prepare("PRAGMA table_info(domains)").all() as { name: string }[];
  if (!cols.length) return;
  if (!cols.some((c) => c.name === "areas")) {
    sqlite.exec("ALTER TABLE domains ADD COLUMN areas text DEFAULT '[]' NOT NULL");
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS ingested_files (
    domain_id integer NOT NULL REFERENCES domains(id),
    source text NOT NULL,
    file_hash text NOT NULL,
    PRIMARY KEY (domain_id, source)
  )`);
}
/** Array JSON valido di `domains.areas`, altrimenti `'[]'` (json_each lancia su JSON malformato). */
const SAFE_AREAS = "CASE WHEN json_valid(d.areas) AND json_type(d.areas) = 'array' THEN d.areas ELSE '[]' END";

/** Crea una tabella dello schema Drizzle che manca su un DB esistente, con lo stesso SQL di un DB nuovo. */
function ensureTable(name: string) {
  const ddl = SCHEMA_SQL.find((s) => s.startsWith(`CREATE TABLE \`${name}\``));
  if (!ddl) throw new Error(`schemaSql.ts non ha la tabella ${name}: npm run db:schema`);
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)) {
    sqlite.exec(ddl.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
  }
}

/**
 * Colonna aggiunta allo schema dopo la creazione della tabella. L'ALTER sta in una
 * transazione IMMEDIATE con ricontrollo: con i worker paralleli di `next build` un
 * secondo ALTER fallirebbe con «duplicate column». Tabella assente: niente da fare.
 */
function ensureColumn(table: string, column: string, type: string) {
  const has = () => (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]);
  const cols = has();
  if (!cols.length || cols.some((c) => c.name === column)) return;
  sqlite.transaction(() => {
    if (!has().some((c) => c.name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }).immediate();
}

/**
 * Hub su un DB esistente: crea le tabelle `areas`, `notes`, `sf6_combos` e `sf6_tips` e la colonna `sessions.updated_at`
 * con lo stesso SQL di un DB nuovo, e converte una volta i nomi liberi di `domains.areas` in slug.
 * Idempotente. Caso comune (tutto già fatto): solo letture, nessun lock di scrittura.
 */
export function ensureHubSchema() {
  ensureTable("areas");
  ensureTable("notes");
  ensureTable("sf6_combos");
  ensureTable("sf6_tips");
  ensureColumn("sessions", "updated_at", "integer");
  const cols = sqlite.prepare("PRAGMA table_info(domains)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "areas")) return;
  // valori di domains.areas che non sono slug esistenti (né stringhe valide da convertire)
  const pending = () => (sqlite.prepare(
    `SELECT count(*) AS n FROM domains d, json_each(${SAFE_AREAS}) j
     WHERE j.type <> 'text' OR j.value NOT IN (SELECT slug FROM areas)`
  ).get() as { n: number }).n;
  if (!pending()) return;
  sqlite.transaction(() => { if (pending()) convertAreaNames(); }).immediate();
}

/**
 * Nomi liberi → righe di `areas` (slug dal nome, posizione in ordine alfabetico) e
 * `domains.areas` riscritto con gli slug. Nomi uguali a meno delle maiuscole = un dominio.
 * Le righe con JSON non valido o non-array restano com'erano.
 */
function convertAreaNames() {
  const existing = sqlite.prepare("SELECT slug, name FROM areas").all() as { slug: string; name: string }[];
  const known = new Set(existing.map((a) => a.slug));
  const taken = new Set(known);
  const clean = (v: string) => v.trim().replace(/\s+/g, " ");
  const key = (v: string) => clean(v).toLowerCase();
  const byName = new Map(existing.map((a) => [key(a.name), a.slug]));

  const rows = (sqlite.prepare("SELECT id, areas FROM domains").all() as { id: number; areas: string | null }[]).flatMap((r) => {
    try {
      const a: unknown = JSON.parse(r.areas ?? "");
      return Array.isArray(a) ? [{ ...r, list: a.filter((x): x is string => typeof x === "string" && x.trim() !== "") }] : [];
    } catch {
      return [];
    }
  });

  // per ogni nome (a meno di maiuscole/spazi) vince la variante usata da più righe;
  // a parità quella che ordina prima con le maiuscole davanti ("Web" batte "web")
  const groups = new Map<string, Map<string, number>>();
  for (const r of rows) {
    for (const v of new Set(r.list.filter((x) => !known.has(x)).map(clean))) {
      if (byName.has(key(v))) continue;
      const g = groups.get(key(v)) ?? new Map<string, number>();
      g.set(v, (g.get(v) ?? 0) + 1);
      groups.set(key(v), g);
    }
  }
  const chosen = [...groups.values()].map((g) =>
    [...g.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "it", { caseFirst: "upper" }))[0][0]
  ).sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }) || a.localeCompare(b));

  let pos = (sqlite.prepare("SELECT coalesce(max(position) + 1, 0) AS p FROM areas").get() as { p: number }).p;
  const insert = sqlite.prepare("INSERT INTO areas (slug, name, position, created_at) VALUES (?, ?, ?, ?)");
  const now = Math.floor(Date.now() / 1000);
  for (const name of chosen) {
    const slug = uniqueSlug(slugify(name), taken);
    taken.add(slug);
    byName.set(key(name), slug);
    insert.run(slug, name, pos++, now);
  }

  const update = sqlite.prepare("UPDATE domains SET areas = ? WHERE id = ?");
  for (const r of rows) {
    const next = [...new Set(r.list.map((v) => (known.has(v) ? v : byName.get(key(v))!)))];
    const json = JSON.stringify(next);
    if (json !== r.areas) update.run(json, r.id);
  }
}

initSchema();
ensureLibrarySchema();
ensureHubSchema();

/** Crea la virtual table degli embedding. Idempotente. */
export function initVectorStore() {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[${EMBED_DIM}]
    );
  `);
}
