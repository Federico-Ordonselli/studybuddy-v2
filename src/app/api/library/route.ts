import { NextRequest, NextResponse } from "next/server";
import { LibraryError, createMacro, deleteMacro, getLibrary, updateDomain } from "@/lib/library";

export const runtime = "nodejs";

/** Organizzazione manuale della Libreria (thin wrapper su lib/library.ts). */
function handle(fn: () => unknown) {
  try {
    return NextResponse.json(fn() ?? { ok: true });
  } catch (e) {
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function GET() {
  return NextResponse.json(getLibrary());
}

export async function PATCH(req: NextRequest) {
  const { id, name, areas, parentId } = await req.json();
  return handle(() => updateDomain(Number(id), { name, areas, parentId }));
}

export async function POST(req: NextRequest) {
  const { name, areas, courseIds } = await req.json();
  return handle(() => ({ id: createMacro(name, areas ?? [], courseIds ?? []) }));
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  return handle(() => deleteMacro(Number(id)));
}
