import fs from "node:fs";
import path from "node:path";
import { models } from "@/lib/config";
import { proofreadNote, PROMPT_VERSION } from "@/lib/proofread/note";
import { parseProofreadCases, proofreadMetrics, scoreCase, type ProofreadOutcome } from "@/lib/evals/proofread";

/** Appunti sintetici committabili con refusi noti: nessun appunto personale né DB. */
export async function runProofread(args: string[]) {
  let cases = parseProofreadCases(fs.readFileSync(path.resolve("evals/fixtures/proofread.json"), "utf8"));
  const limit = Number(args[args.indexOf("--limit") + 1]);
  if (args.includes("--limit") && limit > 0) cases = cases.slice(0, limit);
  const started = new Date().toISOString();
  console.log(`proofread · ${cases.length} appunti sintetici · ${PROMPT_VERSION} · ${models.proofread.model}`);
  const rows: (ProofreadOutcome | { id: string; error: string })[] = [];
  for (const c of cases) {
    const t0 = Date.now();
    try {
      const r = await proofreadNote(c.input);
      const row = scoreCase(c, r.text, r.sections.filter((s) => s.status === "rejected").length, Date.now() - t0);
      rows.push(row);
      const flags = [
        row.deleted && `${row.deleted} parole tolte`,
        row.brokenProtected && `${row.brokenProtected} codice/link alterati`,
        row.brokenKeep && `${row.brokenKeep} frasi da non toccare alterate`,
        row.rejected && `${row.rejected} sezioni scartate`,
      ].filter(Boolean);
      console.log(`  ${row.residual === 0 ? "✓" : "·"} ${c.id}: distanza ${row.baseline} → ${row.residual}${flags.length ? ` · ${flags.join(", ")}` : ""} · ${row.ms} ms`);
    } catch (e) {
      rows.push({ id: c.id, error: String(e) });
      console.log(`  ! ${c.id}: ${String(e)}`);
    }
  }
  const ok = rows.filter((r): r is ProofreadOutcome => !("error" in r));
  const metrics = { ...proofreadMetrics(ok), failures: rows.length - ok.length };
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`recuperato ${pct(metrics.recovered)} della distanza · ${metrics.exact}/${metrics.cases} identici al riferimento · ` +
    `${metrics.worse} peggiorati · parole tolte ${metrics.deletedWords} · codice/link alterati ${metrics.brokenProtected} · ` +
    `frasi da non toccare alterate ${metrics.brokenKeep} · sezioni scartate ${metrics.rejectedSections} · ${metrics.avgMs} ms/caso`);
  const out = path.resolve(`evals/results/proofread-${started.replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ promptVersion: PROMPT_VERSION, model: models.proofread.model, runAt: started, metrics, rows }, null, 2));
  console.log(`risultati: ${path.relative(process.cwd(), out)}`);
}
