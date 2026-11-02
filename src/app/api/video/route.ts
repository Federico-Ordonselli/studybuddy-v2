import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { rangeResponse } from "@/lib/rangeStream";

export const runtime = "nodejs";

/**
 * Stream del video di una lezione, con supporto Range (necessario per il seek).
 * Sicurezza: si serve solo un .mp4 che corrisponde alla trascrizione di un
 * documento ingerito (niente path arbitrari dal client).
 */
function isAllowed(mp4: string): boolean {
  if (!mp4.toLowerCase().endsWith(".mp4")) return false;
  const base = mp4.slice(0, -4);
  const candidates = [`${base}.en.srt`, `${base}.srt`, `${base}.en.vtt`, `${base}.vtt`];
  const row = db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.kind, "transcript"), inArray(documents.source, candidates)))
    .get();
  return !!row;
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path || !isAllowed(path)) return new Response("Forbidden", { status: 403 });
  return rangeResponse(path, "video/mp4", req.headers.get("range"));
}
