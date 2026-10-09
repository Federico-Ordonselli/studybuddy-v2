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

/** Esegue `cmd`; un exit ≠ 0 non è un errore (lo decide il chiamante), binario mancante e timeout sì. */
export function run(cmd: string, args: string[], opts: { timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<RunResult> {
  const name = path.basename(cmd);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: opts.env ?? process.env });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => { stdout += c; });
    child.stderr.setEncoding("utf8").on("data", (c: string) => { stderr += c; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${name}: tempo scaduto (oltre ${Math.round(opts.timeoutMs / 1000)} s)`));
    }, opts.timeoutMs);
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(e.code === "ENOENT" ? `${name} non installato` : `${name}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

/** Come `run`, ma un exit ≠ 0 è un errore con l'inizio di stderr. */
export async function runOk(cmd: string, args: string[], opts: { timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${path.basename(cmd)} exit ${r.code}: ${r.stderr.trim().slice(0, 400)}`);
  return r;
}
