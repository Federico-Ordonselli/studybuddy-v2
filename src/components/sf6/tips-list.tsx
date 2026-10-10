"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotationRenderer } from "./notation-renderer";
import { ImportDialog, type ImportTarget } from "./import-dialog";
import { FUNDAMENTAL_TYPE_META } from "@/lib/sf6/fundamentals";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { api } from "@/lib/client/api";
import type { TipRow } from "@/lib/sf6/types";

export type { TipRow };

type TypeMeta = { label: string; color: string; bg: string; border: string };

const CHARACTER_TYPE_META: Record<string, TypeMeta> = {
  overview: { label: "Overview", color: "text-[var(--color-accent)]", bg: "bg-[var(--color-accent)]/15", border: "border-[var(--color-accent)]/50" },
  combo:    { label: "Combo",    color: "text-[var(--accent)]",             bg: "bg-[var(--accent)]/15",             border: "border-[var(--accent)]/40" },
  tech:     { label: "Tech",     color: "text-[var(--color-ok)]",             bg: "bg-[var(--color-ok)]/15",             border: "border-[var(--color-ok)]/40" },
  strategy: { label: "Strategy", color: "text-[var(--color-fg-muted)]",             bg: "bg-[var(--color-fg-muted)]/15",             border: "border-[var(--color-fg-muted)]/40" },
  matchup:  { label: "Matchup",  color: "text-[var(--accent)]",             bg: "bg-[var(--accent)]/15",             border: "border-[var(--accent)]/40" },
  general:  { label: "General",  color: "text-[var(--color-fg-muted)]", bg: "bg-[var(--color-surface-2)]", border: "border-[var(--color-border)]" },
};

const FUNDAMENTALS_TYPE_META: Record<string, TypeMeta> = {
  overview: { label: "Overview", color: "text-[var(--color-accent)]", bg: "bg-[var(--color-accent)]/15", border: "border-[var(--color-accent)]/50" },
  system:   FUNDAMENTAL_TYPE_META.system,
  neutral:  FUNDAMENTAL_TYPE_META.neutral,
  offense:  FUNDAMENTAL_TYPE_META.offense,
  defense:  FUNDAMENTAL_TYPE_META.defense,
  mental:   FUNDAMENTAL_TYPE_META.mental,
};

const CHARACTER_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all",      label: "Tutto" },
  { value: "overview", label: "Overview" },
  { value: "combo",    label: "Combo" },
  { value: "tech",     label: "Tech" },
  { value: "strategy", label: "Strategy" },
  { value: "matchup",  label: "Matchup" },
  { value: "general",  label: "General" },
];

const FUNDAMENTALS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all",      label: "Tutto" },
  { value: "overview", label: "Overview" },
  { value: "system",   label: "System" },
  { value: "neutral",  label: "Neutral" },
  { value: "offense",  label: "Offense" },
  { value: "defense",  label: "Defense" },
  { value: "mental",   label: "Mental" },
];

/**
 * Discriminated target mirrors ImportDialog's so wiring is one-to-one.
 */
export type TipsListTarget =
  | { mode: "character"; characterSlug: string; characterName: string }
  | { mode: "fundamentals" };

