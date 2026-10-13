import { NextRequest, NextResponse } from "next/server";
import { relationCardDraft } from "@/lib/mapExercise";
import { badBody, exerciseResponse, readBody, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Bozza di carta da una proposizione sbagliata (si salva poi con POST /api/cards). */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (!body) return badBody();
  const mapId = str(body.mapId);
  const spaceId = str(body.spaceId);
  const relationId = str(body.relationId);
  if (!mapId || !spaceId || !relationId) return NextResponse.json({ error: "mapId, spaceId e relationId richiesti" }, { status: 400 });
  return exerciseResponse(() => ({ draft: relationCardDraft(mapId, spaceId, relationId) }));
}
