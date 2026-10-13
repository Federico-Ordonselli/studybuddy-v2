import fs from "node:fs";
import path from "node:path";

/**
 * Chiusura dalla finestra desktop (scripts/desktop/launch.sh). Chrome blocca
 * `window.close()` appena la finestra ha più di una voce di cronologia (ogni
 * navigazione di Next ne aggiunge una), quindi la finestra la chiude il launcher
 * sull'host: il server lascia un file accanto al DB (`./data`, montato anche nel
 * container) e il launcher, che lo controlla ogni secondo, termina il browser.
 */
export const QUIT_FILE = ".desktop-quit";

export function quitFilePath(dbPath = process.env.DB_PATH ?? "studybuddy.db"): string {
  return path.join(path.dirname(path.resolve(/* turbopackIgnore: true */ dbPath)), QUIT_FILE);
}

export function requestQuit(dbPath?: string): void {
  fs.writeFileSync(quitFilePath(dbPath), new Date().toISOString());
}
