import { NextRequest, NextResponse } from "next/server";
import { expandExercise } from "@/lib/mapExercise";
import { exerciseResponse, str, strings } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Sottolivello di una mappa-esercizio: solo concetti, la soluzione resta sul server. */
export async function POST(req: NextRequest) {
  const { mapId, domainId, conceptId, concept, path, existing, present } = await req.json();
  if (!str(mapId) || !Number.isSafeInteger(domainId) || !str(conceptId) || !str(concept?.title))
    return NextResponse.json({ error: "mapId, domainId, conceptId e concept.title richiesti" }, { status: 400 });
  return exerciseResponse(() => expandExercise(mapId, domainId, conceptId, {
    concept: { title: concept.title, definition: typeof concept.definition === "string" ? concept.definition : undefined },
    path: strings(path), existing: strings(existing), present: strings(present),
  }));
}
