"use client";

import { useState } from "react";
import { post } from "@/lib/client/api";
import { checkCard, type CardIssue } from "@/lib/tutor/cardQuality";
import type { CardDraft } from "@/lib/tutor/cardGen";
import { S } from "./styles";

type Item = CardDraft & { keep: boolean; original: string };

/** Ricontrolla la carta modificata; «già presente» resta finché la domanda non cambia. */
function recheck(item: Item): CardIssue[] {
  const duplicate = item.question === item.original ? item.issues.filter((i) => i.code === "duplicate") : [];
  return [...checkCard(item), ...duplicate];
}

/**
 * Anteprima delle carte generate (Fase 3): le valide sono già spuntate, le segnalate no e
 * mostrano il motivo. Si possono modificare (il controllo si ripete mentre scrivi) e salvare.
 */
export default function CardPreview({ domainId, drafts, onDone }: {
  domainId: number; drafts: CardDraft[]; onDone: (message: string) => void;
}) {
  const [items, setItems] = useState<Item[]>(() => drafts.map((d) => ({ ...d, keep: !d.issues.length, original: d.question })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = items.filter((i) => i.keep);
  const flagged = items.filter((i) => i.issues.length).length;

  const update = (index: number, patch: Partial<Item>) =>
    setItems((all) => all.map((it, i) => {
      if (i !== index) return it;
      const next = { ...it, ...patch };
      return patch.question !== undefined || patch.answer !== undefined ? { ...next, issues: recheck(next) } : next;
    }));

  async function save() {
    if (!chosen.length || busy) return;
    setBusy(true); setError("");
    try {
      const r = await post<{ created: number; skipped: number }>("/api/cards", {
        domainId, cards: chosen.map(({ question, answer, sourceChunkId }) => ({ question, answer, sourceChunkId })),
      });
      onDone(`${r.created} ${r.created === 1 ? "carta aggiunta" : "carte aggiunte"} al ripasso${r.skipped ? ` (${r.skipped} già presenti)` : ""}.`);
    } catch (e) {
      setError(`Errore: ${e instanceof Error ? e.message : e}`);
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="Anteprima delle carte" style={S.card}>
      <div style={S.badge}>Anteprima</div>
      <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 14 }}>
        {items.length} {items.length === 1 ? "carta proposta" : "carte proposte"}
        {flagged ? ` · ${flagged} da rivedere, non ${flagged === 1 ? "selezionata" : "selezionate"}` : ""}. Scegli quali tenere: puoi modificarle prima di salvarle.
      </p>
      {items.map((it, i) => (
        <div key={i} style={S.previewItem}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <input type="checkbox" checked={it.keep} onChange={(e) => update(i, { keep: e.target.checked })} />
            Tieni <span style={{ color: "var(--muted)" }}>· {it.type === "cloze" ? "completamento" : "domanda"}</span>
          </label>
          <textarea aria-label={`Domanda della carta ${i + 1}`} rows={2} value={it.question}
            onChange={(e) => update(i, { question: e.target.value })} style={{ ...S.textarea, marginTop: 8 }} />
          <textarea aria-label={`Risposta della carta ${i + 1}`} rows={2} value={it.answer}
            onChange={(e) => update(i, { answer: e.target.value })} style={{ ...S.textarea, marginTop: 6 }} />
          {it.issues.length > 0 && (
            <ul style={S.issues}>
              {it.issues.map((issue) => <li key={issue.code}>⚠ {issue.message}</li>)}
            </ul>
          )}
          {it.fact && <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--muted)" }}>Fatto: {it.fact}</p>}
        </div>
      ))}
      {error && <p role="alert" style={{ color: "var(--danger)", margin: "10px 0 0" }}>{error}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        <button onClick={save} disabled={busy || !chosen.length} style={{ ...S.send, padding: "10px 18px" }}>
          {busy ? <span className="spin" /> : `Salva ${chosen.length} ${chosen.length === 1 ? "carta" : "carte"}`}
        </button>
        <button onClick={() => onDone("")} disabled={busy} style={{ ...S.ghost, marginTop: 0 }}>Scarta</button>
      </div>
    </section>
  );
}
