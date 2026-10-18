import { NextResponse } from "next/server";
import { currentDownload, startDownload } from "@/lib/courseraDownload";
import { badJson, handleAsync, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ job: currentDownload() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return badJson();
  return handleAsync(async () => ({ job: startDownload(body) }));
}
