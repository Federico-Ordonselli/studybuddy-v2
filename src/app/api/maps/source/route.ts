import { NextRequest, NextResponse } from "next/server";
import { chunkCitation } from "@/lib/conceptmap";

export const runtime = "nodejs";

/** Fonte di una bolla: il chunk citato, con il link al video al minuto se è una trascrizione. */
export async function GET(req: NextRequest) {
  const chunkId = Number(req.nextUrl.searchParams.get("chunkId"));
  const cite = chunkId ? chunkCitation(chunkId) : null;
  if (!cite) return NextResponse.json({ error: "fonte inesistente" }, { status: 404 });
  return NextResponse.json({ citation: cite });
}
