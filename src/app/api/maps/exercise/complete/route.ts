import { NextRequest, NextResponse } from "next/server";
import { completeLevel } from "@/lib/mapExercise";
import { exerciseResponse, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Completa la mappa: soluzione intera del livello. */
export async function POST(req: NextRequest) {
  const { mapId, spaceId } = await req.json();
  if (!str(mapId) || !str(spaceId)) return NextResponse.json({ error: "mapId e spaceId richiesti" }, { status: 400 });
  return exerciseResponse(() => ({ solution: completeLevel(mapId, spaceId) }));
}
