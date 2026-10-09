"use client";

import { useState } from "react";
import AreaInput from "@/components/library/AreaInput";
import type { Area } from "@/lib/areas";
import { groupIntoNewMacro, type IngestPlan, type ItemAnalysis, type PlanCourse, type PlanParent } from "@/lib/ingestPlanTypes";

const STATUS: Record<PlanCourse["status"], string> = { new: "nuovo", upToDate: "aggiornato", changed: "" };

function summary(c: PlanCourse) {
  const n = c.counts;
  return [n.transcript && `${n.transcript} trascrizioni`, n.html && `${n.html} html`, n.pdf && `${n.pdf} pdf`, n.text && `${n.text} txt`, n.video && `${n.video} video`]
    .filter(Boolean).join(" · ");
}

const parentValue = (p: PlanParent) => (p == null ? "" : "macroKey" in p ? `k:${p.macroKey}` : `e:${p.existingId}`);
const parseParentValue = (v: string): PlanParent => (v === "" ? null : v.startsWith("k:") ? { macroKey: v.slice(2) } : { existingId: Number(v.slice(2)) });

/** Anteprima modificabile del piano di import. */
export default function PlanEditor(p: {
  items: ItemAnalysis[];
  plan: IngestPlan;
  setPlan: (plan: IngestPlan) => void;
  existingMacros: { id: number; name: string }[];
  areas: Area[];
  onToggleKind: (itemPath: string, as: "macro" | "course") => void;
  onImport: () => void;
  busy: boolean;
}) {
  const [groupName, setGroupName] = useState("");
  const { plan, setPlan } = p;
  const updCourse = (path: string, patch: Partial<PlanCourse>) =>
    setPlan({ ...plan, courses: plan.courses.map((c) => (c.path === path ? { ...c, ...patch } : c)) });
  const updMacro = (key: string, patch: Partial<IngestPlan["macros"][number]>) =>
    setPlan({ ...plan, macros: plan.macros.map((m) => (m.key === key ? { ...m, ...patch } : m)) });

  // Macro selezionabili come genitore: quelli esistenti nel DB + quelli nuovi del piano.
  const parentOptions = [
    ...p.existingMacros.map((m) => ({ value: `e:${m.id}`, label: m.name })),
    ...plan.macros.filter((m) => m.existingId == null).map((m) => ({ value: `k:${m.key}`, label: `${m.name} (nuovo)` })),
  ];
  // Macro nuovi senza cartella su disco (da «Raggruppa»): non appartengono a un elemento analizzato.
  const groups = plan.macros.filter((m) => m.path == null && m.existingId == null);
  const ungroup = (key: string) => setPlan({
    ...plan,
    macros: plan.macros.filter((m) => m.key !== key),
    courses: plan.courses.map((c) => (c.parent && "macroKey" in c.parent && c.parent.macroKey === key ? { ...c, parent: null } : c)),
  });
  const included = plan.courses.filter((c) => c.include);
  const looseIncluded = included.filter((c) => c.parent == null);
  const needsWhisper = included.some((c) => c.videosWithoutSubs > 0);

  const row = (c: PlanCourse) => (
    <div key={c.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-t border-border first:border-t-0">
      <input type="checkbox" checked={c.include} onChange={(e) => updCourse(c.path, { include: e.target.checked })} aria-label={`Importa ${c.name}`} />
      <input value={c.name} onChange={(e) => updCourse(c.path, { name: e.target.value })}
        className="bg-transparent border-b border-transparent hover:border-border focus:border-accent outline-none min-w-0 flex-1" />
      <span className="text-xs text-fg-dim">{summary(c)}</span>
      <span className={`text-xs ${c.status === "upToDate" ? "text-fg-dim" : "text-accent"}`}>
        {c.status === "changed" ? `${c.changedFiles} file nuovi o modificati` : STATUS[c.status]}
      </span>
      {c.videosWithoutSubs > 0 && <span className="text-xs text-danger">⚠ {c.videosWithoutSubs} video senza sottotitoli</span>}
      <select value={parentValue(c.parent)} onChange={(e) => updCourse(c.path, { parent: parseParentValue(e.target.value) })}
        className="bg-surface-2 border border-border rounded px-1.5 py-0.5 text-xs max-w-48">
        <option value="">nessun macro</option>
        {parentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {c.parent == null && <AreaInput value={c.areas} onChange={(areas) => updCourse(c.path, { areas })} areas={p.areas} />}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {p.items.map((it) => {
        const macro = plan.macros.find((m) => m.key === it.path);
        const courses = plan.courses.filter((c) => it.courses.some((x) => x.path === c.path));
        return (
          <div key={it.path} className="border border-border bg-surface rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              {macro ? (
                <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
                  <span className="text-[10px] uppercase tracking-[0.25em] text-fg-dim">Macro</span>
                  <input value={macro.name} onChange={(e) => updMacro(macro.key, { name: e.target.value })}
                    className="font-display text-lg bg-transparent border-b border-transparent hover:border-border focus:border-accent outline-none min-w-0" />
                  <AreaInput value={macro.areas} onChange={(areas) => updMacro(macro.key, { areas })} areas={p.areas} />
                </div>
              ) : (
                <span className="text-[10px] uppercase tracking-[0.25em] text-fg-dim">Corso singolo</span>
              )}
              <button onClick={() => p.onToggleKind(it.path, it.kind === "macro" ? "course" : "macro")} className="text-xs text-fg-dim hover:text-fg underline">
                {it.kind === "macro" ? "è un corso singolo" : "è una specializzazione (macro)"}
              </button>
            </div>
            {courses.map(row)}
          </div>
        );
      })}

      {groups.map((g) => {
        const members = plan.courses.filter((c) => c.parent && "macroKey" in c.parent && c.parent.macroKey === g.key);
        return (
          <div key={g.key} className="border border-dashed border-border-strong bg-surface rounded-lg p-4 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
                <span className="text-[10px] uppercase tracking-[0.25em] text-fg-dim">Nuovo macro</span>
                <input value={g.name} onChange={(e) => updMacro(g.key, { name: e.target.value })} aria-label="Nome del nuovo macro"
                  className="font-display text-lg bg-transparent border-b border-transparent hover:border-border focus:border-accent outline-none min-w-0" />
                <AreaInput value={g.areas} onChange={(areas) => updMacro(g.key, { areas })} areas={p.areas} />
              </div>
              <button onClick={() => ungroup(g.key)} className="text-xs text-fg-dim hover:text-fg underline">sciogli</button>
            </div>
            <p className="text-xs text-fg-dim">{members.length ? members.map((c) => c.name).join(" · ") : "nessun corso: non verrà creato"}</p>
          </div>
        );
      })}

      {looseIncluded.length >= 2 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg-dim">Raggruppa i {looseIncluded.length} corsi singoli selezionati in un nuovo macro:</span>
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Nome del macro"
            className="bg-surface-2 border border-border rounded px-2 py-1" />
          <button disabled={!groupName.trim()} onClick={() => { setPlan(groupIntoNewMacro(plan, looseIncluded.map((c) => c.path), groupName.trim())); setGroupName(""); }}
            className="border border-border rounded px-2 py-1 hover:border-border-strong">Raggruppa</button>
        </div>
      )}

      {needsWhisper && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={plan.whisper} onChange={(e) => setPlan({ ...plan, whisper: e.target.checked })} />
          Trascrivi con Whisper i video senza sottotitoli <span className="text-fg-dim">(lento: minuti per ogni ora di video)</span>
        </label>
      )}

      <button disabled={p.busy || !included.length} onClick={p.onImport} className="self-end bg-accent text-bg rounded-md px-4 py-2 font-medium">
        {included.length ? `Importa ${included.length} ${included.length === 1 ? "corso" : "corsi"}` : "Niente da importare"}
      </button>
    </div>
  );
}
