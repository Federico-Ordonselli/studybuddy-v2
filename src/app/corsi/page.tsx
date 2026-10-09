import path from "node:path";
import { getLibrary } from "@/lib/library";
import { newInLibrary } from "@/lib/ingestPlan";
import { LIBRARY_DIR } from "@/lib/libraryDir";
import LibraryView from "@/components/library/LibraryView";

export const dynamic = "force-dynamic";

/** Corsi (la Libreria): legge il DB lato server, azioni via /api/library. */
export default async function CorsiPage() {
  const library = getLibrary();
  const { fresh, skipped } = await newInLibrary(LIBRARY_DIR);
  return <LibraryView library={library} fresh={fresh} skipped={skipped.length} libraryDirName={path.basename(LIBRARY_DIR)} />;
}
