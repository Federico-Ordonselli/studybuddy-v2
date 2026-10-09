import { NextRequest } from "next/server";
import { handle } from "@/lib/http";
import { deleteTip } from "@/lib/sf6/store";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => deleteTip(id));
}
