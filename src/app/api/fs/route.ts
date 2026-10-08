import { NextRequest, NextResponse } from "next/server";
import { FS_ROOT } from "@/lib/fsRoot";
import { listDirs } from "@/lib/fsBrowse";

export const runtime = "nodejs";

// Browser cartelle, in sandbox dentro la home (vedi lib/fsRoot e lib/fsBrowse).

/** Elenca le sottocartelle di `path` (per la selezione del materiale). */
export async function GET(req: NextRequest) {
  try {
    const listing = await listDirs(req.nextUrl.searchParams.get("path") ?? FS_ROOT);
    if (!listing) return NextResponse.json({ error: "percorso fuori dalla root consentita" }, { status: 403 });
    return NextResponse.json(listing);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
