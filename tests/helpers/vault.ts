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

/**
 * Copia di un vault finto «fermo» (app spenta): stessi file, dati ancora nel WAL e nessuna
 * connessione viva. Il vault finto vivo tiene aperta la connessione, e SQLite fa il
 * checkpoint solo alla chiusura dell'ultima: senza questa copia il test sull'originale non
 * discriminerebbe.
 */
export function stoppedVaultCopy(liveDir: string): { dir: string; files: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-stopped-"));
  fs.mkdirSync(path.join(dir, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data"));
  fs.copyFileSync(path.join(liveDir, "src", "lib", "domains.ts"), path.join(dir, "src", "lib", "domains.ts"));
  const rels = ["data/vault.db", "data/vault.db-wal", "data/vault.db-shm"];
  for (const rel of rels) {
    const src = path.join(liveDir, rel);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, rel));
  }
  return { dir, files: rels.map((rel) => path.join(dir, rel)) };
}

/** sha256 di ogni file, «assente» se non c'è: per controllare che gli originali non cambino. */
export function fingerprint(files: string[]): string[] {
  return files.map((f) => (fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : "assente"));
}
