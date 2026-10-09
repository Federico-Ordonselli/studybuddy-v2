import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { LibraryError } from "@/lib/errors";

/**
 * File multimediali del modulo SF6 (da learning-vault@439b105, route vods/upload):
 * - VOD: file grandi copiati a mano in una cartella (Docker: /app/data/vods), trascritti sul posto;
 * - upload: file caricati dal browser in una cartella temporanea, cancellati dopo la trascrizione.
 * Dal client arriva solo un NOME, ridotto a basename: niente percorsi fuori dalle due cartelle.
 */
export const MEDIA_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".flac", ".ogg", ".opus", ".mp4", ".mkv", ".webm", ".mov", ".avi"]);
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export function sf6Paths(env: NodeJS.ProcessEnv = process.env): { vods: string; uploads: string } {
  return {
    vods: env.STUDYBUDDY_VODS_DIR || path.resolve(/* turbopackIgnore: true */ process.cwd(), "data", "vods"),
    uploads: env.STUDYBUDDY_UPLOAD_DIR || path.join(os.tmpdir(), "studybuddy-uploads"),
  };
}

export interface VodFile { filename: string; size_mb: number; modified_at: string }

const mb = (bytes: number) => +(bytes / 1024 / 1024).toFixed(1);
const allowedExt = (name: string) => MEDIA_EXTENSIONS.has(path.extname(name).toLowerCase());

export async function listVods(dir = sf6Paths().vods): Promise<VodFile[]> {
  await fs.promises.mkdir(dir, { recursive: true });
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.filter((e) => e.isFile() && allowedExt(e.name)).map(async (e) => {
    const st = await fs.promises.stat(path.join(dir, e.name));
    return { filename: e.name, size_mb: mb(st.size), modified_at: st.mtime.toISOString() };
  }));
  return files.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
}

/** Percorso di un file di `dir` dal nome mandato dal client. */
export function resolveMedia(dir: string, name: unknown, notFound: string): string {
  if (typeof name !== "string" || !name.trim()) throw new LibraryError("nome del file mancante");
  const safe = path.basename(name.trim());
  if (!allowedExt(safe)) throw new LibraryError(`estensione non supportata: ${safe}`);
  const full = path.join(dir, safe);
  if (!fs.statSync(full, { throwIfNoEntry: false })?.isFile()) throw new LibraryError(notFound, 404);
  return full;
}

export async function saveUpload(file: File, dir = sf6Paths().uploads, max = MAX_UPLOAD_BYTES): Promise<{ upload_id: string; filename: string; size_mb: number }> {
  if (file.size > max) throw new LibraryError(`File troppo grande (${mb(file.size)} MB > ${mb(max)} MB).`, 413);
  const ext = path.extname(file.name).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(ext)) throw new LibraryError(`Estensione non supportata (${ext || "nessuna"}). Audio o video: mp3, m4a, mp4, mkv, webm, …`);
  await fs.promises.mkdir(dir, { recursive: true });
  const id = `${randomBytes(8).toString("hex")}${ext}`;
  const full = path.join(dir, id);
  try {
    await pipeline(Readable.fromWeb(file.stream() as NodeWebReadableStream<Uint8Array>), fs.createWriteStream(full));
  } catch (e) {
    await fs.promises.rm(full, { force: true });
    throw new Error(`salvataggio dell'upload fallito: ${e instanceof Error ? e.message : e}`);
  }
  return { upload_id: id, filename: file.name, size_mb: mb(file.size) };
}
