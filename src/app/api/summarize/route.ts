import { NextRequest, NextResponse } from "next/server";
import { summarizeTopic, summarizeModule } from "@/lib/summarize";

export const runtime = "nodejs";

/** Riassunto map-reduce per argomento (`topic`) o per modulo (`module`). */
export async function POST(req: NextRequest) {
  const { domainId, topic, module } = await req.json();
  if (!domainId) return NextResponse.json({ error: "domainId richiesto" }, { status: 400 });
  try {
    const summary = module
      ? await summarizeModule(domainId, module)
      : await summarizeTopic(domainId, topic ?? "");
    return NextResponse.json({ summary });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
