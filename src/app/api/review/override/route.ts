import { NextRequest } from "next/server";
import { overrideLastReview } from "@/lib/tutor/cards";
import { handle, readJson, badJson } from "@/lib/http";
import { positiveId } from "@/lib/validation";
import type { Grade as Rating } from "@/lib/tutor/scheduler";
export const runtime = "nodejs";
/** Correzione manuale del voto dell'ultima review di una carta (rating 1–4, validato in `overrideLastReview`). */
export async function POST(req: NextRequest) {
  const body = await readJson(req); if (!body) return badJson();
  return handle(() => {
    const cardId = positiveId(body.cardId, "cardId", true)!, domainId = positiveId(body.domainId, "domainId");
    return overrideLastReview(cardId, body.rating as Rating, domainId);
  });
}
