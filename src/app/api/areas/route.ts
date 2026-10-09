import { NextRequest, NextResponse } from "next/server";
import { createArea, deleteArea, listAreas, reorderAreas, updateArea } from "@/lib/areas";
import { LibraryError } from "@/lib/errors";

export const runtime = "nodejs";

/** Domini dell'hub (thin wrapper su lib/areas.ts). */
function handle(fn: () => unknown) {
  try {
    return NextResponse.json(fn() ?? { ok: true });
  } catch (e) {
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

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
