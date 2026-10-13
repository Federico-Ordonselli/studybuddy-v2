"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mount, type MapDoc, type MapEditor, type Proposal, type SourceRef } from "./editor.js";
import { download } from "./dom.js";
import MapExercise from "@/components/study/MapExercise";
import type { LevelInfo } from "@/lib/mapExercise";

interface MapSummary { id: string; title: string; revision: number; updatedAt: number; exercise?: boolean }
interface SourceView {
  label: string; snippet: string; kind: string;
  video?: { path: string; startSec: number };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

/**
 * Host dell'editor di mappe (components/mappe/editor.js, JS puro montato nel DOM).
 * Qui stanno gli adattatori verso l'app: salvataggio su SQLite con revisione,
 * approfondimenti generati dal materiale, fonti (video al minuto), carte di
 * ripasso e passaggio al tutor.
 */
export default function MapStudio({ domainId, onAskTutor }: { domainId?: number; onAskTutor: (text: string) => void }) {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [current, setCurrent] = useState<MapDoc | null>(null);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("");
  const [source, setSource] = useState<SourceView | null>(null);
  const [buildMode, setBuildMode] = useState(false);
  const [levels, setLevels] = useState<LevelInfo[]>([]);
  const [ed, setEd] = useState<MapEditor | null>(null);
  const [overlay, setOverlay] = useState<MapDoc | null>(null);
  const overlayHost = useRef<HTMLDivElement>(null);
  const exerciseRef = useRef(false);
  exerciseRef.current = levels.length > 0;
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<MapEditor | null>(null);
  const domainRef = useRef(domainId);
  domainRef.current = domainId;
  const askRef = useRef(onAskTutor);
  askRef.current = onAskTutor;

  const refresh = useCallback(async () => {
    if (!domainId) { setMaps([]); return; }
    const r = await json<{ maps: MapSummary[] }>(`/api/maps?domainId=${domainId}`);
    setMaps(r.maps);
  }, [domainId]);

  const loadLevels = useCallback(async (mapId: string) => {
    const r = await json<{ levels: LevelInfo[] }>(`/api/maps/exercise?mapId=${encodeURIComponent(mapId)}`);
    setLevels(r.levels);
  }, []);

  // Cambio dominio: chiude la mappa aperta e ricarica l'elenco.
  useEffect(() => {
    setCurrent(null); setSource(null); setError(""); setLevels([]); setOverlay(null);
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  // Monta l'editor per la mappa corrente; lo distrugge al cambio mappa o allo smontaggio.
  useEffect(() => {
    if (!current || !host.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const ed = mount(host.current, {
      document: current,
      adapters: {
        saveDocument: async (document, expectedRevision) =>
          (await json<{ map: MapDoc }>(`/api/maps/${encodeURIComponent(document.id)}`, {
            method: "PUT", body: JSON.stringify({ domainId: domainRef.current, document, expectedRevision }),
          })).map,
        expandConcept: async (req) => {
          if (!exerciseRef.current) return json("/api/maps/expand", {
            method: "POST",
            body: JSON.stringify({ domainId: domainRef.current, concept: req.concept, path: req.path, existing: req.existing, present: req.present }),
          });
          const proposal = await json<Proposal>("/api/maps/exercise/expand", {
            method: "POST",
            body: JSON.stringify({ mapId: req.mapId, domainId: domainRef.current, conceptId: req.conceptId, concept: req.concept, path: req.path, existing: req.existing, present: req.present }),
          });
          loadLevels(req.mapId).catch((e) => setError(String(e)));
          return proposal;
        },
        resolveSource: async (ref: SourceRef) => {
          const { citation } = await json<{ citation: SourceView }>(`/api/maps/source?chunkId=${encodeURIComponent(ref.chunkId)}`);
          setSource(citation);
        },
        requestQuiz: async (req) => {
          // Salvataggio diretto (niente anteprima): entrano solo le carte che passano il controllo di qualità.
          const { created, flagged } = await json<{ created: number; flagged: number }>("/api/cards", {
            method: "POST", body: JSON.stringify({ domainId: domainRef.current, topic: req.concepts[0].title, n: 3 }),
          });
          const skipped = flagged ? ` ${flagged} ${flagged === 1 ? "scartata perché da rivedere o già presente" : "scartate perché da rivedere o già presenti"}.` : "";
          return (created ? `${created === 1 ? "1 carta" : `${created} carte`} su «${req.concepts[0].title}» ${created === 1 ? "aggiunta" : "aggiunte"} al Ripasso.` : "Nessuna carta valida generata da questo concetto.") + skipped;
        },
        askTutor: (req) => askRef.current(`Spiegami «${req.concepts[0].title}»`),
      },
      onEvent: (event) => {
        if (event.type !== "documentChanged" && event.type !== "saveStatusChanged") return;
        const status = ed.getStatus();
        if (status.saving) { setSaveState("Salvataggio…"); return; }
        if (!status.dirty) { setSaveState("Salvato"); return; }
        setSaveState("Modifiche non salvate");
        clearTimeout(timer);
        // Autosalvataggio: dopo una pausa; un salvataggio in corso riprogramma il prossimo.
        timer = setTimeout(function flush() {
          if (closed) return;
          if (ed.getStatus().saving) { timer = setTimeout(flush, 400); return; }
          ed.save().then(() => refresh()).catch(() => setSaveState("Salvataggio non riuscito"));
        }, 800);
      },
    });
    editor.current = ed;
    setEd(ed);
    setSaveState("Salvato");
    return () => {
      closed = true; clearTimeout(timer);
      // Ultimo salvataggio "best effort" prima di chiudere.
      if (ed.getStatus().dirty && !ed.getStatus().saving) ed.save().catch(() => {});
      ed.destroy(); editor.current = null; setEd(null);
    };
  }, [current, refresh, loadLevels]);

  // Vista della soluzione: copia di sola lettura sovrapposta alla mappa dello studente.
  useEffect(() => {
    if (!overlay || !overlayHost.current) return;
    const view = mount(overlayHost.current, { document: overlay, readOnly: true });
    return () => view.destroy();
  }, [overlay]);

  async function open(id: string) {
    setLevels([]); setOverlay(null);
    if (!id) { setCurrent(null); return; }
    setError(""); setSource(null);
    try {
      const { map } = await json<{ map: MapDoc }>(`/api/maps/${encodeURIComponent(id)}`);
      await loadLevels(map.id);
      setCurrent(map);
    } catch (e) { setError(String(e)); }
  }

  async function generate() {
    if (!domainId || !topic.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const { map } = await json<{ map: MapDoc }>(buildMode ? "/api/maps/exercise" : "/api/maps", { method: "POST", body: JSON.stringify({ domainId, topic: topic.trim() }) });
      setTopic(""); await refresh(); setLevels([]); setOverlay(null);
      if (buildMode) await loadLevels(map.id);
      setCurrent(map);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!current || !confirm(`Eliminare la mappa «${current.title}»?`)) return;
    const id = current.id;
    setCurrent(null); setLevels([]); setOverlay(null);
    await json(`/api/maps/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }).catch((e) => setError(String(e)));
    await refresh();
  }

  function exportSvg() {
    const e = editor.current;
    if (e) download(`${e.getDocument().title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 80) || "mappa"}.svg`, e.exportSvg(), "image/svg+xml");
  }

  return (
    <div style={S.wrap}>
      <div style={S.bar}>
        <select value={current?.id ?? ""} onChange={(e) => open(e.target.value)} style={{ ...S.input, maxWidth: 280 }} disabled={!domainId}>
          <option value="">{maps.length ? "Apri una mappa…" : "Nessuna mappa salvata"}</option>
          {maps.map((m) => <option key={m.id} value={m.id}>{m.exercise ? "✎ " : ""}{m.title}</option>)}
        </select>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") generate(); }}
          placeholder="Nuova mappa su un argomento…" style={{ ...S.input, flex: 1, minWidth: 200 }} disabled={!domainId || busy} />
        <label style={S.check}><input type="checkbox" checked={buildMode} onChange={(e) => setBuildMode(e.target.checked)} disabled={!domainId || busy} /> Costruisci tu</label>
        <button onClick={generate} disabled={!domainId || busy || !topic.trim()} style={S.primary}>
          {busy ? <><span className="spin" /> genero…</> : buildMode ? "Crea esercizio" : "Genera mappa"}
        </button>
        {current && <>
          <span style={S.status}>{saveState}</span>
          <button onClick={exportSvg} style={S.ghost}>Esporta SVG</button>
          <button onClick={remove} style={{ ...S.ghost, color: "var(--color-danger)" }}>Elimina</button>
        </>}
      </div>
      {error && <div style={S.error}>{error}</div>}

      {source && (
        <div style={S.source}>
          <div style={S.sourceHead}>
            <span style={{ color: "var(--muted)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {source.kind} · {source.label}{source.video ? ` · ▶ ${mmss(source.video.startSec)}` : ""}
            </span>
            <button onClick={() => setSource(null)} style={S.x}>✕</button>
          </div>
          {source.video
            ? <video key={source.video.path + source.video.startSec} src={`/api/video?path=${encodeURIComponent(source.video.path)}#t=${source.video.startSec}`}
                controls autoPlay style={{ width: "100%", maxHeight: 300, borderRadius: 8, background: "var(--bg)" }} />
            : null}
          <div style={S.snippet}>{source.snippet}</div>
        </div>
      )}

      {current
        ? <div style={S.studio}>
            <div ref={host} style={{ ...S.host, display: overlay ? "none" : undefined }} />
            {overlay && <div ref={overlayHost} style={S.host} />}
            {ed && levels.length > 0 && current && domainId && (
              <MapExercise editor={ed} mapId={current.id} domainId={domainId} levels={levels}
                onLevelsChange={() => loadLevels(current.id).catch((e) => setError(String(e)))}
                overlay={!!overlay} onShowSolution={setOverlay} onCloseSolution={() => setOverlay(null)} />
            )}
          </div>
        : <div style={S.empty}>
            {busy ? <><span className="spin" /> Leggo il materiale e costruisco la mappa…</>
              : "Scrivi un argomento per generare una mappa dal materiale, oppure apri una mappa salvata. Doppio clic su una bolla per entrarci: il dettaglio viene generato dal materiale la prima volta che entri. Con «Costruisci tu» vedi solo i concetti: le relazioni le tracci tu, poi le verifichi."}
          </div>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 },
  bar: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  input: { background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px" },
  primary: { background: "var(--accent-2)", color: "var(--button-ink)", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 600 },
  ghost: { background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 12px" },
  status: { color: "var(--muted)", fontSize: 12, marginLeft: "auto" },
  error: { color: "var(--color-danger)", fontSize: 13 },
  studio: { flex: 1, minHeight: 0, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" },
  check: { display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 13 },
  host: { flex: "1 1 520px", minWidth: 0, minHeight: 520 },
  empty: { color: "var(--muted)", textAlign: "center", margin: "auto", maxWidth: 520, lineHeight: 1.6 },
  source: { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 10 },
  sourceHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 },
  snippet: { fontSize: 13, color: "var(--muted)", lineHeight: 1.55, maxHeight: 140, overflowY: "auto", whiteSpace: "pre-wrap", marginTop: 8 },
  x: { background: "transparent", border: "none", color: "var(--muted)", fontSize: 14 },
};
