import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chunkAudio, normalizeAudio } from "@/lib/media";

/**
 * Trascrizione via Groq Whisper (opt-in: TRANSCRIBE_BACKEND=groq + GROQ_API_KEY in .env).
 * Client di learning-vault@439b105 (groq.ts + sf6/audio.ts): endpoint OpenAI-compatibile,
 * 25 MB per richiesta ⇒ audio normalizzato e tagliato a chunk, 4 in parallelo.
 * La chiave sta solo nell'ambiente: niente tabella `settings`.
 */
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_BYTES = 24 * 1024 * 1024; // margine sotto il limite di 25 MB
const MAX_PARALLEL = 4;

export interface GroqResult { text: string; language: string | null; durationSec: number | null }

export function groqKey(env: NodeJS.ProcessEnv = process.env): string {
  const k = env.GROQ_API_KEY?.trim();
  if (!k) throw new Error("trascrizione Groq richiesta (TRANSCRIBE_BACKEND=groq) ma manca GROQ_API_KEY in .env");
  return k;
}

function mimeFor(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".mp3": return "audio/mpeg";
    case ".m4a": case ".mp4": return "audio/mp4";
    case ".wav": return "audio/wav";
    case ".flac": return "audio/flac";
    case ".webm": return "audio/webm";
    case ".ogg": case ".opus": return "audio/ogg";
    default: return "application/octet-stream";
  }
}

/** Un file già sotto i 24 MB. */
export async function transcribeFile(
  audio: string,
  opts: { apiKey: string; language?: string; url?: string; model?: string; signal?: AbortSignal },
): Promise<GroqResult> {
  const size = fs.statSync(audio).size;
  if (size > MAX_BYTES) throw new Error(`file audio troppo grande per Groq (${(size / 1024 / 1024).toFixed(1)} MB > 24 MB)`);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fs.readFileSync(audio))], { type: mimeFor(audio) }), path.basename(audio));
  form.append("model", opts.model ?? process.env.GROQ_MODEL ?? "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  if (opts.language) form.append("language", opts.language);
  const res = await fetch(opts.url ?? GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
    signal: opts.signal ? AbortSignal.any([AbortSignal.timeout(5 * 60_000), opts.signal]) : AbortSignal.timeout(5 * 60_000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = (await res.json()) as { text?: string; language?: string; duration?: number };
  return {
    text: (data.text ?? "").trim(),
    language: data.language ?? opts.language ?? null,
    durationSec: typeof data.duration === "number" ? data.duration : null,
  };
}

/** Trascrive i chunk con al più MAX_PARALLEL richieste insieme; il testo resta nell'ordine dei chunk. */
export async function transcribeChunks(paths: string[], fn: (p: string) => Promise<GroqResult>): Promise<GroqResult> {
  const results: GroqResult[] = new Array(paths.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < paths.length; i = next++) results[i] = await fn(paths[i]);
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, paths.length) }, worker));
  return {
    text: results.map((r) => r.text).join(" ").replace(/\s+/g, " ").trim(),
    language: results.find((r) => r.language)?.language ?? null,
    durationSec: results.reduce((s, r) => s + (r.durationSec ?? 0), 0),
  };
}

export async function transcribeWithGroq(file: string, opts: { language?: string; signal?: AbortSignal } = {}): Promise<GroqResult> {
  const apiKey = groqKey();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sb-groq-"));
  try {
    const chunks = await chunkAudio(await normalizeAudio(file, work, opts.signal), work, undefined, opts.signal);
    return await transcribeChunks(chunks, (p) => transcribeFile(p, { apiKey, language: opts.language, signal: opts.signal }));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
