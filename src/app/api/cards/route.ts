import { NextRequest, NextResponse } from "next/server";
import { generateCards } from "@/lib/tutor/cards";

export const runtime = "nodejs";

/** Genera e persiste carte di studio dal materiale di un dominio. */
export async function POST(req: NextRequest) {
  const { domainId, topic, n } = await req.json();
  if (!domainId) return NextResponse.json({ error: "domainId richiesto" }, { status: 400 });
  try {
    const res = await generateCards(domainId, topic ?? "", n ?? 5);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
