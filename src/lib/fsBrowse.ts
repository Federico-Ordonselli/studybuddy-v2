import fs from "node:fs/promises";
import path from "node:path";
import { FS_ROOT, realInsideRoot } from "@/lib/fsRoot";

export interface DirListing {
  path: string;
  parent: string | null;
  root: string;
  dirs: { name: string; path: string }[];
}

/**
 * Sottocartelle (non nascoste) di `p` per il browser di /add, o null se `p` è fuori sandbox.
 * I link a cartelle si seguono solo se il percorso reale sta nella sandbox (come l'analisi,
 * che rifiuterebbe gli altri): `readdir` li dà come link, non come cartelle, e prima sparivano.
 */
export async function listDirs(p: string): Promise<DirListing | null> {
  const dir = realInsideRoot(p);
  if (!dir) return null;
  const dirs: DirListing["dirs"] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      const st = await fs.stat(full).catch(() => null);
      if (!st?.isDirectory() || !realInsideRoot(full)) continue;
    } else if (!e.isDirectory()) continue;
    dirs.push({ name: e.name, path: full });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return { path: dir, parent: dir === FS_ROOT ? null : path.dirname(dir), root: FS_ROOT, dirs };
}
