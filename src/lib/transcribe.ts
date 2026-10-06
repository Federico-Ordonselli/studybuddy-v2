import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { whisper as cfg } from "@/lib/config";

/**
 * Trascrizione video via sidecar locale (Whisper). Restituisce SRT grezzo, che
 * l'ingestion parsa con `parseSubtitles` (stesso path delle trascrizioni Coursera).
 * Nessun backend installato ⇒ ritorna null (l'ingest salta il video).
 *
 * Backend supportati (auto-detect in quest'ordine): faster-whisper (script Python),
 * whisper.cpp (binario + modello .bin, via ffmpeg→wav), openai-whisper (CLI).
 */
const SIDECAR = path.resolve(/* turbopackIgnore: true */ process.cwd(), "scripts/whisper_sidecar.py");

/** Python del venv di progetto se presente, altrimenti il python3 di sistema. */
function pythonBin(): string {
  const venv = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".venv/bin/python");
  return fs.existsSync(venv) ? venv : "python3";
}

function has(bin: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0;
}

function hasFasterWhisper(): boolean {
  return spawnSync(pythonBin(), ["-c", "import faster_whisper"], { stdio: "ignore" }).status === 0;
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

export function transcribeToSrt(video: string): string | null {
  const backend = pickBackend();
  if (!backend) return null;
  try {
    if (backend === "faster-whisper") return fasterWhisper(video);
    if (backend === "whisper.cpp") return whisperCpp(video);
    return openaiWhisper(video);
  } catch (e) {
    console.warn(`[whisper] trascrizione fallita (${backend}) per ${path.basename(video)}: ${e}`);
    return null;
  }
}

function fasterWhisper(video: string): string | null {
  const args = [SIDECAR, video, cfg.model, cfg.language ?? ""];
  const r = spawnSync(pythonBin(), args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr?.trim() || `exit ${r.status}`);
  return r.stdout?.includes("-->") ? r.stdout : null;
}

function whisperCpp(video: string): string | null {
  // whisper.cpp vuole WAV 16kHz mono: estraiamo l'audio con ffmpeg.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-whisper-"));
  try {
    const wav = path.join(tmp, "audio.wav");
    const ff = spawnSync("ffmpeg", ["-y", "-i", video, "-ar", "16000", "-ac", "1", "-f", "wav", wav], { stdio: "ignore" });
    if (ff.status !== 0) throw new Error("ffmpeg audio extract fallita");
    const outBase = path.join(tmp, "out");
    const r = spawnSync(cfg.cppBinary, ["-m", cfg.cppModel, "-f", wav, "-osrt", "-of", outBase, ...(cfg.language ? ["-l", cfg.language] : [])], { stdio: "ignore" });
    if (r.status !== 0) throw new Error(`${cfg.cppBinary} exit ${r.status}`);
    const srt = `${outBase}.srt`;
    return fs.existsSync(srt) ? fs.readFileSync(srt, "utf8") : null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function openaiWhisper(video: string): string | null {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-whisper-"));
  try {
    const args = ["--model", cfg.model, "--output_format", "srt", "--output_dir", tmp, ...(cfg.language ? ["--language", cfg.language] : []), video];
    const r = spawnSync("whisper", args, { stdio: "ignore" });
    if (r.status !== 0) throw new Error(`whisper exit ${r.status}`);
    const srt = path.join(tmp, path.basename(video).replace(/\.[^.]+$/, ".srt"));
    return fs.existsSync(srt) ? fs.readFileSync(srt, "utf8") : null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
