"use client";

import { useEffect, useMemo, useState } from "react";
import type { MapDoc, MapEditor } from "@/components/mappe/editor.js";
import { createRelation } from "@/lib/mappe/modello.js";
import {
  completionCommands, levelConcepts, levelKeyOf, levelPropositions, overlayDocument,
  type ExerciseDoc, type Solution, type SolutionRelation,
} from "@/lib/mapExerciseCore";
import type { CheckResult, LevelInfo, PropositionVerdict } from "@/lib/mapExercise";
import type { CardDraft } from "@/lib/tutor/cardGen";
import CardPreview from "./CardPreview";

type ExerciseEditor = MapEditor & { applyCommands(commands: unknown[]): unknown };

const MAX = 15;
/** Altezza della tela in MapStudio e tetto del pannello: i due restano indipendenti. */
export const STUDIO_HEIGHT = "min(75vh, 760px)";
/** Attesa massima di un salvataggio automatico in corso prima di verificare o completare. */
const SAVE_WAIT_MS = 10_000;
const TONE: Record<PropositionVerdict["verdict"], { background: string; color: string; label: string }> = {
  valid: { background: "var(--success-soft)", color: "var(--on-success-soft)", label: "✓ Valida" },
  imprecise: { background: "var(--warning-soft)", color: "var(--on-warning-soft)", label: "≈ Imprecisa" },
  wrong: { background: "var(--danger-soft)", color: "var(--on-danger-soft)", label: "✗ Sbagliata" },
  unrated: { background: "var(--panel-2)", color: "var(--muted)", label: "– Non valutata" },
};

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let j: { error?: string };
  try { j = await r.json(); } catch { throw new Error(`HTTP ${r.status}`); }
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

/**
 * Pannello dell'esercizio «costruisci tu» (Fase 5) accanto alla tela: domanda focale del livello,
 * proposizioni dello studente (aggiunte con i comandi atomici dell'editor), verifica, coppie
 * mancanti, soluzione sovrapposta e completamento. La soluzione arriva dal server solo su richiesta.
 */
