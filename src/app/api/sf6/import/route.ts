import { NextRequest } from "next/server";
import { badJson, handleAsync, readJson } from "@/lib/http";
import { LibraryError } from "@/lib/errors";
import { extractFromTranscript, extractFundamentalsFromTranscript } from "@/lib/sf6/extract";

export const runtime = "nodejs";

/** Estrazione LLM da una trascrizione: per un personaggio o, con `is_general`, fondamentali. */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return badJson();
  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  const sourceTitle = typeof body.source_title === "string" && body.source_title.trim() ? body.source_title.trim() : undefined;
  return handleAsync(async () => {
    if (transcript.trim().length < 20) throw new LibraryError("Transcript troppo corto.");
    if (body.is_general === true || body.is_general === "true") return extractFundamentalsFromTranscript({ transcript, sourceTitle });
    return extractFromTranscript({ characterSlug: typeof body.character_slug === "string" ? body.character_slug : "", transcript, sourceTitle });
  });
}
