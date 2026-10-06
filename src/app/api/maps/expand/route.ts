import { NextRequest, NextResponse } from "next/server";
import { expandConcept } from "@/lib/conceptmap";

export const runtime = "nodejs";

/** Sotto-concetti di una bolla dal materiale: proposta da applicare nell'editor. */
export async function POST(req: NextRequest) {
  const { domainId, concept, path, existing, present } = await req.json();
  if (!domainId || !concept?.title) return NextResponse.json({ error: "domainId e concept.title richiesti" }, { status: 400 });
  try {
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
    return NextResponse.json(await expandConcept(domainId, concept, strings(path), strings(existing), strings(present)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
