"use client";

import { useEffect } from "react";
import { isTypingTarget } from "@/components/shell/Shell";
import { confidenceFromKey, type Confidence } from "@/lib/client/confidence";
import { S } from "./styles";
import { CONFIDENCE_LABEL } from "./types";

/**
 * Fiducia prima di inviare la risposta (Fase 6): tre scelte, tasti 1/2/3 (Alt+1/2/3 mentre scrivi).
 * La scelta ha sempre il segno ✓, non solo il colore.
 */
export default function ConfidencePicker({ value, onChange, disabled }: {
  value: Confidence | null; onChange: (c: Confidence) => void; disabled?: boolean;
}) {
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented) return;
      const c = confidenceFromKey({ key: e.key, code: e.code, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, typing: isTypingTarget(e.target) });
      if (!c) return;
      e.preventDefault();
      onChange(c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, onChange]);

  return (
    <div role="radiogroup" aria-label="Quanto sei sicuro?" style={S.confidence}>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>Quanto sei sicuro?</span>
      {([1, 2, 3] as Confidence[]).map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} disabled={disabled}
          onClick={() => onChange(c)} title={`Tasto ${c} (Alt+${c} mentre scrivi)`}
          style={{ ...S.opt, padding: "6px 12px", ...(value === c ? S.optOn : null) }}>
          {value === c ? "✓ " : ""}{CONFIDENCE_LABEL[c]} <kbd style={S.kbd}>{c}</kbd>
        </button>
      ))}
    </div>
  );
}
