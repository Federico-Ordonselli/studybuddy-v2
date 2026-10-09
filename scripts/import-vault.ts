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
  // Pulizia unica per `finally` e segnali. Non tocca mai il target. Chiude solo una
  // connessione che punta al file di lavoro (`sqlite` è azzerato se non lo è).
  const cleanup = () => {
    try { sqlite?.close(); } catch { /* già chiuso */ }
    sqlite = undefined;
    for (const f of [work, `${work}-wal`, `${work}-shm`]) fs.rmSync(f, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  // Il backup online gira in un thread: se si pulisce a metà, riscrive il file di lavoro dopo la
  // rimozione. Il segnale quindi aspetta che finisca (poi cleanup).
  let backing: Promise<unknown> | undefined;
  let interrupted = false;
  // Dopo un segnale il flusso principale si ferma al prossimo punto asincrono: ci pensa il gestore a uscire.
  const stopIfInterrupted = async () => { if (interrupted) await new Promise<never>(() => {}); };
  const onSignal = (sig: NodeJS.Signals, code: number) => async () => {
    interrupted = true;
    await backing?.catch(() => {});
    cleanup();
    console.error(`\nInterrotto (${sig}): file di lavoro e copie temporanee rimossi, niente scritto.`);
    process.exit(code);
  };
  const onInt = onSignal("SIGINT", 130);
  const onTerm = onSignal("SIGTERM", 143);
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  try {
    // 1. vault: copia del .db + WAL, lettura della copia; domini dal codice del vault
    const vault = readVault(snapshotVaultDb(args.vault, tmp));
    const domains = await loadVaultDomains(args.vault);

    // 2. StudyBuddy: backup online (coerente anche col WAL) da una connessione in sola lettura
    const src = new Database(args.from, { readonly: true, fileMustExist: true });
    try { await (backing = src.backup(work)); } finally { src.close(); }
    await stopIfInterrupted();

    // 3. il file di lavoro diventa il DB dell'app: l'import di @/lib/db esegue ensureHubSchema()
    process.env.DB_PATH = work;
    ({ sqlite } = await import("@/lib/db"));
    // Se qualcosa ha caricato @/lib/db prima di DB_PATH, il modulo è in cache sul DB sbagliato
    // (magari quello reale): non scrivere e non chiudere quella connessione (il close farebbe
    // un checkpoint su un file che non è nostro), quindi la si "dimentica" prima di lanciare.
    if (path.resolve(sqlite.name) !== path.resolve(work)) {
      const aperto = sqlite.name;
      sqlite = undefined;
      throw new Error(`@/lib/db è già aperto su ${aperto}, non sul file di lavoro: interrotto senza scrivere`);
    }
    const { planImport, applyImport } = await import("@/lib/vaultImport/plan");
    const { formatReport } = await import("@/lib/vaultImport/report");
    await stopIfInterrupted();

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
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
    cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
