import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { whisper as cfg } from "@/lib/config";
import { runOk } from "@/lib/proc";
import { parseSubtitles } from "@/lib/subtitles";
import { transcribeWithGroq } from "@/lib/groq";

/**
 * Trascrizione di video **e audio**. `transcribeToSrt` (ingest dei corsi) usa il sidecar locale
 * e restituisce SRT o null; `transcribeMedia` (modulo SF6) restituisce il testo e sceglie il
 * backend: `local` di default, `groq` solo con `TRANSCRIBE_BACKEND=groq`. I processi sono
 * asincroni: una trascrizione non blocca il server.
 *
 * Backend locali (auto-detect in quest'ordine): faster-whisper (script Python),
 * whisper.cpp (binario + modello .bin, via ffmpeg→wav), openai-whisper (CLI).
 */
const SIDECAR = path.resolve(/* turbopackIgnore: true */ process.cwd(), "scripts/whisper_sidecar.py");

/** Python del venv di progetto se presente, altrimenti il python3 di sistema. */
function pythonBin(): string {
  const venv = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".venv/bin/python");
  return fs.existsSync(venv) ? venv : "python3";
}

/**
 * Env dei processi Python di Whisper: le lib CUDA 12 + cuDNN 9 dei pacchetti pip
 * `nvidia-*-cu12` della .venv in testa a LD_LIBRARY_PATH. Solo nel processo figlio:
 * Node (onnxruntime-node, reranker) usa CUDA 13 di sistema e con queste lib davanti
 * caricherebbe il `libcudnn.so.9` sbagliato. Senza .venv l'env resta quello di prima.
 */
export function whisperEnv(
  root = path.resolve(/* turbopackIgnore: true */ process.cwd()),
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const ls = (dir: string) => { try { return fs.readdirSync(dir).sort(); } catch { return []; } };
  const venvLib = path.join(root, ".venv", "lib");
  const libs = ls(venvLib)
    .filter((py) => py.startsWith("python"))
    .flatMap((py) => {
      const nvidia = path.join(venvLib, py, "site-packages", "nvidia");
      return ls(nvidia).map((pkg) => path.join(nvidia, pkg, "lib")).filter((d) => fs.existsSync(d));
    });
  if (!libs.length) return base;
  return { ...base, LD_LIBRARY_PATH: [...libs, base.LD_LIBRARY_PATH].filter(Boolean).join(":") };
}

function has(bin: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0;
}

function hasFasterWhisper(): boolean {
  return spawnSync(pythonBin(), ["-c", "import faster_whisper"], { stdio: "ignore", env: whisperEnv() }).status === 0;
}

type Backend = "faster-whisper" | "whisper.cpp" | "openai-whisper";

function pickBackend(): Backend | null {
  const want = cfg.backend;
  if (want === "faster-whisper") return hasFasterWhisper() ? "faster-whisper" : null;
  if (want === "whisper.cpp") return has(cfg.cppBinary) && cfg.cppModel ? "whisper.cpp" : null;
  if (want === "openai-whisper") return has("whisper") ? "openai-whisper" : null;
  // auto
  if (hasFasterWhisper()) return "faster-whisper";
  if (has(cfg.cppBinary) && cfg.cppModel) return "whisper.cpp";
  if (has("whisper")) return "openai-whisper";
  return null;
}

/** True se esiste un backend Whisper utilizzabile (per messaggi/skip a monte). */
export function whisperAvailable(): boolean {
  return pickBackend() !== null;
}

const TIMEOUT_MS = 2 * 3600_000; // un VOD di ore su CPU

/** SRT del backend locale; lancia se non c'è un backend o se l'output è vuoto. */
async function localSrt(media: string, language = cfg.language): Promise<string> {
  const backend = pickBackend();
  if (!backend) throw new Error("nessun backend Whisper locale (faster-whisper, whisper.cpp o openai-whisper)");
  const srt = backend === "faster-whisper" ? await fasterWhisper(media, language)
    : backend === "whisper.cpp" ? await whisperCpp(media, language)
    : await openaiWhisper(media, language);
  if (!srt) throw new Error(`trascrizione vuota (${backend})`);
  return srt;
}

/** Ingest dei corsi: SRT o null (nessun backend, o errore: si salta il video). */
export async function transcribeToSrt(media: string): Promise<string | null> {
  if (!pickBackend()) return null;
  try {
    return await localSrt(media);
  } catch (e) {
    console.warn(`[whisper] trascrizione fallita per ${path.basename(media)}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export type TranscribeBackend = "local" | "groq";

export function transcribeBackend(env: NodeJS.ProcessEnv = process.env): TranscribeBackend {
  const v = env.TRANSCRIBE_BACKEND?.trim();
  if (!v || v === "local") return "local";
  if (v === "groq") return "groq";
  throw new Error(`TRANSCRIBE_BACKEND sconosciuto: ${v} (local o groq)`);
}

export interface Transcript { text: string; language: string | null; durationSec: number | null; backend: TranscribeBackend }

/** Testo di un file audio o video, col backend configurato. */
export async function transcribeMedia(file: string, opts: { language?: string } = {}): Promise<Transcript> {
  if (transcribeBackend() === "groq") return { ...(await transcribeWithGroq(file, opts)), backend: "groq" };
  const cues = parseSubtitles(await localSrt(file, opts.language ?? cfg.language));
  return {
    text: cues.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim(),
    language: opts.language ?? cfg.language ?? null,
    durationSec: cues.at(-1)?.endSec ?? null,
    backend: "local",
  };
}

async function fasterWhisper(media: string, language?: string): Promise<string | null> {
  const r = await runOk(pythonBin(), [SIDECAR, media, cfg.model, language ?? ""], { timeoutMs: TIMEOUT_MS, env: whisperEnv() });
  return r.stdout.includes("-->") ? r.stdout : null;
}

async function whisperCpp(media: string, language?: string): Promise<string | null> {
  // whisper.cpp vuole WAV 16kHz mono: estraiamo l'audio con ffmpeg.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-whisper-"));
  try {
    const wav = path.join(tmp, "audio.wav");
    await runOk("ffmpeg", ["-y", "-i", media, "-ar", "16000", "-ac", "1", "-f", "wav", wav], { timeoutMs: TIMEOUT_MS });
    const outBase = path.join(tmp, "out");
    await runOk(cfg.cppBinary, ["-m", cfg.cppModel, "-f", wav, "-osrt", "-of", outBase, ...(language ? ["-l", language] : [])], { timeoutMs: TIMEOUT_MS });
    const srt = `${outBase}.srt`;
    return fs.existsSync(srt) ? fs.readFileSync(srt, "utf8") : null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function openaiWhisper(media: string, language?: string): Promise<string | null> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-whisper-"));
  try {
    const args = ["--model", cfg.model, "--output_format", "srt", "--output_dir", tmp, ...(language ? ["--language", language] : []), media];
    await runOk("whisper", args, { timeoutMs: TIMEOUT_MS });
    const srt = path.join(tmp, path.basename(media).replace(/\.[^.]+$/, ".srt"));
    return fs.existsSync(srt) ? fs.readFileSync(srt, "utf8") : null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
