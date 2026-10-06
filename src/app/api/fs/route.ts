import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { FS_ROOT as ROOT, insideRoot as safe } from "@/lib/fsRoot";

export const runtime = "nodejs";

// Browser cartelle, in sandbox dentro la home (vedi lib/fsRoot).

/** Elenca le sottocartelle di `path` (per la selezione del materiale). */
export async function GET(req: NextRequest) {
  const dir = safe(req.nextUrl.searchParams.get("path") ?? ROOT);
  if (!dir) return NextResponse.json({ error: "percorso fuori dalla root consentita" }, { status: 403 });
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ path: dir, parent: dir === ROOT ? null : path.dirname(dir), root: ROOT, dirs });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
