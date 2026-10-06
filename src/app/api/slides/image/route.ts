import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/providers/image";

export const runtime = "nodejs";

/** Genera (lazy) l'immagine di una singola slide dal suo prompt. */
export async function POST(req: NextRequest) {
  const { prompt } = await req.json();
  if (!prompt) return NextResponse.json({ error: "prompt richiesto" }, { status: 400 });
  try {
    return NextResponse.json({ image: await generateImage(prompt) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
