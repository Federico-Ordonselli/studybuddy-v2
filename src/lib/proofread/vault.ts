/**
 * Copia corretta di un vault Obsidian in una cartella speculare. Gli originali non si
 * scrivono mai. Le note `.md` passano da `proofreadNote`, gli altri file (immagini,
 * PDF…) si copiano com'è, così la copia si apre anche come secondo vault.
 *
 * Stato in `<dest>/.studybuddy-proofread.json`: hash di ogni sorgente (con versione del
 * prompt e modello), esito e sezioni scartate. Un file invariato non si rielabora; un file
 * tolto dal vault si toglie dalla copia solo se l'aveva scritto questo strumento.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { models } from "@/lib/config";
import { proofreadNote, PROMPT_VERSION, type Generator, type NoteResult } from "./note";

export const STATE_FILE = ".studybuddy-proofread.json";

export interface FileState {
  hash: string;
  kind: "note" | "copy";
  /** sezioni tenute com'erano perché la correzione non era affidabile */
  rejected?: { reason: string; excerpt: string }[];
  corrected?: number;
  at: string;
}

export interface VaultState {
  version: 1;
  files: Record<string, FileState>;
}

export interface SyncEvent {
  file: string;
  action: "corrected" | "unchanged" | "copied" | "skipped" | "removed" | "error";
  rejected?: number;
  corrected?: number;
  error?: string;
}

export interface SyncOptions {
  gen?: Generator;
  force?: boolean;
  dryRun?: boolean;
  signal?: AbortSignal;
  onEvent?: (e: SyncEvent) => void;
}

/** Cartelle da non copiare: configurazione e cestino di Obsidian, cartelle nascoste. */
function ignored(name: string): boolean {
  return name.startsWith(".");
}

export function validatePaths(src: string, dest: string): { src: string; dest: string } {
  const s = path.resolve(src);
  const d = path.resolve(dest);
  if (!fs.existsSync(s) || !fs.statSync(s).isDirectory()) throw new Error(`Il vault non esiste: ${s}`);
  const rel = path.relative(s, d);
  if (!rel || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error("La copia deve stare fuori dal vault (altrimenti Obsidian mostra ogni nota due volte).");
  }
  const back = path.relative(d, s);
  if (!back.startsWith("..") && !path.isAbsolute(back)) throw new Error("Il vault non può stare dentro la cartella della copia.");
  return { src: s, dest: d };
}

/** Percorsi relativi (con `/`) di tutti i file del vault, cartelle nascoste escluse. */
export function listVault(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

export const isNote = (rel: string) => rel.toLowerCase().endsWith(".md");

/** Hash del contenuto più ciò che cambia l'esito: per le note, prompt e modello. */
export function sourceHash(rel: string, content: Buffer): string {
  const h = crypto.createHash("sha256").update(content);
  if (isNote(rel)) h.update(`\0${PROMPT_VERSION}\0${models.proofread.provider}:${models.proofread.model}`);
  return h.digest("hex");
}

export function readState(dest: string): VaultState {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dest, STATE_FILE), "utf8"));
    if (s?.version === 1 && s.files && typeof s.files === "object") return s;
  } catch {
    /* nessuno stato o illeggibile: si riparte */
  }
  return { version: 1, files: {} };
}

