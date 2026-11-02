import { NextRequest } from "next/server";
import { LibraryError } from "@/lib/errors";
import { rangeResponse } from "@/lib/rangeStream";
import { audioFile } from "@/lib/studio";

export const runtime = "nodejs";

/** mp3 di un segmento: solo file dentro la cartella studio/ di una lezione registrata. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const id = Number(p.get("id"));
  let file: string | null = null;
  try {
    file = await audioFile(id, p.get("file") ?? "");
  } catch (e) {
    if (e instanceof LibraryError) return new Response(e.message, { status: e.status });
    throw e;
  }
  if (!file) return new Response("Not found", { status: 404 });
  return rangeResponse(file, "audio/mpeg", req.headers.get("range"));
}
