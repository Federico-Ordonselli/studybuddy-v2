/**
 * Correzione degli appunti come attività avviata a mano (bottone in Impostazioni). Una
 * alla volta, in memoria come il download Coursera: un riavvio del server la interrompe,
 * ma lo stato su disco fa ripartire dalle note non ancora fatte.
 *
 * I vault si scelgono per nome fra le sottocartelle di `NOTES_DIR` (default `obsidian/`,
 * override `STUDYBUDDY_OBSIDIAN_DIR`): dal client non arriva mai un percorso.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LibraryError, OllamaUnavailableError } from "@/lib/errors";
import { isNote, listVault, readState, STATE_FILE, syncVault, type SyncEvent } from "./vault";
import type { Generator } from "./note";

export const NOTES_DIR = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.STUDYBUDDY_OBSIDIAN_DIR ?? "obsidian",
);

export const COPY_SUFFIX = "-pulito";

export interface ReviewItem {
  file: string;
  reason: string;
  excerpt: string;
}

export interface VaultInfo {
  name: string;
  notes: number;
  copy: string;
  /** ultima passata (dallo stato della copia), se c'è */
  lastRun?: string;
  /** sezioni lasciate com'erano nella copia */
  review: ReviewItem[];
}

type Counts = Record<SyncEvent["action"], number>;

export interface ProofreadJob {
  id: string;
  vault: string;
  copy: string;
  status: "running" | "done" | "error" | "cancelled";
  total: number;
  processed: number;
  current?: string;
  counts: Counts;
  errors: { file: string; error: string }[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

const state = globalThis as typeof globalThis & {
  proofreadJob?: ProofreadJob;
  proofreadAbort?: AbortController;
};

/** Le copie si riconoscono dallo stato che ci scrive lo strumento, non dal nome. */
const isCopy = (dir: string) => fs.existsSync(path.join(dir, STATE_FILE));

function reviewOf(copyDir: string): { lastRun?: string; review: ReviewItem[] } {
  if (!isCopy(copyDir)) return { review: [] };
  const files = readState(copyDir).files;
  const review = Object.entries(files).flatMap(([file, f]) => (f.rejected ?? []).map((r) => ({ file, ...r })));
  const lastRun = Object.values(files).map((f) => f.at).sort().at(-1);
  return { lastRun, review };
}

export function listVaults(root = NOTES_DIR): VaultInfo[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !isCopy(path.join(root, e.name)))
    .map((e) => {
      const dir = path.join(root, e.name);
      const copy = `${e.name}${COPY_SUFFIX}`;
      return { name: e.name, notes: listVault(dir).filter(isNote).length, copy, ...reviewOf(path.join(root, copy)) };
    })
    .filter((v) => v.notes > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function currentProofread(): ProofreadJob | null {
  return state.proofreadJob ?? null;
}

const zero = (): Counts => ({ corrected: 0, unchanged: 0, copied: 0, skipped: 0, removed: 0, error: 0 });

export function startProofread(input: Record<string, unknown>, opts: { root?: string; gen?: Generator } = {}): ProofreadJob {
  const root = opts.root ?? NOTES_DIR;
  if (typeof input.vault !== "string" || !input.vault) throw new LibraryError("Scegli un vault.");
  const vault = listVaults(root).find((v) => v.name === input.vault);
  if (!vault) throw new LibraryError("Vault non trovato nella cartella degli appunti.", 404);
  if (state.proofreadJob?.status === "running") throw new LibraryError("C’è già una correzione in corso.", 409);

  const job: ProofreadJob = {
    id: randomUUID(), vault: vault.name, copy: vault.copy, status: "running",
    total: 0, processed: 0, counts: zero(), errors: [], startedAt: new Date().toISOString(),
  };
  const abort = new AbortController();
  state.proofreadJob = job;
  state.proofreadAbort = abort;
  void run(job, path.join(root, vault.name), path.join(root, vault.copy), input.force === true, abort.signal, opts.gen);
  return job;
}

export function cancelProofread(): ProofreadJob {
  const job = state.proofreadJob;
  if (!job || job.status !== "running") throw new LibraryError("Nessuna correzione in corso.", 409);
  state.proofreadAbort?.abort();
  return job;
}

async function run(job: ProofreadJob, src: string, dest: string, force: boolean, signal: AbortSignal, gen?: Generator) {
  try {
    await syncVault(src, dest, {
      gen, force, signal,
      onPlan: (total) => { job.total = total; },
      onFile: (file) => { job.current = file; },
      onEvent: (e) => {
        job.processed++;
        job.counts[e.action]++;
        if (e.action === "error") job.errors.push({ file: e.file, error: e.error ?? "errore" });
        job.current = undefined;
      },
    });
    job.status = "done";
  } catch (e) {
    if (signal.aborted) job.status = "cancelled";
    else {
      job.status = "error";
      job.error = e instanceof OllamaUnavailableError
        ? "Ollama non raggiungibile: avvialo e riprova. Le note già corrette restano nella copia."
        : e instanceof Error ? e.message : String(e);
    }
  } finally {
    job.current = undefined;
    job.finishedAt = new Date().toISOString();
  }
}
