import path from "node:path";
import { getLibrary } from "@/lib/library";
import { newInLibrary } from "@/lib/ingestPlan";
import { LIBRARY_DIR } from "@/lib/libraryDir";
import LibraryView from "@/components/library/LibraryView";

export const dynamic = "force-dynamic";

/** Libreria: legge il DB lato server (niente flash di lista vuota), azioni via /api/library. */
export default async function LibraryPage() {
  const library = getLibrary();
  const fresh = await newInLibrary(LIBRARY_DIR);
  return <LibraryView library={library} fresh={fresh} libraryDirName={path.basename(LIBRARY_DIR)} />;
}
