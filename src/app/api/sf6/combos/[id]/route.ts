import { NextRequest } from "next/server";
import { badJson, handle, readJson } from "@/lib/http";
import { deleteCombo, updateCombo } from "@/lib/sf6/store";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await readJson(req);
  if (!body) return badJson();
  return handle(() => updateCombo(id, body));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return handle(() => deleteCombo(id));
}
