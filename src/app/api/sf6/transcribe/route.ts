import fs from "node:fs";
import { NextRequest } from "next/server";
import { badJson, handleAsync, readJson } from "@/lib/http";
import { resolveMedia, sf6Paths } from "@/lib/sf6/files";
import { exclusive, transcribeSource } from "@/lib/sf6/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trascritto da { url } (YouTube: prima i sottotitoli), { vod_filename } o { upload_id }
 * (cancellato dopo l'uso). Opzioni: force_whisper, language. Una trascrizione alla volta (409).
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return badJson();
  const language = typeof body.language === "string" && body.language.trim() ? body.language.trim() : undefined;
  const forceWhisper = body.force_whisper === true || body.force_whisper === "true";
  return handleAsync(async () => {
    const paths = sf6Paths();
    if (typeof body.url === "string" && body.url.trim()) {
      const url = body.url;
      return exclusive(() => transcribeSource({ url, language, forceWhisper }));
    }
    if (body.vod_filename != null) {
      const file = resolveMedia(paths.vods, body.vod_filename, "File non trovato nella cartella dei VOD.");
      return exclusive(() => transcribeSource({ file, language }));
    }
    if (body.upload_id != null) {
      const file = resolveMedia(paths.uploads, body.upload_id, "Upload non trovato (potrebbe essere scaduto).");
      return exclusive(async () => {
        try {
          return await transcribeSource({ file, language });
        } finally {
          fs.rmSync(file, { force: true });
        }
      });
    }
    return transcribeSource({});
  });
}
