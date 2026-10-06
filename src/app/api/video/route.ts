import { NextRequest } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

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

function streamResponse(path: string, status: number, headers: Record<string, string>, range?: { start: number; end: number }) {
  const stream = range ? fs.createReadStream(path, range) : fs.createReadStream(path);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status, headers });
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path || !isAllowed(path)) return new Response("Forbidden", { status: 403 });

  let size: number;
  try {
    size = fs.statSync(path).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const base = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" };
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m?.[1] ? parseInt(m[1], 10) : 0;
    let end = m?.[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end || start >= size) {
      return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return streamResponse(path, 206, {
      ...base,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    }, { start, end });
  }

  return streamResponse(path, 200, { ...base, "Content-Length": String(size) });
}
