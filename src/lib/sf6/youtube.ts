import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { run, venvBin } from "@/lib/proc";

/** Sottotitoli automatici di YouTube con yt-dlp (da learning-vault@439b105). yt-dlp è nella .venv in Docker, altrimenti nel PATH. */

const YOUTUBE_URL_RE =
  /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{6,}/i;

export function isYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_RE.test(url.trim());
}

type FetchResult = {
  title: string;
  transcript: string;
  language: string;
};

/**
 * Fetch a YouTube video's transcript via yt-dlp.
 *
 * Notes from hard-won debugging:
 * - YouTube's JS challenge requires `--js-runtimes node --remote-components ejs:github`
 *   to download the solver script from github.com/yt-dlp/ejs.
 * - `--print "%(title)s"` silently breaks subtitle downloads when stdout is a pipe
 *   (i.e. when invoked from Node spawn, not from an interactive shell). We use
 *   `--write-info-json` instead and parse the .info.json file.
 * - `--no-warnings` interacts badly with other flags in pipe mode. Don't use it.
 * - yt-dlp may exit non-zero due to format warnings while subtitles were saved fine,
 *   so we decide success based on whether a .vtt file is present, not on exit code.
 */
export async function fetchYoutubeTranscript(url: string, signal?: AbortSignal): Promise<FetchResult> {
  if (!isYoutubeUrl(url)) {
    throw new Error("URL non valido. Solo link YouTube sono supportati.");
  }

  const workId = randomBytes(8).toString("hex");
  const workDir = path.join(tmpdir(), `yt-vault-${workId}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const { stdout, stderr, code } = await run(venvBin("yt-dlp"), [
      "--skip-download",
      "--write-auto-subs",
      "--write-info-json",
      "--sub-format", "vtt",
      "--sub-langs", "en",
      "--js-runtimes", "node",
      "--remote-components", "ejs:github",
      "--output", path.join(workDir, "video.%(ext)s"),
      "--socket-timeout", "30",
      url,
    ], { timeoutMs: 60_000, signal });

    const files = await fs.readdir(workDir);
    const vttFile = files.find((f) => f.endsWith(".vtt"));
    const infoFile = files.find((f) => f.endsWith(".info.json"));

    if (!vttFile) {
      throw new Error(decodeYtDlpFailure(code, stdout, stderr));
    }

    // Title from .info.json (cleaner than parsing --print stdout)
    let title = "(senza titolo)";
    if (infoFile) {
      try {
        const infoRaw = await fs.readFile(path.join(workDir, infoFile), "utf-8");
        const info = JSON.parse(infoRaw) as { title?: string };
        if (info.title) title = info.title;
      } catch {
        // ignore, fall back to default
      }
    }

    const vttPath = path.join(workDir, vttFile);
    const vttRaw = await fs.readFile(vttPath, "utf-8");
    const transcript = parseVtt(vttRaw);

    if (!transcript || transcript.length < 20) {
      throw new Error("Transcript troppo corto o vuoto.");
    }

    const langMatch = vttFile.match(/\.([\w-]+)\.vtt$/);
    const language = langMatch?.[1] ?? "unknown";

    return { title, transcript, language };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function decodeYtDlpFailure(code: number, stdout: string, stderr: string): string {
  const msg = (stderr || stdout).trim();
  if (/private video/i.test(msg)) return "Video privato.";
  if (/video unavailable/i.test(msg)) return "Video non disponibile.";
  if (/sign in to confirm/i.test(msg))
    return "YouTube richiede login (probabilmente age-restricted).";
  if (/no subtitles/i.test(msg))
    return "Questo video non ha sottotitoli en disponibili.";
  if (code === 0)
    return "Nessun transcript trovato. Il video non ha sottotitoli en.";
  return msg.slice(0, 400) || `yt-dlp exit ${code}`;
}

/**
 * Parse VTT to clean transcript text:
 * - drops WEBVTT header, NOTE blocks, cue timing lines
 * - strips inline tags <c>, <00:00:00.000>, &nbsp;, etc.
 * - dedupes consecutive identical lines (auto-subs fade)
 */
export function parseVtt(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const out: string[] = [];
  let lastLine = "";

  for (let line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("WEBVTT")) continue;
    if (line.startsWith("NOTE")) continue;
    if (line.startsWith("Kind:") || line.startsWith("Language:")) continue;
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->/.test(line)) continue;
    if (/^\d+$/.test(line.trim())) continue;

    line = line.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "");
    line = line.replace(/<\/?[cv][^>]*>/g, "");
    line = line.replace(/&nbsp;/g, " ");
    line = line.replace(/&amp;/g, "&");
    line = line.replace(/&lt;/g, "<");
    line = line.replace(/&gt;/g, ">");
    line = line.replace(/&#39;/g, "'");
    line = line.replace(/&quot;/g, '"');
    line = line.trim();

    if (!line) continue;
    if (line === lastLine) continue;
    out.push(line);
    lastLine = line;
  }

  return out.join(" ").replace(/\s+/g, " ").trim();
}
