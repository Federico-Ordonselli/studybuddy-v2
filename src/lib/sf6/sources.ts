import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LibraryError } from "@/lib/errors";
import { runOk, venvBin } from "@/lib/proc";
import { transcribeMedia, type Transcript } from "@/lib/transcribe";
import { fetchYoutubeTranscript, isYoutubeUrl } from "./youtube";

/**
 * Da una sorgente (URL o file) al trascritto (da learning-vault@439b105, route transcribe +
 * sf6/audio.ts): per YouTube prima i sottotitoli; altrimenti yt-dlp scarica l'audio e
 * `transcribeMedia` lo trascrive (locale o Groq). Una trascrizione alla volta (GPU).
 */
export interface SourceTranscript { transcript: string; title: string; language: string; source: "subs" | "whisper-local" | "whisper-groq" }

/** yt-dlp legge come opzione un argomento che inizia con "-": si accettano solo URL http(s). */
export function assertHttpUrl(url: string): string {
  const u = url.trim();
  let ok = false;
  try { ok = ["http:", "https:"].includes(new URL(u).protocol); } catch { /* non è un URL */ }
  if (!ok) throw new LibraryError("URL non valido: serve un link http(s)");
  return u;
}

export async function downloadAudio(url: string, workDir: string, signal?: AbortSignal): Promise<{ audioPath: string; title: string }> {
  await runOk(venvBin("yt-dlp"), [
    "--extract-audio", "--audio-format", "mp3", "--audio-quality", "32K",
    "--postprocessor-args", "ffmpeg:-ac 1 -ar 16000",
    "--write-info-json", "--js-runtimes", "node", "--remote-components", "ejs:github",
    "--output", path.join(workDir, "audio.%(ext)s"), "--socket-timeout", "30", "--no-playlist",
    assertHttpUrl(url),
  ], { timeoutMs: 30 * 60_000, signal });
  const mp3 = fs.readdirSync(workDir).find((f) => f.endsWith(".mp3"));
  if (!mp3) throw new Error("yt-dlp non ha prodotto un file mp3: il video potrebbe essere privato, georestricted o richiedere login");
  let title = "(senza titolo)";
  try {
    title = (JSON.parse(fs.readFileSync(path.join(workDir, "audio.info.json"), "utf8")) as { title?: string }).title || title;
  } catch { /* titolo di ripiego */ }
  return { audioPath: path.join(workDir, mp3), title };
}

function fromTranscript(t: Transcript, title: string): SourceTranscript {
  if (!t.text) throw new Error("trascrizione vuota: nel file non c'è parlato riconoscibile");
  return { transcript: t.text, title, language: t.language ?? "auto", source: t.backend === "groq" ? "whisper-groq" : "whisper-local" };
}

export async function transcribeSource(input: { url?: string; file?: string; language?: string; forceWhisper?: boolean }, signal?: AbortSignal): Promise<SourceTranscript> {
  if (input.url) {
    const url = assertHttpUrl(input.url);
    if (!input.forceWhisper && isYoutubeUrl(url)) {
      try {
        const s = await fetchYoutubeTranscript(url, signal);
        return { transcript: s.transcript, title: s.title, language: s.language, source: "subs" };
      } catch (e) {
        console.log(`[sf6] sottotitoli non disponibili, si passa a Whisper: ${e instanceof Error ? e.message : e}`);
      }
    }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sf6-"));
    try {
      const dl = await downloadAudio(url, work, signal);
      return fromTranscript(await transcribeMedia(dl.audioPath, { language: input.language, signal }), dl.title);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  if (input.file) {
    return fromTranscript(await transcribeMedia(input.file, { language: input.language, signal }), path.basename(input.file, path.extname(input.file)));
  }
  throw new LibraryError("Specifica url, vod_filename o upload_id.");
}

let busySince: number | null = null;

/** Esegue `fn` se non c'è già una trascrizione in corso (stesso processo Next), altrimenti 409. */
export async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (busySince !== null) {
    const elapsed = formatTranscriptionAge(Date.now() - busySince);
    throw new LibraryError(`c'è già una trascrizione in corso (da ${elapsed}): riprova quando finisce`, 409);
  }
  busySince = Date.now();
  try {
    return await fn();
  } finally {
    busySince = null;
  }
}

export function formatTranscriptionAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} s` : ""}`;
}
