"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotationRenderer } from "./notation-renderer";
import { cn } from "@/lib/cn";

type Status = "learning" | "practicing" | "consolidated";

type ComboFormValues = {
  id?: number;
  notation: string;
  situation: string;
  status: Status;
  damage: string; // string for input, parsed on submit
  driveCost: string;
  notes: string;
};

const EMPTY: ComboFormValues = {
  notation: "",
  situation: "",
  status: "learning",
  damage: "",
  driveCost: "",
  notes: "",
};

const STATUS_LABEL: Record<Status, string> = {
  learning: "In apprendimento",
  practicing: "In pratica",
  consolidated: "Consolidata",
};

const STATUS_DOT: Record<Status, string> = {
  learning: "bg-[var(--color-fg-dim)]",
  practicing: "bg-[#E07B3D]",
  consolidated: "bg-emerald-400",
};

export function ComboForm({
  characterSlug,
  initial,
  onClose,
}: {
  characterSlug: string;
  initial?: ComboFormValues;
  onClose?: () => void;
}) {
  const [values, setValues] = useState<ComboFormValues>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const isEdit = initial?.id !== undefined;

  function update<K extends keyof ComboFormValues>(key: K, val: ComboFormValues[K]) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  async function submit() {
    setError(null);
    if (!values.notation.trim()) {
      setError("La notation è obbligatoria.");
      return;
    }
    setSaving(true);

    const payload = {
      character_slug: characterSlug,
      notation: values.notation.trim(),
      situation: values.situation.trim() || null,
      status: values.status,
      damage: values.damage ? Number(values.damage) : null,
      drive_cost: values.driveCost ? Number(values.driveCost) : null,
      notes: values.notes.trim() || null,
    };

    const url = isEdit ? `/api/sf6/combos/${initial!.id}` : "/api/sf6/combos";
    const method = isEdit ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSaving(false);

    if (!res.ok) {
      setError(`Errore ${res.status}: ${await res.text()}`);
      return;
    }

    if (!isEdit) setValues(EMPTY);
    startTransition(() => {
      router.refresh();
      onClose?.();
    });
  }

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)] rounded-lg p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-dim)]">
          {isEdit ? "Modifica combo" : "Nuova combo"}
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] text-xs"
          >
            chiudi
          </button>
        )}
      </div>

      {/* Notation field with live preview */}
      <div>
        <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
          Notation
        </label>
        <input
          type="text"
          value={values.notation}
          onChange={(e) => update("notation", e.target.value)}
          placeholder="es. cr.MK > qcf+HP > DRC > 5HK xx SA3"
          spellCheck={false}
          className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 font-[var(--font-mono)] text-sm focus:outline-none focus:border-[var(--color-border-strong)]"
        />
        {values.notation.trim() && (
          <div className="mt-3 p-3 rounded-md bg-[var(--color-bg)]/50 border border-dashed border-[var(--color-border)]">
            <div className="text-[9.5px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-2">
              anteprima
            </div>
            <NotationRenderer text={values.notation} size="md" />
          </div>
        )}
      </div>

      {/* Situation + Status */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
            Situazione
          </label>
          <input
            type="text"
            value={values.situation}
            onChange={(e) => update("situation", e.target.value)}
            placeholder="midscreen, corner, punish…"
            className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-border-strong)]"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
            Stato
          </label>
          <div className="flex gap-1">
            {(["learning", "practicing", "consolidated"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => update("status", s)}
                className={cn(
                  "flex-1 px-2 py-2 rounded text-[10.5px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors",
                  values.status === s
                    ? "bg-[var(--color-surface-2)] text-[var(--color-fg)] ring-1 ring-[var(--color-border-strong)]"
                    : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]/60"
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[s])} />
                <span className="truncate">{STATUS_LABEL[s]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Damage + Drive cost */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
            Danno (opzionale)
          </label>
          <input
            type="number"
            min="0"
            max="9999"
            value={values.damage}
            onChange={(e) => update("damage", e.target.value)}
            placeholder="es. 2800"
            className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm font-[var(--font-mono)] focus:outline-none focus:border-[var(--color-border-strong)]"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
            Drive spesa (0–6)
          </label>
          <input
            type="number"
            min="0"
            max="6"
            value={values.driveCost}
            onChange={(e) => update("driveCost", e.target.value)}
            placeholder="es. 3"
            className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm font-[var(--font-mono)] focus:outline-none focus:border-[var(--color-border-strong)]"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
          Note (opzionale)
        </label>
        <textarea
          value={values.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder="dettagli, timing, requisiti…"
          rows={2}
          className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-[var(--color-border-strong)] resize-none"
        />
      </div>

      {error && (
        <div className="text-[12px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {/* Submit */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={submit}
          disabled={saving || !values.notation.trim()}
          className={cn(
            "px-5 py-2 rounded-md text-xs uppercase tracking-[0.2em] font-medium transition-all",
            values.notation.trim() && !saving
              ? "bg-[var(--color-accent)] text-[var(--color-bg)] hover:brightness-110"
              : "bg-[var(--color-surface-2)] text-[var(--color-fg-dim)] cursor-not-allowed"
          )}
        >
          {saving ? "Salvataggio…" : isEdit ? "Salva modifiche" : "Crea combo"}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            Annulla
          </button>
        )}
      </div>
    </div>
  );
}
