import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";

// Browser cartelle, in sandbox dentro la home (override con STUDYBUDDY_FS_ROOT).
const ROOT = path.resolve(process.env.STUDYBUDDY_FS_ROOT ?? os.homedir());

function safe(p: string): string | null {
  const resolved = path.resolve(p || ROOT);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

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
