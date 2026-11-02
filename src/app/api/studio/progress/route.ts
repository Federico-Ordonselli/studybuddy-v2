import { badJson, handleAsync, readJson } from "@/lib/http";
import { saveState } from "@/lib/studio";
import { positiveId } from "@/lib/validation";

export const runtime = "nodejs";

/** `{ id, state }`: salva il punto di ascolto e sblocca le carte delle sezioni appena completate. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return badJson();
  return handleAsync(() => saveState(positiveId(body.id, "id", true)!, body.state));
}
