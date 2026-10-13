import { NextRequest, NextResponse } from "next/server";
import { relationCardDraft } from "@/lib/mapExercise";
import { exerciseResponse, str } from "@/lib/mapExerciseHttp";

export const runtime = "nodejs";

/** Bozza di carta da una proposizione sbagliata (si salva poi con POST /api/cards). */
export async function POST(req: NextRequest) {
  const { mapId, spaceId, relationId } = await req.json();
  if (!str(mapId) || !str(spaceId) || !str(relationId)) return NextResponse.json({ error: "mapId, spaceId e relationId richiesti" }, { status: 400 });
  return exerciseResponse(() => ({ draft: relationCardDraft(mapId, spaceId, relationId) }));
}
