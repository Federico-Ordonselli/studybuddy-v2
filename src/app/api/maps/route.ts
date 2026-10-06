import { NextRequest, NextResponse } from "next/server";
import { generateMap } from "@/lib/conceptmap";
import { listMaps, saveMap } from "@/lib/mappe/store";

export const runtime = "nodejs";

/** Elenco delle mappe di un dominio. */
export async function GET(req: NextRequest) {
  const domainId = Number(req.nextUrl.searchParams.get("domainId"));
  if (!domainId) return NextResponse.json({ error: "domainId richiesto" }, { status: 400 });
  return NextResponse.json({ maps: listMaps(domainId) });
}

/** Genera (dal materiale) e salva una mappa nuova su un argomento. */
export async function POST(req: NextRequest) {
  const { domainId, topic } = await req.json();
  if (!domainId || !topic?.trim()) return NextResponse.json({ error: "domainId e topic richiesti" }, { status: 400 });
  try {
    const doc = await generateMap(domainId, topic.trim());
    return NextResponse.json({ map: saveMap(domainId, doc, 0) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
