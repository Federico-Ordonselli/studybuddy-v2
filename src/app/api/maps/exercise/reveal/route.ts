import { NextRequest, NextResponse } from "next/server";
import { revealLevel } from "@/lib/mapExercise";
import { exerciseResponse, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Mostra soluzione: relazioni della soluzione del livello. */
export async function POST(req: NextRequest) {
  const { mapId, spaceId } = await req.json();
  if (!str(mapId) || !str(spaceId)) return NextResponse.json({ error: "mapId e spaceId richiesti" }, { status: 400 });
  return exerciseResponse(() => revealLevel(mapId, spaceId));
}
