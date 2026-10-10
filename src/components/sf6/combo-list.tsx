"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotationRenderer } from "./notation-renderer";
import { ComboForm } from "./combo-form";
import { cn } from "@/lib/cn";
import { api } from "@/lib/client/api";
import type { ComboRow } from "@/lib/sf6/types";

export type { ComboRow };

const STATUS_META: Record<
  ComboRow["status"],
  { label: string; dot: string; order: number }
> = {
  practicing:   { label: "In pratica",       dot: "bg-[var(--accent)]",            order: 0 },
  learning:     { label: "In apprendimento", dot: "bg-[var(--color-fg-dim)]", order: 1 },
  consolidated: { label: "Consolidate",      dot: "bg-emerald-400",           order: 2 },
};

export function ComboList({
  characterSlug,
  combos,
}: {
  characterSlug: string;
  combos: ComboRow[];
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Group by status
  const groups: Record<ComboRow["status"], ComboRow[]> = {
    learning: [],
    practicing: [],
    consolidated: [],
  };
  for (const c of combos) groups[c.status].push(c);

  const orderedStatuses = (Object.keys(STATUS_META) as ComboRow["status"][]).sort(
    (a, b) => STATUS_META[a].order - STATUS_META[b].order
  );

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-dim)]">
            Combo library
          </h2>
          <span className="text-[10px] text-[var(--color-fg-dim)] font-[var(--font-mono)] tabular">
            {combos.length} {combos.length === 1 ? "voce" : "voci"}
          </span>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-[11px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-md border border-[var(--color-border-strong)] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            + Aggiungi
          </button>
        )}
      </div>

      {adding && (
        <ComboForm
          characterSlug={characterSlug}
          onClose={() => setAdding(false)}
        />
      )}

      {combos.length === 0 && !adding && (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg px-6 py-12 text-center text-[var(--color-fg-dim)] text-sm">
          Nessuna combo ancora. Aggiungine una per iniziare.
        </div>
      )}

      {orderedStatuses.map((status) => {
        const items = groups[status];
        if (items.length === 0) return null;

        return (
          <section key={status} className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_META[status].dot)} />
              <h3 className="text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-fg-muted)]">
                {STATUS_META[status].label}
              </h3>
              <span className="text-[10px] text-[var(--color-fg-dim)] font-[var(--font-mono)] tabular">
                {items.length}
              </span>
            </div>
            <ul className="space-y-2">
              {items.map((c) =>
                editingId === c.id ? (
                  <li key={c.id}>
                    <ComboForm
                      characterSlug={characterSlug}
                      initial={{
                        id: c.id,
                        notation: c.notation,
                        situation: c.situation ?? "",
                        status: c.status,
                        damage: c.damage?.toString() ?? "",
                        driveCost: c.driveCost?.toString() ?? "",
                        notes: c.notes ?? "",
                      }}
                      onClose={() => setEditingId(null)}
                    />
                  </li>
                ) : (
                  <ComboItem
                    key={c.id}
                    combo={c}
                    onEdit={() => setEditingId(c.id)}
                  />
                )
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ComboItem({
  combo,
  onEdit,
}: {
  combo: ComboRow;
  onEdit: () => void;
}) {
  const [, startTransition] = useTransition();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setStatus(status: ComboRow["status"]) {
    setBusy(true);
    await fetch(`/api/sf6/combos/${combo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    startTransition(() => router.refresh());
  }

  async function remove() {
    if (!confirm("Eliminare questa combo?")) return;
    setBusy(true);
    await api("DELETE", `/api/sf6/combos/${combo.id}`).catch(() => {});
    setBusy(false);
    startTransition(() => router.refresh());
  }

  return (
    <li
      className={cn(
        "group border border-[var(--color-border)] bg-[var(--color-surface)] rounded-lg px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]",
        busy && "opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          <NotationRenderer text={combo.notation} size="md" />

          {(combo.situation || combo.damage !== null || combo.driveCost !== null) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
              {combo.situation && (
                <span>
                  <span className="text-[var(--color-fg-dim)]/70">situazione · </span>
                  <span className="text-[var(--color-fg-muted)] normal-case tracking-normal">
                    {combo.situation}
                  </span>
                </span>
              )}
              {combo.damage !== null && (
                <span>
                  <span className="text-[var(--color-fg-dim)]/70">danno · </span>
                  <span className="text-[var(--color-fg-muted)] font-[var(--font-mono)] tabular normal-case tracking-normal">
                    {combo.damage}
                  </span>
                </span>
              )}
              {combo.driveCost !== null && (
                <span>
                  <span className="text-[var(--color-fg-dim)]/70">drive · </span>
                  <span className="text-[var(--color-fg-muted)] font-[var(--font-mono)] tabular normal-case tracking-normal">
                    {combo.driveCost}/6
                  </span>
                </span>
              )}
            </div>
          )}

          {combo.notes && (
            <p className="text-[12.5px] leading-relaxed text-[var(--color-fg-muted)] whitespace-pre-wrap">
              {combo.notes}
            </p>
          )}
        </div>

        <div className="flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {combo.status !== "practicing" && (
            <button
              onClick={() => setStatus("practicing")}
              className="text-[10px] uppercase tracking-[0.15em] px-2 py-1 rounded text-[var(--color-fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--color-surface-2)]"
              title="Sposta in pratica"
            >
              pratica
            </button>
          )}
          {combo.status !== "consolidated" && (
            <button
              onClick={() => setStatus("consolidated")}
              className="text-[10px] uppercase tracking-[0.15em] px-2 py-1 rounded text-[var(--color-fg-muted)] hover:text-emerald-400 hover:bg-[var(--color-surface-2)]"
              title="Segna come consolidata"
            >
              ✓
            </button>
          )}
          <button
            onClick={onEdit}
            className="text-[10px] uppercase tracking-[0.15em] px-2 py-1 rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
            title="Modifica"
          >
            ✎
          </button>
          <button
            onClick={remove}
            className="text-[10px] uppercase tracking-[0.15em] px-2 py-1 rounded text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
            title="Elimina"
          >
            ✕
          </button>
        </div>
      </div>
    </li>
  );
}
