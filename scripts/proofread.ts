/**
 * Copia corretta (refusi, accenti, formattazione) di un vault Obsidian.
 *
 *   npm run proofread -- <vault> [--out <cartella>] [--force] [--dry-run]
 *
 * Default della copia: cartella accanto al vault, `<vault>-pulito`. Gli originali non si
 * toccano. Stessa passata del bottone in Impostazioni («Appunti Obsidian»).
 * Modello: task `proofread` in src/lib/config.ts.
 */
import path from "node:path";
import { models } from "@/lib/config";
import { PROMPT_VERSION } from "@/lib/proofread/note";
import { syncVault, readState, validatePaths, type SyncEvent } from "@/lib/proofread/vault";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const ICON: Record<SyncEvent["action"], string> = {
  corrected: "✓", unchanged: "=", copied: "→", skipped: "·", removed: "✗", error: "!",
};

function log(e: SyncEvent) {
  if (e.action === "skipped") return;
  const extra =
    e.action === "error" ? ` — ${e.error}`
    : e.action === "corrected" || e.action === "unchanged"
      ? ` (${e.corrected ?? 0} sezioni corrette${e.rejected ? `, ${e.rejected} lasciate com'erano: da rivedere` : ""})`
      : "";
  console.log(`  ${ICON[e.action]} ${e.file}${extra}`);
}

async function main() {
  const args = process.argv.slice(2);
  const vault = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
  if (!vault) {
    console.error("Uso: npm run proofread -- <vault> [--out <cartella>] [--force] [--dry-run]");
    process.exit(2);
  }
  const src = path.resolve(vault);
  const out = flag(args, "--out") ?? `${src.replace(/[/\\]+$/, "")}-pulito`;
  const { dest } = validatePaths(src, out);
  const opts = { force: args.includes("--force"), dryRun: args.includes("--dry-run"), onEvent: log };

  console.log(`proofread · ${PROMPT_VERSION} · ${models.proofread.provider}:${models.proofread.model}`);
  console.log(`  vault: ${src}\n  copia: ${dest}${opts.dryRun ? "  (dry-run: non scrive nulla)" : ""}`);

  const events = await syncVault(src, dest, opts);
  const count = (a: SyncEvent["action"]) => events.filter((e) => e.action === a).length;
  console.log(`fatto: ${count("corrected")} note corrette, ${count("unchanged")} già a posto, ${count("copied")} allegati copiati, ` +
    `${count("skipped")} invariate, ${count("removed")} tolte, ${count("error")} errori`);
  if (!opts.dryRun) {
    const review = Object.entries(readState(dest).files).filter(([, f]) => f.rejected?.length);
    if (review.length) {
      console.log("\nSezioni lasciate com'erano (la correzione cambiava il contenuto):");
      for (const [file, f] of review) for (const r of f.rejected!) console.log(`  ${file}: ${r.reason}\n    «${r.excerpt}»`);
    }
  }
  if (count("error")) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
