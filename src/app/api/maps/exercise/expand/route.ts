import { NextRequest, NextResponse } from "next/server";
import { expandExercise } from "@/lib/mapExercise";
import { badBody, exerciseResponse, readBody, str, strings } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Sottolivello di una mappa-esercizio: solo concetti, la soluzione resta sul server. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (!body) return badBody();
  const mapId = str(body.mapId), conceptId = str(body.conceptId), domainId = body.domainId;
  const concept = body.concept && typeof body.concept === "object" ? body.concept as Record<string, unknown> : null;
  const title = str(concept?.title);
  if (!mapId || typeof domainId !== "number" || !Number.isSafeInteger(domainId) || !conceptId || !title)
    return NextResponse.json({ error: "mapId, domainId, conceptId e concept.title richiesti" }, { status: 400 });
  return exerciseResponse(() => expandExercise(mapId, domainId, conceptId, {
    concept: { title, definition: typeof concept?.definition === "string" ? concept.definition : undefined },
    path: strings(body.path), existing: strings(body.existing), present: strings(body.present),
  }));
}
