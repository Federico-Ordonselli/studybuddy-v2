import { NextRequest } from "next/server";
import { badJson, handle, readJson } from "@/lib/http";
import { createTips, listTips } from "@/lib/sf6/store";

export const runtime = "nodejs";

/** Consigli SF6 per personaggio o fondamentali (`general=1`). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const general = q.get("general") === "1" || q.get("general") === "true";
  return handle(() => listTips({ general, character: q.get("character") }));
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return badJson();
  return handle(() => ({ inserted: createTips(body) }));
}
