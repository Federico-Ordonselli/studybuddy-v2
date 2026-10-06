import { NextRequest, NextResponse } from "next/server";
import { generateSlides } from "@/lib/slides";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { domainId, topic, n } = await req.json();
  if (!domainId) return NextResponse.json({ error: "domainId richiesto" }, { status: 400 });
  try {
    return NextResponse.json(await generateSlides(domainId, topic ?? "", Math.min(n ?? 4, 6)));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
