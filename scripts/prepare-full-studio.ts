import path from "node:path";
import { prepareStudioLibrary } from "../src/lib/importers/fullStudio";
import { LIBRARY_DIR } from "../src/lib/libraryDir";

const [source = "Full_studio", destination = path.join(LIBRARY_DIR, "Full Studio")] = process.argv.slice(2);
try {
  const result = await prepareStudioLibrary(path.resolve(source), path.resolve(destination));
  console.log(`Preparati ${result.parts} corsi, ${result.lessons} lezioni in ${destination}`);
  console.log("Apri /corsi/add, analizza la libreria e importa Full Studio come macro con i suoi corsi.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Conversione non riuscita");
  process.exitCode = 1;
}
