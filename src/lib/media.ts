import fs from "node:fs";
import path from "node:path";
import { runOk } from "@/lib/proc";

/**
 * Audio con ffmpeg (da learning-vault@439b105, sf6/audio.ts): mp3 mono 16 kHz a 32 kbps
 * (~14 MB/ora, basta per la voce) e segmenti da 10 minuti per stare sotto i 25 MB di Groq.
 */
const AUDIO_BITRATE_KBPS = 32;
const CHUNK_SECONDS = 600;

export async function normalizeAudio(input: string, workDir: string, signal?: AbortSignal): Promise<string> {
  const out = path.join(workDir, "audio.mp3");
  await runOk("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", `${AUDIO_BITRATE_KBPS}k`, out],
    { timeoutMs: 15 * 60_000, signal });
  return out;
}

export async function chunkAudio(audio: string, workDir: string, seconds = CHUNK_SECONDS, signal?: AbortSignal): Promise<string[]> {
  const dir = path.join(workDir, "chunks");
  fs.mkdirSync(dir, { recursive: true });
  await runOk("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", audio, "-f", "segment", "-segment_time", String(seconds), "-c", "copy",
    path.join(dir, "chunk-%03d.mp3")], { timeoutMs: 5 * 60_000, signal });
  const chunks = fs.readdirSync(dir).filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3")).sort().map((f) => path.join(dir, f));
  if (!chunks.length) throw new Error("ffmpeg non ha prodotto chunk audio");
  return chunks;
}
