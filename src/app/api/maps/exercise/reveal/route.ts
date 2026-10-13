import { NextRequest, NextResponse } from "next/server";
import { revealLevel } from "@/lib/mapExercise";
import { badBody, exerciseResponse, readBody, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Mostra soluzione: relazioni della soluzione del livello. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (!body) return badBody();
  const mapId = str(body.mapId);
  const spaceId = str(body.spaceId);
  if (!mapId || !spaceId) return NextResponse.json({ error: "mapId e spaceId richiesti" }, { status: 400 });
  return exerciseResponse(() => revealLevel(mapId, spaceId));
}