function writeAtomic(file: string, data: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** Toglie le cartelle rimaste vuote risalendo fino alla radice della copia (esclusa). */
function pruneEmptyDirs(root: string, dir: string) {
  while (dir !== root && dir.startsWith(root + path.sep)) {
    try {
      fs.rmdirSync(dir); // fallisce se non è vuota
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

export function writeState(dest: string, state: VaultState) {
  writeAtomic(path.join(dest, STATE_FILE), JSON.stringify(state, null, 2));
}

function excerpt(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

function summarize(result: NoteResult) {
  return {
    corrected: result.sections.filter((s) => s.status === "corrected").length,
    rejected: result.sections
      .filter((s) => s.status === "rejected")
      .map((s) => ({ reason: s.reason ?? "", excerpt: excerpt(s.original) })),
  };
}

/** Elabora un solo file del vault (percorso relativo). Aggiorna `state` in memoria. */
export async function syncFile(src: string, dest: string, rel: string, state: VaultState, opts: SyncOptions = {}): Promise<SyncEvent> {
  const from = path.join(src, rel);
  const to = path.join(dest, rel);
  if (!fs.existsSync(from)) {
    if (!state.files[rel]) return { file: rel, action: "skipped" };
    if (!opts.dryRun) {
      fs.rmSync(to, { force: true });
      delete state.files[rel];
      pruneEmptyDirs(dest, path.dirname(to));
    }
    return { file: rel, action: "removed" };
  }
  const content = fs.readFileSync(from);
  const hash = sourceHash(rel, content);
  const prev = state.files[rel];
  if (!opts.force && prev?.hash === hash && fs.existsSync(to)) return { file: rel, action: "skipped" };

  if (!isNote(rel)) {
    if (!opts.dryRun) {
      writeAtomic(to, content);
      state.files[rel] = { hash, kind: "copy", at: new Date().toISOString() };
    }
    return { file: rel, action: "copied" };
  }

  // nota rinominata o spostata: stesso contenuto già corretto altrove nella copia
  const twin = Object.entries(state.files).find(([f, st]) => f !== rel && st.hash === hash && fs.existsSync(path.join(dest, f)));
  if (twin && !opts.force) {
    if (!opts.dryRun) {
      writeAtomic(to, fs.readFileSync(path.join(dest, twin[0])));
      state.files[rel] = { ...twin[1], at: new Date().toISOString() };
    }
    return { file: rel, action: "copied" };
  }

  const result = await proofreadNote(content.toString("utf8"), opts.gen, opts.signal);
  const { corrected, rejected } = summarize(result);
  if (!opts.dryRun) {
    writeAtomic(to, result.text);
    state.files[rel] = { hash, kind: "note", corrected, rejected, at: new Date().toISOString() };
  }
  return { file: rel, action: corrected ? "corrected" : "unchanged", corrected, rejected: rejected.length };
}

/** Allinea tutta la copia al vault. Gli errori su un file non fermano gli altri. */
export async function syncVault(srcDir: string, destDir: string, opts: SyncOptions = {}): Promise<SyncEvent[]> {
  const { src, dest } = validatePaths(srcDir, destDir);
  const state = readState(dest);
  const files = listVault(src);
  const present = new Set(files);
  const events: SyncEvent[] = [];
  const emit = (e: SyncEvent) => {
    events.push(e);
    opts.onEvent?.(e);
  };
  for (const rel of [...files, ...Object.keys(state.files).filter((f) => !present.has(f))]) {
    opts.signal?.throwIfAborted();
    try {
      emit(await syncFile(src, dest, rel, state, opts));
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      emit({ file: rel, action: "error", error: e instanceof Error ? e.message : String(e) });
    }
    // stato salvato a ogni file: un'interruzione non fa rifare il lavoro già fatto
    if (!opts.dryRun) writeState(dest, state);
  }
  return events;
}

/**
 * Modalità watch: una passata iniziale, poi rielabora una nota quando non cambia da
 * `quietMs` (stai ancora scrivendo = l'autosalvataggio di Obsidian la tocca ogni pochi
 * secondi). Un file alla volta, in coda. Restituisce una funzione per fermarsi.
 */
export function watchVault(srcDir: string, destDir: string, quietMs: number, opts: SyncOptions = {}): () => void {
  const { src, dest } = validatePaths(srcDir, destDir);
  const timers = new Map<string, NodeJS.Timeout>();
  const queue: string[] = [];
  let busy = false;

  const ALL = "\0all"; // cartella creata, rinominata o tolta: si riallinea tutto

  const run = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const rel = queue.shift()!;
      try {
        if (rel === ALL) {
          await syncVault(src, dest, opts);
          continue;
        }
        const state = readState(dest);
        opts.onEvent?.(await syncFile(src, dest, rel, state, opts));
        if (!opts.dryRun) writeState(dest, state);
      } catch (e) {
        opts.onEvent?.({ file: rel === ALL ? "(vault)" : rel, action: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
    busy = false;
  };

  const schedule = (rel: string, delay: number) => {
    clearTimeout(timers.get(rel));
    timers.set(rel, setTimeout(() => {
      timers.delete(rel);
      if (!queue.includes(rel)) queue.push(rel);
      void run();
    }, delay));
  };

  const watcher = fs.watch(src, { recursive: true }, (_event, name) => {
    if (!name) return;
    const rel = name.toString().split(path.sep).join("/");
    if (rel.split("/").some(ignored)) return;
    const full = path.join(src, rel);
    const stat = fs.statSync(full, { throwIfNoEntry: false });
    const wasDir = !stat && Object.keys(readState(dest).files).some((f) => f.startsWith(`${rel}/`));
    if (stat?.isDirectory() || wasDir) schedule(ALL, 2000);
    else if (!stat || stat.isFile()) schedule(rel, isNote(rel) ? quietMs : 1000);
  });
  // passata iniziale in coda, dopo aver acceso il watcher: niente modifiche perse nel mezzo
  schedule(ALL, 0);

  return () => {
    watcher.close();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}
