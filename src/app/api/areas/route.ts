import { NextRequest, NextResponse } from "next/server";
import { createArea, deleteArea, listAreas, reorderAreas, updateArea } from "@/lib/areas";
import { handle } from "@/lib/http";

export const runtime = "nodejs";

/** Domini dell'hub (thin wrapper su lib/areas.ts). */
export async function GET() {
  return NextResponse.json(listAreas());
}

export async function POST(req: NextRequest) {
  const { name, tagline, symbol, module } = await req.json();
  return handle(() => ({ area: createArea({ name, tagline, symbol, module }) }));
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (body.order !== undefined) return handle(() => reorderAreas(body.order));
  const { slug, name, tagline, symbol, module } = body;
  return handle(() => ({ area: updateArea(String(slug), { name, tagline, symbol, module }) }));
}

export async function DELETE(req: NextRequest) {
  const { slug } = await req.json();
  return handle(() => deleteArea(String(slug)));
}
