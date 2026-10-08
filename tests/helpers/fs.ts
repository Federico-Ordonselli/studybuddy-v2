import fs from "node:fs";
import path from "node:path";

/** Crea file (e cartelle intermedie) sotto `root`: { "a/b/c.srt": "contenuto" }. */
export function makeTree(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
