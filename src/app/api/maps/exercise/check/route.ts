import { NextRequest, NextResponse } from "next/server";
import { evaluateLevel } from "@/lib/mapExercise";
import { exerciseResponse, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Verifica le proposizioni della tela: verdetti e coppie mancanti. */
export async function POST(req: NextRequest) {
  const { mapId, spaceId } = await req.json();
  if (!str(mapId) || !str(spaceId)) return NextResponse.json({ error: "mapId e spaceId richiesti" }, { status: 400 });
  return exerciseResponse(() => evaluateLevel(mapId, spaceId));
}
