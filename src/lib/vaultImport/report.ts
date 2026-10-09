import type { ImportPlan, ImportResult } from "./plan";

/** Resoconto in italiano per il terminale (dry-run e apply). Mai valori delle impostazioni. */
export function formatReport(plan: ImportPlan, result?: ImportResult): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const L: string[] = ["Domini del vault:"];
  if (!plan.steps.length) L.push("  (nessuno)");
  for (const s of plan.steps) {
    const what =
      s.action === "skip" ? `escluso (--skip)${s.notes ? `: ${n(s.notes, "nota va", "note vanno")} nell'inbox` : ""}`
      : s.action === "hook" ? `agganciato a «${s.name}» (${s.target}, stesso ${s.by === "slug" ? "slug" : "nome"})`
      : `nuovo dominio «${s.name}» (${s.target})`;
    const mod = s.module ? ` · modulo ${s.module}` : "";
    const notes = s.action === "skip" ? "" : ` · ${n(s.notes, "nota", "note")}`;
    L.push(`  ${s.vault.slug.padEnd(12)} ${s.vault.symbol} ${s.vault.name} → ${what}${mod}${notes}`);
  }

  const inbox = plan.notes.filter((x) => !x.domain).length;
  const parts = [`${plan.inbox.fromVault} già senza dominio`, `${plan.inbox.skipped} da domini esclusi`,
    ...plan.inbox.unknown.map((u) => `${u.notes} con dominio sconosciuto «${u.slug}»`)];
  L.push(`Note: ${plan.notes.length}, di cui ${inbox} nell'inbox (${parts.join(", ")})`);
  if (plan.renumbered) L.push("  alcuni id sono già usati nel DB: le note del vault prendono id nuovi (date originali)");
  L.push(`SF6: ${plan.combos.length} combo, ${plan.tips.length} tip`);
  if (plan.settings.dropped.length) L.push(`Impostazioni del vault non portate: ${plan.settings.dropped.join(", ")} (i modelli stanno in config.ts)`);
  for (const e of plan.settings.toEnv) L.push(`Impostazione ${e.key}: non copiata; se ti serve mettila in .env come ${e.env}`);

  L.push("Domini di StudyBuddy prima dell'import:");
  if (!plan.areas.length) L.push("  (nessuno)");
  for (const a of plan.areas) L.push(`  ${a.slug.padEnd(12)} ${a.name} · ${n(a.courses, "corso", "corsi")}${a.vault ? ` ← vault ${a.vault}` : ""}`);

  if (plan.errors.length) {
    L.push("Errori (niente da applicare):");
    for (const e of plan.errors) L.push(`  - ${e}`);
  }
  if (result) {
    L.push(`Dopo l'import: ${n(result.areas, "dominio", "domini")}, ${n(result.notes, "nota", "note")} (${result.inbox} nell'inbox), ${result.combos} combo, ${result.tips} tip`);
  }
  return L.join("\n");
}
