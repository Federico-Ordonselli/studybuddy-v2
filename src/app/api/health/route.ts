import { NextRequest, NextResponse } from "next/server";
import { getHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stato di DB, Ollama, reranker, Whisper. `?warm=1` carica il reranker (verifica GPU). */
export async function GET(req: NextRequest) {
  const h = await getHealth({ warm: req.nextUrl.searchParams.get("warm") === "1" });
  return NextResponse.json(h, { status: h.db.ok ? 200 : 503 });
}
