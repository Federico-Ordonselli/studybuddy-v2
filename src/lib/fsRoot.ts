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
