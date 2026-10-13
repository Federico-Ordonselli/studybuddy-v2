import { NextResponse } from "next/server";
import { requestQuit } from "@/lib/desktop";

export const runtime = "nodejs";

/** Chiede al launcher desktop di chiudere la finestra (vedi lib/desktop.ts). */
export async function POST() {
  requestQuit();
  return NextResponse.json({ ok: true });
}
