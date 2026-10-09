import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Processi esterni (Whisper, ffmpeg, yt-dlp) senza bloccare l'event loop: con `spawnSync`
 * una trascrizione di minuti fermerebbe tutto il server.
 */
export interface RunResult { stdout: string; stderr: string; code: number }

/** Binario della .venv di progetto se c'è (in Docker /app/.venv: yt-dlp), altrimenti quello del PATH. */
export function venvBin(name: string, root = path.resolve(/* turbopackIgnore: true */ process.cwd())): string {
  const p = path.join(root, ".venv", "bin", name);
  return fs.existsSync(p) ? p : name;
}

export interface RunOpts { timeoutMs: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal }

/**
 * Esegue `cmd`; un exit ≠ 0 non è un errore (lo decide il chiamante), binario mancante, timeout e
 * abort del `signal` sì. Il figlio parte in un proprio gruppo di processi e a timeout/abort si
 * uccide l'intero gruppo, così i nipoti (es. l'ffmpeg di yt-dlp) non restano orfani.
 */
export function run(cmd: string, args: string[], opts: RunOpts): Promise<RunResult> {
  const name = path.basename(cmd);
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error(`${name}: interrotto`));
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: opts.env ?? process.env, detached: true });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => { stdout += c; });
    child.stderr.setEncoding("utf8").on("data", (c: string) => { stderr += c; });
    const killTree = () => {
      try {
        if (child.pid === undefined) throw new Error("senza pid");
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const onAbort = () => {
      killTree();
      cleanup();
      reject(new Error(`${name}: interrotto`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      killTree();
      cleanup();
      reject(new Error(`${name}: tempo scaduto (oltre ${Math.round(opts.timeoutMs / 1000)} s)`));
    }, opts.timeoutMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e: NodeJS.ErrnoException) => {
      cleanup();
      reject(new Error(e.code === "ENOENT" ? `${name} non installato` : `${name}: ${e.message}`));
    });
    child.on("close", (code) => {
      cleanup();
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

/** Come `run`, ma un exit ≠ 0 è un errore con l'inizio di stderr. */
export async function runOk(cmd: string, args: string[], opts: RunOpts): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${path.basename(cmd)} exit ${r.code}: ${r.stderr.trim().slice(0, 400)}`);
  return r;
}
