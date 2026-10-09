import path from "node:path";
import { LIBRARY_DIR } from "@/lib/libraryDir";
import AddWizard from "@/components/add/AddWizard";

export const dynamic = "force-dynamic";

export default function AddPage() {
  return <AddWizard libraryDirName={path.basename(LIBRARY_DIR)} />;
}
