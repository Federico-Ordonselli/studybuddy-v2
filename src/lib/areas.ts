import { sqlite } from "@/lib/db";
import { LibraryError } from "@/lib/errors";
import { MODULES, type ModuleInfo } from "@/lib/modules";
import { slugify, uniqueSlug } from "@/lib/slug";

/**
 * Domini dell'hub (tabella `areas`, «Domini» in UI). `domains.areas` contiene i loro
 * slug. Ogni mutazione valida gli invarianti e lancia `LibraryError` con lo status HTTP.
 */
export interface Area { slug: string; name: string; tagline: string; symbol: string; module: string | null; position: number }
export interface AreaInfo extends Area { courses: number; notes: number }

const COLS = "a.slug, a.name, a.tagline, a.symbol, a.module, a.position";
// json_each lancia su JSON malformato: le righe rotte contano come nessun dominio
export const SAFE_AREAS = "CASE WHEN json_valid(d.areas) AND json_type(d.areas) = 'array' THEN d.areas ELSE '[]' END";
// righe in cui la UI mostra/modifica i domini: macro e corsi sciolti (genitore assente o non macro)
export const VISIBLE = "(d.kind = 'macro' OR d.parent_id IS NULL OR d.parent_id NOT IN (SELECT id FROM domains WHERE kind = 'macro'))";
const nowSec = () => Math.floor(Date.now() / 1000);

export function listAreas(): AreaInfo[] {
  return sqlite.prepare(
    `SELECT ${COLS},
            (SELECT count(*) FROM domains d, json_each(${SAFE_AREAS}) j WHERE ${VISIBLE} AND j.value = a.slug) AS courses,
            (SELECT count(*) FROM notes n WHERE n.domain = a.slug) AS notes
     FROM areas a ORDER BY a.position, a.name COLLATE NOCASE`
  ).all() as AreaInfo[];
}

function get(slug: string): Area {
  const a = sqlite.prepare(`SELECT ${COLS} FROM areas a WHERE a.slug = ?`).get(slug) as Area | undefined;
  if (!a) throw new LibraryError("dominio non trovato", 404);
  return a;
}

/** Il dominio con questo slug, o undefined (pagine: notFound). */
export function findArea(slug: string): Area | undefined {
  return sqlite.prepare(`SELECT ${COLS} FROM areas a WHERE a.slug = ?`).get(slug) as Area | undefined;
}

// --- validazione ---------------------------------------------------------------

function cleanName(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new LibraryError("il nome del dominio non può essere vuoto");
  const n = v.trim().replace(/\s+/g, " ");
  if (n.length > 60) throw new LibraryError("nome del dominio troppo lungo (max 60 caratteri)");
  return n;
}

function cleanTagline(v: unknown): string {
  if (v == null) return "";
  if (typeof v !== "string") throw new LibraryError("tagline non valida");
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length > 140) throw new LibraryError("tagline troppo lunga (max 140 caratteri)");
  return t;
}

const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].length;

function cleanSymbol(v: unknown): string {
  if (v == null) return "·";
  if (typeof v !== "string") throw new LibraryError("simbolo non valido");
  const s = v.trim();
  if (!s) return "·";
  if (graphemes(s) > 2) throw new LibraryError("il simbolo è al massimo di 2 caratteri");
  return s;
}

export function validateModule(m: unknown, registry: Record<string, ModuleInfo> = MODULES): string | null {
  if (m == null || m === "") return null;
  if (typeof m !== "string" || !Object.hasOwn(registry, m)) throw new LibraryError(`modulo sconosciuto: ${String(m)}`);
  return m;
}

/** Nomi unici a meno delle maiuscole: AreaInput risolve un nome digitato nel dominio con quel nome. */
function checkNameFree(name: string, except?: string) {
  const other = sqlite.prepare("SELECT slug FROM areas WHERE lower(name) = lower(?) AND slug IS NOT ?").get(name, except ?? null);
  if (other) throw new LibraryError(`esiste già un dominio «${name}»`, 409);
}

export function assertAreasExist(slugs: string[]) {
  if (!slugs.length) return;
  const have = new Set((sqlite.prepare("SELECT slug FROM areas").all() as { slug: string }[]).map((r) => r.slug));
  const missing = slugs.filter((s) => !have.has(s));
  if (missing.length) throw new LibraryError(`dominio sconosciuto: ${missing.join(", ")}`);
}

