import { NextRequest, NextResponse } from "next/server";
import { realInsideRoot } from "@/lib/fsRoot";
import { analyzeFolder, analyzeLibrary, analyzePath } from "@/lib/ingestPlan";
import { LIBRARY_DIR } from "@/lib/libraryDir";

export const runtime = "nodejs";

/** Analisi (sola lettura) della cartella-libreria, o di una cartella scelta col browser. */
export async function POST(req: NextRequest) {
  const { path, as, whisper } = await req.json();
  if (path == null) return NextResponse.json({ dir: LIBRARY_DIR, ...(await analyzeLibrary(LIBRARY_DIR, !!whisper)) });
  const dir = typeof path === "string" ? realInsideRoot(path) : null;
  if (!dir) return NextResponse.json({ error: "percorso fuori dalla root consentita" }, { status: 403 });
  // `as` = interruttore corso ↔ macro dell'anteprima: riguarda sempre un elemento solo.
  const { items, skipped } = as === "macro" || as === "course"
    ? { items: [await analyzeFolder(dir, { as, whisper: !!whisper })].filter((i) => i != null), skipped: [] }
    : await analyzePath(dir, { libraryDir: LIBRARY_DIR, whisper: !!whisper });
  if (!items.length) return NextResponse.json({ error: "nessun materiale importabile in questa cartella", skipped }, { status: 422 });
  return NextResponse.json({ dir, items, skipped });
}
