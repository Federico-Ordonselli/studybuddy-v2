import { NextRequest, NextResponse } from "next/server";
import { loadSession } from "@/lib/tutor/sessions";

export const runtime = "nodejs";

/** Ripresa di una sessione: restituisce mode/domainId e la cronologia salvata. */
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id richiesto" }, { status: 400 });
  const session = loadSession(id);
  if (!session) return NextResponse.json({ error: "sessione non trovata" }, { status: 404 });
  return NextResponse.json({
    id: session.id,
    mode: session.mode,
    domainId: session.domainId,
    history: session.state?.history ?? [],
  });
}
