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

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): Args {
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
