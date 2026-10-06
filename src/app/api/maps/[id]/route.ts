import { NextRequest, NextResponse } from "next/server";
import { deleteMap, getMap, RevisionConflict, saveMap } from "@/lib/mappe/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const found = getMap((await params).id);
  if (!found) return NextResponse.json({ error: "mappa inesistente" }, { status: 404 });
  return NextResponse.json({ map: found.doc, domainId: found.domainId });
}

/** Salvataggio con controllo di revisione: 409 se la mappa è cambiata altrove. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { domainId, document, expectedRevision } = await req.json();
  if (!domainId || document?.id !== id) return NextResponse.json({ error: "domainId e documento con lo stesso id richiesti" }, { status: 400 });
  try {
    return NextResponse.json({ map: saveMap(domainId, document, Number(expectedRevision)) });
  } catch (e) {
    const status = e instanceof RevisionConflict ? 409 : 400;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  deleteMap((await params).id);
  return NextResponse.json({ ok: true });
}
