import { NextRequest, NextResponse } from "next/server";
import { evaluateLevel } from "@/lib/mapExercise";
import { badBody, exerciseResponse, readBody, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Verifica le proposizioni della tela: verdetti e coppie mancanti. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (!body) return badBody();
  const mapId = str(body.mapId);
  const spaceId = str(body.spaceId);
  if (!mapId || !spaceId) return NextResponse.json({ error: "mapId e spaceId richiesti" }, { status: 400 });
  return exerciseResponse(() => evaluateLevel(mapId, spaceId));
}
