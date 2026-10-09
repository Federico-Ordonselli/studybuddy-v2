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
