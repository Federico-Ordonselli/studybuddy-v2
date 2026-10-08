import { NextRequest, NextResponse } from "next/server";
import { insideRoot } from "@/lib/fsRoot";
import { analyzeFolder, analyzeLibrary } from "@/lib/ingestPlan";
import { LIBRARY_DIR } from "@/lib/libraryDir";

export const runtime = "nodejs";

/** Analisi (sola lettura) della cartella-libreria, o di una cartella scelta col browser. */
export async function POST(req: NextRequest) {
  const { path, as, whisper } = await req.json();
  if (path == null) return NextResponse.json({ dir: LIBRARY_DIR, items: await analyzeLibrary(LIBRARY_DIR, !!whisper) });
  const dir = typeof path === "string" ? insideRoot(path) : null;
  if (!dir) return NextResponse.json({ error: "percorso fuori dalla root consentita" }, { status: 403 });
  const item = await analyzeFolder(dir, { as: as === "macro" || as === "course" ? as : undefined, whisper: !!whisper });
  if (!item) return NextResponse.json({ error: "nessun materiale importabile in questa cartella" }, { status: 422 });
  return NextResponse.json({ dir, items: [item] });
}
