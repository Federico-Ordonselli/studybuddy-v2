import { sqlite } from "@/lib/db";
import { LibraryError } from "@/lib/errors";
import { getSf6Character } from "./roster";
import { FUNDAMENTALS_SLUG, isFundamentalType } from "./fundamentals";
import { CHARACTER_TIP_TYPES, COMBO_STATUSES, type ComboRow, type ComboStatus, type TipRow, type TipType } from "./types";

/**
 * Combo e consigli SF6 (tabelle `sf6_combos`, `sf6_tips`, create in F4). La logica delle
 * route del vault (learning-vault@439b105) con due correzioni: in PATCH `null` o `""`
 * svuotano il campo (il vault li ignorava), e i numeri non validi sono 400 (non NaN).
 * `created_at` è in secondi, come nel vault e nei dati importati.
 */
interface ComboDb {
  id: number; character_slug: string; notation: string; situation: string | null; status: string;
  damage: number | null; drive_cost: number | null; notes: string | null; created_at: number;
}
interface TipDb {
  id: number; character_slug: string; type: string; title: string; content: string; notation: string | null;
  source_title: string | null; source_url: string | null; created_at: number;
}

const ORDER = "ORDER BY created_at DESC, id DESC";
const iso = (sec: number) => new Date(sec * 1000).toISOString();
const nowSec = () => Math.floor(Date.now() / 1000);

const combo = (r: ComboDb): ComboRow => ({
  id: r.id, characterSlug: r.character_slug, notation: r.notation, situation: r.situation,
  status: r.status as ComboStatus, damage: r.damage, driveCost: r.drive_cost, notes: r.notes, createdAt: iso(r.created_at),
});
const tip = (r: TipDb): TipRow => ({
  id: r.id, characterSlug: r.character_slug, type: r.type as TipType, title: r.title, content: r.content,
  notation: r.notation, sourceTitle: r.source_title, sourceUrl: r.source_url, createdAt: iso(r.created_at),
});

// --- validazione -----------------------------------------------------------------

function rowId(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new LibraryError("id non valido");
  return n;
}
function character(v: unknown): string {
  if (typeof v !== "string" || !getSf6Character(v)) throw new LibraryError("personaggio sconosciuto");
  return v;
}
/** Testo ripulito; vuoto o non stringa = null. */
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
function notation(v: unknown): string {
  const t = text(v);
  if (!t) throw new LibraryError("la notation è obbligatoria");
  return t;
}
function status(v: unknown): ComboStatus {
  if (typeof v !== "string" || !(COMBO_STATUSES as readonly string[]).includes(v)) throw new LibraryError(`stato non valido: ${String(v)}`);
  return v as ComboStatus;
}
/** Intero ≥ 0 (al più `max`), oppure null per null/undefined/"". */
function count(v: unknown, what: string, max = Infinity): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new LibraryError(`${what} non valido`);
  return Math.min(n, max);
}

// --- combo -------------------------------------------------------------------------

export function listCombos(characterSlug?: string): ComboRow[] {
  const rows = characterSlug
    ? sqlite.prepare(`SELECT * FROM sf6_combos WHERE character_slug = ? ${ORDER}`).all(characterSlug)
    : sqlite.prepare(`SELECT * FROM sf6_combos ${ORDER}`).all();
  return (rows as ComboDb[]).map(combo);
}

export function recentCombos(limit = 5): ComboRow[] {
  return (sqlite.prepare(`SELECT * FROM sf6_combos ${ORDER} LIMIT ?`).all(limit) as ComboDb[]).map(combo);
}

export function comboCounts(): Record<string, number> {
  const rows = sqlite.prepare("SELECT character_slug AS slug, count(*) AS n FROM sf6_combos GROUP BY character_slug").all() as { slug: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.slug, r.n]));
}

export function createCombo(body: Record<string, unknown>): ComboRow {
  const r = sqlite.prepare(
    `INSERT INTO sf6_combos (character_slug, notation, situation, status, damage, drive_cost, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ).get(
    character(body.character_slug), notation(body.notation), text(body.situation),
    body.status == null ? "learning" : status(body.status),
    count(body.damage, "danno"), count(body.drive_cost, "costo drive", 6), text(body.notes), nowSec(),
  ) as ComboDb;
  return combo(r);
}

export function updateCombo(id: unknown, body: Record<string, unknown>): ComboRow {
  const n = rowId(id);
  const set: [string, unknown][] = [];
  if ("notation" in body) set.push(["notation", notation(body.notation)]);
  if ("situation" in body) set.push(["situation", text(body.situation)]);
  if ("notes" in body) set.push(["notes", text(body.notes)]);
  if ("status" in body) set.push(["status", status(body.status)]);
  if ("damage" in body) set.push(["damage", count(body.damage, "danno")]);
  if ("drive_cost" in body) set.push(["drive_cost", count(body.drive_cost, "costo drive", 6)]);
  if (!set.length) throw new LibraryError("niente da aggiornare");
  const r = sqlite.prepare(`UPDATE sf6_combos SET ${set.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ? RETURNING *`)
    .get(...set.map(([, v]) => v), n) as ComboDb | undefined;
  if (!r) throw new LibraryError("combo non trovata", 404);
  return combo(r);
}

export function deleteCombo(id: unknown): void {
  sqlite.prepare("DELETE FROM sf6_combos WHERE id = ?").run(rowId(id));
}

// --- consigli ------------------------------------------------------------------------

export function listTips(filter: { character?: string | null; general?: boolean } = {}): TipRow[] {
  const slug = filter.general ? FUNDAMENTALS_SLUG : filter.character ?? null;
  const rows = slug
    ? sqlite.prepare(`SELECT * FROM sf6_tips WHERE character_slug = ? ${ORDER}`).all(slug)
    : sqlite.prepare(`SELECT * FROM sf6_tips ${ORDER}`).all();
  return (rows as TipDb[]).map(tip);
}

/** Salva gli item scelti nel dialog d'import: per un personaggio o, con `is_general`, fondamentali. */
export function createTips(body: Record<string, unknown>): TipRow[] {
  const general = body.is_general === true || body.is_general === "true";
  const slug = general ? FUNDAMENTALS_SLUG : character(body.character_slug);
  const allowed = (t: string) =>
    t === "overview" || (general ? isFundamentalType(t) : (CHARACTER_TIP_TYPES as readonly string[]).includes(t));
  const items = (Array.isArray(body.items) ? body.items : []).flatMap((raw: unknown) => {
    if (!raw || typeof raw !== "object") return [];
    const it = raw as Record<string, unknown>;
    const type = typeof it.type === "string" && allowed(it.type) ? it.type : null;
    const title = text(it.title), content = text(it.content);
    if (!type || !title || !content) return [];
    return [{ type, title, content, notation: !general && type === "combo" ? text(it.notation) : null }];
  });
  if (!items.length) throw new LibraryError("Nessun item valido.");
  const sourceTitle = text(body.source_title), sourceUrl = text(body.source_url), now = nowSec();
  const ins = sqlite.prepare(
    `INSERT INTO sf6_tips (character_slug, type, title, content, notation, source_title, source_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  );
  return sqlite.transaction(() =>
    items.map((it) => tip(ins.get(slug, it.type, it.title, it.content, it.notation, sourceTitle, sourceUrl, now) as TipDb)),
  )();
}

export function deleteTip(id: unknown): void {
  sqlite.prepare("DELETE FROM sf6_tips WHERE id = ?").run(rowId(id));
}
