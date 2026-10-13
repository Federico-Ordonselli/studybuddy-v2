import { NextRequest, NextResponse } from "next/server";
import { createExercise, exerciseLevels } from "@/lib/mapExercise";
import { exerciseResponse, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Livelli dell'esercizio di una mappa (senza soluzione); vuoto = mappa normale. */
export async function GET(req: NextRequest) {
  const mapId = str(req.nextUrl.searchParams.get("mapId"));
  if (!mapId) return NextResponse.json({ error: "mapId richiesto" }, { status: 400 });
  return exerciseResponse(() => ({ levels: exerciseLevels(mapId) }));
}

/** Esercizio nuovo «costruisci tu» su un argomento. */
export async function POST(req: NextRequest) {
  const { domainId, topic } = await req.json();
  if (!Number.isSafeInteger(domainId) || !str(topic)) return NextResponse.json({ error: "domainId e topic richiesti" }, { status: 400 });
  return exerciseResponse(() => createExercise(domainId, topic.trim()));
}
