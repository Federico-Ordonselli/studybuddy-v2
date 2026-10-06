import { NextRequest, NextResponse } from "next/server";
import { dueCount, nextDueCard, reviewCard } from "@/lib/tutor/cards";

export const runtime = "nodejs";

/** Prossima carta in scadenza + conteggio coda per un dominio. */
export async function GET(req: NextRequest) {
  const domainId = Number(req.nextUrl.searchParams.get("domainId"));
  if (!domainId) return NextResponse.json({ error: "domainId richiesto" }, { status: 400 });
  return NextResponse.json({ due: dueCount(domainId), card: nextDueCard(domainId) });
}

/** Valuta la risposta a una carta e la riprogramma con SM-2. */
export async function POST(req: NextRequest) {
  const { cardId, answer } = await req.json();
  if (!cardId) return NextResponse.json({ error: "cardId richiesto" }, { status: 400 });
  try {
    const res = await reviewCard(cardId, answer ?? "");
    if (!res) return NextResponse.json({ error: "carta non trovata" }, { status: 404 });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
