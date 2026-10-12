import type { ReactNode } from "react";
import CitationChip from "./CitationChip";
import { S } from "./styles";
import { VERDICT_LABEL, type Citation, type Grade, type PlayingVideo, type Verdict } from "./types";

const TONE: Record<Verdict, { background: string; color: string }> = {
  correct: { background: "var(--success-soft)", color: "var(--on-success-soft)" },
  partial: { background: "var(--warning-soft)", color: "var(--on-warning-soft)" },
  wrong: { background: "var(--danger-soft)", color: "var(--on-danger-soft)" },
};

function Items({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>{title}</div>
      <ul style={S.verdictList}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

/** Esito del giudice: verdetto, feedback, cosa mancava, cosa correggere, risposta attesa e passaggio sorgente. */
export default function VerdictPanel({ grade, expected, source, onPlay, children }: {
  grade: Grade; expected?: string; source?: Citation; onPlay: (v: PlayingVideo) => void; children?: ReactNode;
}) {
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 14 }}>
        <span style={{ ...S.verdict, ...TONE[grade.verdict] }}>{VERDICT_LABEL[grade.verdict]}</span>
        {children}
      </div>
      <p style={{ margin: "10px 0 0", lineHeight: 1.5 }}>{grade.feedback}</p>
      <Items title={grade.verdict === "correct" ? "Potevi aggiungere" : "Mancava"}items={grade.missing} />
      <Items title="Da correggere" items={grade.errors} />
      {expected && <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>Risposta attesa: {expected}</div>}
      {source && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Passaggio di riferimento</div>
          <CitationChip c={source} onPlay={onPlay} />
        </div>
      )}
    </div>
  );
}
