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
