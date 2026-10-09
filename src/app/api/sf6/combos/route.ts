import { NextRequest } from "next/server";
import { badJson, handle, readJson } from "@/lib/http";
import { createCombo, listCombos } from "@/lib/sf6/store";

export const runtime = "nodejs";

/** Combo SF6 (thin wrapper su lib/sf6/store.ts; API di learning-vault@439b105). */
export async function GET(req: NextRequest) {
  return handle(() => listCombos(req.nextUrl.searchParams.get("character") ?? undefined));
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return badJson();
  return handle(() => createCombo(body));
}
