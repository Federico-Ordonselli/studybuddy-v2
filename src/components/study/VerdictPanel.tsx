import type { ReactNode } from "react";
import CitationChip from "./CitationChip";
import { S } from "./styles";
import { CONFIDENCE_LABEL, VERDICT_LABEL, type Citation, type Confidence, type Grade, type PlayingVideo, type Verdict } from "./types";

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

/**
 * Esito del giudice: verdetto, feedback, cosa mancava, cosa correggere, risposta attesa e passaggio sorgente.
 * Un errore dato con «Sicuro» (Fase 6) mette in evidenza feedback e risposta attesa: gli errori fatti
 * con sicurezza, una volta corretti, si ricordano meglio.
 */
export default function VerdictPanel({ grade, expected, source, confidence, onPlay, children }: {
  grade: Grade; expected?: string; source?: Citation; confidence?: Confidence; onPlay: (v: PlayingVideo) => void; children?: ReactNode;
}) {
  const confidentWrong = grade.verdict === "wrong" && confidence === 3;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 14 }}>
        <span style={{ ...S.verdict, ...TONE[grade.verdict] }}>{VERDICT_LABEL[grade.verdict]}</span>
        {confidence && <span style={{ color: "var(--muted)" }}>· eri «{CONFIDENCE_LABEL[confidence]}»</span>}
        {children}
      </div>
      {confidentWrong ? (
        <div role="status" style={{ ...S.confidentWrong, marginTop: 10 }}>
          <b>Eri sicuro, ma non è così.</b> Vale la pena fermarsi qui: un errore fatto con sicurezza, una volta corretto, si ricorda meglio.
          {expected && <div style={{ marginTop: 8 }}><b>Risposta attesa:</b> {expected}</div>}
          <p style={{ margin: "8px 0 0" }}>{grade.feedback}</p>
        </div>
      ) : (
        <p style={{ margin: "10px 0 0", lineHeight: 1.5 }}>{grade.feedback}</p>
      )}
      <Items title={grade.verdict === "correct" ? "Potevi aggiungere" : "Mancava"} items={grade.missing} />
      <Items title="Da correggere" items={grade.errors} />
      {expected && !confidentWrong && <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>Risposta attesa: {expected}</div>}
      {source && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Passaggio di riferimento</div>
          <CitationChip c={source} onPlay={onPlay} />
        </div>
      )}
    </div>
  );
}
