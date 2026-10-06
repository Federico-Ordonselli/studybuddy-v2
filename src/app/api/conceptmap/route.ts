import { NextRequest, NextResponse } from "next/server";
import { conceptMap } from "@/lib/conceptmap";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { domainId, topic } = await req.json();
  if (!domainId) return NextResponse.json({ error: "domainId richiesto" }, { status: 400 });
  try {
    return NextResponse.json(await conceptMap(domainId, topic ?? ""));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
