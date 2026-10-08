import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Sandbox del filesystem per le route che accettano percorsi dal client
 * (browser cartelle, ingestione cartelle): tutto deve stare sotto `FS_ROOT`
 * (la home, override con STUDYBUDDY_FS_ROOT).
 */
export const FS_ROOT = path.resolve(process.env.STUDYBUDDY_FS_ROOT ?? os.homedir());

/** Percorso assoluto normalizzato se dentro la sandbox, altrimenti null. */
export function insideRoot(p: string): string | null {
  const resolved = path.resolve(p || FS_ROOT);
  if (resolved !== FS_ROOT && !resolved.startsWith(FS_ROOT + path.sep)) return null;
  return resolved;
}

/**
 * Come `insideRoot`, ma sul percorso reale (link simbolici risolti): un link dentro la
 * sandbox che punta fuori non passa. Un percorso che non esiste resta al controllo lessicale.
 */
export function realInsideRoot(p: string): string | null {
  const lexical = insideRoot(p);
  if (!lexical) return null;
  let real: string;
  try { real = fs.realpathSync(/* turbopackIgnore: true */ lexical); } catch { return lexical; }
  const root = realRoot();
  return real === root || real.startsWith(root + path.sep) ? lexical : null;
}

let cachedRoot: string | undefined;
function realRoot(): string {
  // la home stessa può essere un link (es. /home → /var/home)
  if (!cachedRoot) { try { cachedRoot = fs.realpathSync(/* turbopackIgnore: true */ FS_ROOT); } catch { cachedRoot = FS_ROOT; } }
  return cachedRoot;
}