// --- mutazioni -----------------------------------------------------------------

export function createArea(input: { name?: unknown; tagline?: unknown; symbol?: unknown; module?: unknown }): Area {
  const name = cleanName(input.name);
  const tagline = cleanTagline(input.tagline);
  const symbol = cleanSymbol(input.symbol);
  const module = validateModule(input.module);
  return sqlite.transaction(() => {
    checkNameFree(name);
    const taken = new Set((sqlite.prepare("SELECT slug FROM areas").all() as { slug: string }[]).map((r) => r.slug));
    const slug = uniqueSlug(slugify(name), taken);
    const position = (sqlite.prepare("SELECT coalesce(max(position) + 1, 0) AS p FROM areas").get() as { p: number }).p;
    sqlite.prepare("INSERT INTO areas (slug, name, tagline, symbol, module, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(slug, name, tagline, symbol, module, position, nowSec());
    return get(slug);
  })();
}

/** Lo slug non cambia mai: rinominare cambia solo `name`. */
export function updateArea(slug: string, patch: { name?: unknown; tagline?: unknown; symbol?: unknown; module?: unknown }): Area {
  get(slug);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    const n = cleanName(patch.name);
    checkNameFree(n, slug);
    sets.push("name = ?"); vals.push(n);
  }
  if (patch.tagline !== undefined) { sets.push("tagline = ?"); vals.push(cleanTagline(patch.tagline)); }
  if (patch.symbol !== undefined) { sets.push("symbol = ?"); vals.push(cleanSymbol(patch.symbol)); }
  if (patch.module !== undefined) { sets.push("module = ?"); vals.push(validateModule(patch.module)); }
  if (sets.length) sqlite.prepare(`UPDATE areas SET ${sets.join(", ")} WHERE slug = ?`).run(...vals, slug);
  return get(slug);
}

/** Nuovo ordine: deve contenere ogni dominio esattamente una volta. */
export function reorderAreas(slugs: unknown) {
  const all = (sqlite.prepare("SELECT slug FROM areas").all() as { slug: string }[]).map((r) => r.slug);
  const ok = Array.isArray(slugs) && slugs.length === all.length && new Set(slugs).size === all.length
    && slugs.every((s) => typeof s === "string" && all.includes(s));
  if (!ok) throw new LibraryError("ordine non valido: servono tutti i domini, una volta ciascuno");
  const set = sqlite.prepare("UPDATE areas SET position = ? WHERE slug = ?");
  sqlite.transaction(() => (slugs as string[]).forEach((s, i) => set.run(i, s)))();
}

/**
 * Si elimina solo un dominio senza corsi visibili né note. Sulle righe nascoste (corsi dentro un macro) lo slug viene tolto da sé.
 */
export function deleteArea(slug: string) {
  get(slug);
  sqlite.transaction(() => {
    const { n } = sqlite.prepare(
      `SELECT count(*) AS n FROM domains d, json_each(${SAFE_AREAS}) j WHERE ${VISIBLE} AND j.value = ?`
    ).get(slug) as { n: number };
    if (n > 0) throw new LibraryError(`${n} ${n === 1 ? "corso usa" : "corsi usano"} questo dominio: toglilo prima dai corsi`, 409);
    const { m } = sqlite.prepare("SELECT count(*) AS m FROM notes WHERE domain = ?").get(slug) as { m: number };
    if (m > 0) throw new LibraryError(`${m} ${m === 1 ? "nota è" : "note sono"} in questo dominio: spostale o eliminale prima`, 409);
    const hidden = sqlite.prepare(
      `SELECT d.id, d.areas FROM domains d, json_each(${SAFE_AREAS}) j WHERE j.value = ?`
    ).all(slug) as { id: number; areas: string }[];
    const set = sqlite.prepare("UPDATE domains SET areas = ? WHERE id = ?");
    for (const r of hidden) set.run(JSON.stringify((JSON.parse(r.areas) as unknown[]).filter((v) => v !== slug)), r.id);
    sqlite.prepare("DELETE FROM areas WHERE slug = ?").run(slug);
  })();
}