export function TipsList({
  target,
  tips,
}: {
  target: TipsListTarget;
  tips: TipRow[];
}) {
  const isFundamentals = target.mode === "fundamentals";
  const typeMeta = isFundamentals ? FUNDAMENTALS_TYPE_META : CHARACTER_TYPE_META;
  const filters = isFundamentals ? FUNDAMENTALS_FILTERS : CHARACTER_FILTERS;
  const importTarget: ImportTarget = isFundamentals
    ? { mode: "fundamentals" }
    : { mode: "character", characterSlug: target.characterSlug, characterName: target.characterName };

  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [, startTransition] = useTransition();
  const router = useRouter();

  // Overviews always rendered first, full-width, regardless of filter (unless filter is set to one specific type)
  const overviews = tips.filter((t) => t.type === "overview");
  const nonOverview = tips.filter((t) => t.type !== "overview");

  const filteredNonOverview =
    filter === "all" || filter === "overview"
      ? nonOverview
      : nonOverview.filter((t) => t.type === filter);

  const showOverviews = filter === "all" || filter === "overview";

  // Group non-overview by source
  const groupedBySource = new Map<string, TipRow[]>();
  for (const t of filteredNonOverview) {
    const key = t.sourceTitle ?? "__nosource__";
    const arr = groupedBySource.get(key) ?? [];
    arr.push(t);
    groupedBySource.set(key, arr);
  }

  async function remove(id: number) {
    if (!confirm("Eliminare questo elemento?")) return;
    await api("DELETE", `/api/sf6/tips/${id}`).catch(() => {});
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-dim)]">
              Tips & tech
            </h2>
            <span className="text-[10px] text-[var(--color-fg-dim)] font-[var(--font-mono)] tabular">
              {tips.length} {tips.length === 1 ? "voce" : "voci"}
            </span>
          </div>
          <button
            onClick={() => setShowImport(true)}
            className="text-[11px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
          >
            ✦ Importa transcript
          </button>
        </div>

        {tips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {filters.map((f) => {
              const count =
                f.value === "all" ? tips.length : tips.filter((t) => t.type === f.value).length;
              if (f.value !== "all" && count === 0) return null;
              return (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "text-[10.5px] uppercase tracking-[0.18em] px-2.5 py-1 rounded transition-colors",
                    filter === f.value
                      ? "bg-[var(--color-surface-2)] text-[var(--color-fg)] ring-1 ring-[var(--color-border-strong)]"
                      : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]/60"
                  )}
                >
                  {f.label}
                  <span className="ml-1.5 text-[var(--color-fg-dim)] font-[var(--font-mono)] tabular normal-case">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {tips.length === 0 && (
          <div className="border border-dashed border-[var(--color-border)] rounded-lg px-6 py-12 text-center text-[var(--color-fg-dim)] text-sm space-y-2">
            <p>Nessun tip ancora.</p>
            <p className="text-[12px] leading-relaxed max-w-md mx-auto">
              Incolla un link YouTube → l'AI ti estrae overview narrativo, combo (tradotte in notation FGC), tech, strategy e matchup. Tutto in italiano.
            </p>
          </div>
        )}

        {/* Overviews — large prominent cards */}
        {showOverviews && overviews.length > 0 && (
          <div className="space-y-3">
            {overviews.map((t) => (
              <article
                key={t.id}
                className="group relative border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.04] rounded-lg p-5 hover:border-[var(--color-accent)]/60 transition-colors"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[9.5px] uppercase tracking-[0.25em] px-2 py-0.5 rounded border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                    Overview
                  </span>
                  {t.sourceTitle && (
                    <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
                      {t.sourceUrl ? (
                        <a
                          href={t.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-[var(--color-accent)] normal-case tracking-normal text-[11.5px]"
                        >
                          {t.sourceTitle} ↗
                        </a>
                      ) : (
                        <span className="normal-case tracking-normal text-[11.5px] text-[var(--color-fg-muted)]">
                          {t.sourceTitle}
                        </span>
                      )}
                    </span>
                  )}
                  <button
                    onClick={() => remove(t.id)}
                    className="ml-auto opacity-0 group-hover:opacity-100 text-[var(--color-fg-dim)] hover:text-[var(--color-danger)] text-xs px-1 transition-opacity"
                    aria-label="Elimina"
                    title="Elimina"
                  >
                    ✕
                  </button>
                </div>
                <h3
                  className="text-2xl tracking-tight leading-tight mb-3"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}
                >
                  {t.title}
                </h3>
                <p className="text-[13.5px] leading-[1.7] text-[var(--color-fg)] whitespace-pre-wrap">
                  {t.content}
                </p>
                <div className="text-[10px] text-[var(--color-fg-dim)] uppercase tracking-[0.18em] mt-3">
                  <span className="tabular normal-case tracking-normal">
                    {relativeTime(t.createdAt)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}

        {filteredNonOverview.length === 0 && tips.length > 0 && !showOverviews && (
          <div className="text-[12px] text-[var(--color-fg-dim)] italic">
            Nessun elemento del tipo selezionato.
          </div>
        )}

        <div className="space-y-6">
          {[...groupedBySource.entries()].map(([sourceKey, group]) => {
            const sourceTitle = sourceKey === "__nosource__" ? null : sourceKey;
            const sourceUrl = group[0]?.sourceUrl ?? null;
            return (
              <section key={sourceKey} className="space-y-2">
                {sourceTitle && (
                  <div className="flex items-baseline gap-2 text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)] pl-1">
                    <span className="text-[var(--color-fg-dim)]/70">fonte ·</span>
                    {sourceUrl ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] normal-case tracking-normal text-[12px]"
                      >
                        {sourceTitle} ↗
                      </a>
                    ) : (
                      <span className="text-[var(--color-fg-muted)] normal-case tracking-normal text-[12px]">
                        {sourceTitle}
                      </span>
                    )}
                  </div>
                )}
                <ul className="space-y-2">
                  {group.map((t) => {
                    const meta = typeMeta[t.type] ?? typeMeta.general ?? typeMeta.overview;
                    return (
                      <li
                        key={t.id}
                        className="group border border-[var(--color-border)] bg-[var(--color-surface)] rounded-lg px-4 py-3 hover:border-[var(--color-border-strong)] transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span
                                className={cn(
                                  "text-[9.5px] uppercase tracking-[0.2em] px-2 py-0.5 rounded border shrink-0",
                                  meta.color,
                                  meta.bg,
                                  meta.border
                                )}
                              >
                                {meta.label}
                              </span>
                              <span className="text-[13.5px] font-medium text-[var(--color-fg)] leading-snug">
                                {t.title}
                              </span>
                            </div>
                            {t.notation && (
                              <div className="pt-0.5">
                                <NotationRenderer text={t.notation} size="sm" />
                              </div>
                            )}
                            <p className="text-[12.5px] leading-relaxed text-[var(--color-fg-muted)] whitespace-pre-wrap">
                              {t.content}
                            </p>
                            <div className="text-[10px] text-[var(--color-fg-dim)] uppercase tracking-[0.18em]">
                              <span className="tabular normal-case tracking-normal">
                                {relativeTime(t.createdAt)}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => remove(t.id)}
                            className="opacity-0 group-hover:opacity-100 text-[var(--color-fg-dim)] hover:text-[var(--color-danger)] text-xs px-2 py-1 transition-opacity"
                            aria-label="Elimina"
                            title="Elimina"
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      {showImport && (
        <ImportDialog target={importTarget} onClose={() => setShowImport(false)} />
      )}
    </>
  );
}
