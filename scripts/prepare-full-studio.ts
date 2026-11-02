import path from "node:path";
import { prepareStudioLibrary } from "../src/lib/importers/fullStudio";
import { publishStudioPackage } from "../src/lib/importers/studioPackage";
import { LIBRARY_DIR } from "../src/lib/libraryDir";

/*
 * npm run prepare:full-studio                         → Parti della guida come corsi HTML (cartella nuova)
 * npm run prepare:full-studio -- package <content/partN> <cartella modulo> [--md <fonte.md>] [--studio <Full_studio>]
 *                                                     → pacchetto lezione audio in <modulo>/studio/
 */
const args = process.argv.slice(2);
try {
  if (args[0] === "package") {
    const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    const [partDir, moduleDir] = args.slice(1).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
    if (!partDir || !moduleDir) throw new Error("Uso: prepare:full-studio -- package <content/partN> <cartella modulo> [--md <fonte.md>] [--studio <Full_studio>]");
    const md = flag("--md");
    const r = await publishStudioPackage({
      partDir: path.resolve(partDir), moduleDir: path.resolve(moduleDir),
      studioRoot: path.resolve(flag("--studio") ?? "Full_studio"), markdown: md ? path.resolve(md) : undefined,
    });
    console.log(`Pacchetto in ${r.dest}: ${r.audio}/${r.segments} audio${r.missingAudio ? ` (${r.missingAudio} mancanti)` : ""}, ${r.cards} carte, ${r.quiz} domande.`);
    console.log("Poi Corsi → Aggiungi: l'analisi vede il corso come aggiornato e l'import registra la lezione.");
  } else {
    const [source = "Full_studio", destination = path.join(LIBRARY_DIR, "Full Studio")] = args;
    const result = await prepareStudioLibrary(path.resolve(source), path.resolve(destination));
    console.log(`Preparati ${result.parts} corsi, ${result.lessons} lezioni in ${destination}`);
    console.log("Apri /corsi/add, analizza la libreria e importa Full Studio come macro con i suoi corsi.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Conversione non riuscita");
  process.exitCode = 1;
}