export default function MapExercise({ editor, mapId, domainId, levels, onLevelsChange, overlay, onShowSolution, onCloseSolution }: {
  editor: MapEditor; mapId: string; domainId: number; levels: LevelInfo[]; onLevelsChange: () => void;
  overlay: boolean; onShowSolution: (doc: MapDoc) => void; onCloseSolution: () => void;
}) {
  const [doc, setDoc] = useState(() => editor.getDocument() as unknown as ExerciseDoc);
  const [spaceId, setSpaceId] = useState(() => editor.getStatus().ui.spaceId);
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [verb, setVerb] = useState("");
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const [solution, setSolution] = useState<SolutionRelation[] | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => editor.subscribe(() => {
    setDoc(editor.getDocument() as unknown as ExerciseDoc);
    setSpaceId(editor.getStatus().ui.spaceId);
  }), [editor]);

  const levelKey = useMemo(() => { try { return levelKeyOf(doc, spaceId); } catch { return null; } }, [doc, spaceId]);
  const level = levels.find((l) => l.levelKey === levelKey) ?? null;
  // Ordine alfabetico nei menu: l'ordine del documento potrebbe suggerire quale concetto è l'hub.
  const concepts = useMemo(() => [...levelConcepts(doc, spaceId)].sort((a, b) => a.title.localeCompare(b.title, "it")), [doc, spaceId]);
  const props = useMemo(() => levelPropositions(doc, spaceId), [doc, spaceId]);
  const title = (id: string) => doc.concepts.find((c) => c.id === id)?.title ?? "?";
  // Cambio livello: chiude soluzione e bozza della carta.
  useEffect(() => { setSolution(null); setDraft(null); setError(""); setNotice(""); }, [levelKey]);

  if (!level) return <aside style={P.panel}><p style={P.dim}>Nessun esercizio su questo livello.</p></aside>;
  if (level.completedAt && !overlay) return <aside style={P.panel}><p style={P.focus}>{level.focusQuestion}</p><p style={P.dim}>Livello completato: è una mappa normale da ripassare.</p></aside>;

  const check: CheckResult | null = level.lastCheck;
  const verdictOf = (relId: string, label: string, s: string, t: string) => {
    const v = check?.verdicts.find((x) => x.relationId === relId);
    return v && v.label === label && v.sourceId === s && v.targetId === t ? v : null;
  };

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  }
  /**
   * Salva prima di chiamare il server, che legge il documento salvato. L'autosalvataggio di
   * MapStudio può essere in corso (e `save()` lo rifiuterebbe con save_in_progress): si aspetta.
   */
  async function saveFirst() {
    const until = Date.now() + SAVE_WAIT_MS;
    while (editor.getStatus().saving) {
      if (Date.now() > until) throw new Error("Il salvataggio della mappa non finisce: riprova fra poco.");
      await new Promise((r) => setTimeout(r, 200));
    }
    if (editor.getStatus().dirty) await editor.save();
  }

  function add() {
    if (!from || !to || from === to || !verb.trim()) return;
    (editor as ExerciseEditor).applyCommands([{ type: "addRelation", relation: createRelation(from, to, verb.trim().slice(0, 120)) }]);
    setVerb("");
  }
  const remove = (id: string) => (editor as ExerciseEditor).applyCommands([{ type: "removeRelation", id }]);

  const verify = () => run("verifica", async () => {
    await saveFirst();
    await call<CheckResult>("/api/maps/exercise/check", { mapId, spaceId });
    onLevelsChange();
  });
  const reveal = () => run("soluzione", async () => {
    const { relations } = await call<{ relations: SolutionRelation[] }>("/api/maps/exercise/reveal", { mapId, spaceId });
    setSolution(relations);
    onShowSolution(overlayDocument(doc, spaceId, { concepts: [], relations }) as unknown as MapDoc);
    onLevelsChange();
  });
  const complete = () => run("completa", async () => {
    const { solution: full } = await call<{ solution: Solution }>("/api/maps/exercise/complete", { mapId, spaceId });
    onCloseSolution();
    // Il livello è già segnato completato sul server: il pannello si riallinea anche se il salvataggio fallisce.
    try {
      (editor as ExerciseEditor).applyCommands(completionCommands(editor.getDocument() as unknown as ExerciseDoc, spaceId, full));
      await saveFirst();
    } finally { onLevelsChange(); }
  });
  const card = (relationId: string) => run("carta", async () => {
    const { draft: d } = await call<{ draft: CardDraft }>("/api/maps/exercise/card", { mapId, spaceId, relationId });
    setDraft(d);
  });

  return (
    <aside style={P.panel} aria-label="Esercizio: costruisci la mappa">
      <p style={P.label}>Domanda focale</p>
      <p style={P.focus}>{level.focusQuestion}</p>

      {overlay ? (
        <>
          <p style={P.dim}>Archi pieni = i tuoi. Tratteggiati = archi della soluzione che non hai tracciato.</p>
          {solution && <p style={P.dim}>{solution.length} relazioni nella soluzione di questo livello.</p>}
          <div style={P.row}>
            <button style={P.ghost} onClick={onCloseSolution}>Torna alla tua mappa</button>
            <button style={btn(P.primary, !!busy)} onClick={complete} disabled={!!busy}>{busy === "completa" ? "Completo…" : "Completa la mappa"}</button>
          </div>
        </>
      ) : (
        <>
          <form style={P.form} onSubmit={(e) => { e.preventDefault(); add(); }}>
            <select aria-label="Da" value={from} onChange={(e) => setFrom(e.target.value)} style={P.input}>
              <option value="">Da…</option>
              {concepts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <input aria-label="Verbo della relazione" placeholder="verbo (es. provoca)" value={verb} maxLength={120} onChange={(e) => setVerb(e.target.value)} style={P.input} />
            <select aria-label="A" value={to} onChange={(e) => setTo(e.target.value)} style={P.input}>
              <option value="">A…</option>
              {concepts.filter((c) => c.id !== from).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button type="submit" style={btn(P.primary, !from || !to || from === to || !verb.trim())} disabled={!from || !to || from === to || !verb.trim()}>Aggiungi</button>
          </form>

          <p style={P.label}>Le tue proposizioni · {props.length}/{MAX}</p>
          {!props.length && <p style={P.dim}>Collega due concetti con un verbo che dica che rapporto c'è fra loro.</p>}
          <ul style={P.list}>
            {props.map((r) => {
              const v = verdictOf(r.id, r.label || r.predicate, r.sourceConceptId, r.targetConceptId);
              return (
                <li key={r.id} style={P.item}>
                  <div><strong>{title(r.sourceConceptId)}</strong> → {r.label || r.predicate} → <strong>{title(r.targetConceptId)}</strong></div>
                  {v && <span style={{ ...P.badge, background: TONE[v.verdict].background, color: TONE[v.verdict].color }}>{TONE[v.verdict].label}</span>}
                  {v?.reason && <p style={P.small}>{v.reason}</p>}
                  {v?.fix && <p style={P.small}><em>Correzione:</em> {v.fix}</p>}
                  <div style={P.row}>
                    <button style={P.link} onClick={() => remove(r.id)}>Rimuovi</button>
                    {v?.verdict === "wrong" && v.inSolution && <button style={btn(P.link, !!busy)} onClick={() => card(r.id)} disabled={!!busy}>Crea carta</button>}
                  </div>
                </li>
              );
            })}
          </ul>

          <div style={P.row}>
            <button style={btn(P.primary, !!busy || !props.length || props.length > MAX)} onClick={verify} disabled={!!busy || !props.length || props.length > MAX}>
              {busy === "verifica" ? "Verifico…" : "Verifica"}
            </button>
            <button style={btn(P.ghost, !!busy || !check)} onClick={reveal} disabled={!!busy || !check}>Mostra soluzione</button>
          </div>
          {props.length > MAX && <p style={P.error}>Massimo {MAX} proposizioni per verifica: togline qualcuna.</p>}

          {check && check.missing.length > 0 && (
            <>
              <p style={P.label}>Coppie mancanti · {check.missing.length}</p>
              <ul style={P.list}>{check.missing.map((m, i) => <li key={i} style={P.small}>{m.a} — {m.b}</li>)}</ul>
            </>
          )}
          <p style={P.small}>Se rinomini una bolla, le sue coppie non vengono più riconosciute nella verifica.</p>
        </>
      )}

      {draft && (
        <div style={{ marginTop: 10 }}>
          <CardPreview domainId={domainId} drafts={[draft]} onDone={(m) => { setDraft(null); setNotice(m); }} />
        </div>
      )}
      {notice && <p style={P.small} role="status">{notice}</p>}
      {error && <p style={P.error} role="alert">{error}</p>}
    </aside>
  );
}

/** Stile del bottone, con lo stato disabilitato dai token (mai opacity, CLAUDE.md «Colori»). */
function btn(style: React.CSSProperties, disabled: boolean): React.CSSProperties {
  if (!disabled) return style;
  const filled = style.background !== "transparent";
  return { ...style, color: "var(--text-subtle)", cursor: "default", ...(filled ? { background: "var(--bg-subtle)" } : {}) };
}

const P: Record<string, React.CSSProperties> = {
  panel: { width: 340, maxWidth: "100%", maxHeight: STUDIO_HEIGHT, flexShrink: 0, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 },
  label: { margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)" },
  focus: { margin: 0, fontWeight: 650, lineHeight: 1.4, color: "var(--text)" },
  dim: { margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 },
  small: { margin: 0, color: "var(--muted)", fontSize: 12.5, lineHeight: 1.45 },
  form: { display: "grid", gridTemplateColumns: "1fr", gap: 6 },
  input: { background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 },
  item: { background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5 },
  badge: { alignSelf: "flex-start", borderRadius: 999, padding: "2px 9px", fontSize: 12, fontWeight: 700 },
  row: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  primary: { background: "var(--accent-2)", color: "var(--button-ink)", border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 600 },
  ghost: { background: "transparent", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" },
  link: { background: "transparent", border: "none", color: "var(--muted)", padding: 0, fontSize: 12.5, textDecoration: "underline", cursor: "pointer" },
  error: { margin: 0, color: "var(--color-danger)", fontSize: 13 },
};
