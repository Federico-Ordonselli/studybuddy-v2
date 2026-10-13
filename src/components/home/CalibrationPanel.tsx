import { CALIBRATION_SURE_PCT, type Calibration } from "@/lib/home";

const LABEL = { 1: "Non sicuro", 2: "Abbastanza", 3: "Sicuro" } as const;

/**
 * Calibrazione della fiducia (Fase 6): per livello, quante risposte erano corrette. Il numero è sempre
 * scritto: la barra è solo un aiuto visivo. Niente streak né allarmi, al più una frase.
 */
export default function CalibrationPanel({ data }: { data: Calibration }) {
  const sure = data.levels[2];
  return (
    <div className="menu-panel">
      <div className="menu-panel-title">Fiducia e risultati</div>
      <p className="text-sm text-fg-muted mb-4">
        {sure.pct === null
          ? `Negli ultimi ${data.days} giorni non hai ancora risposto con «Sicuro».`
          : <>Quando dici <em>Sicuro</em> hai ragione nel <b className="text-fg tabular">{sure.pct}%</b> dei casi.</>}
      </p>
      <ul className="flex flex-col gap-3" aria-label={`Risposte corrette per livello di fiducia, ultimi ${data.days} giorni`}>
        {data.levels.map((l) => (
          <li key={l.confidence}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{LABEL[l.confidence]}</span>
              <span className="tabular text-fg-muted">
                {l.pct === null ? "nessuna risposta" : `${l.pct}% · ${l.correct} su ${l.total}`}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-surface border border-border overflow-hidden" aria-hidden>
              <div className="h-full bg-accent" style={{ width: `${l.pct ?? 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {data.overconfident && (
        <p className="text-sm mt-4">
          Con «Sicuro» sbagli più spesso di quanto sembri (sotto il {CALIBRATION_SURE_PCT}%): prima di sceglierlo, prova a dire la risposta per intero.
        </p>
      )}
    </div>
  );
}
