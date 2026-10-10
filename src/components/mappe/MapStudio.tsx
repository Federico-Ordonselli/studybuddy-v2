"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mount, type MapDoc, type MapEditor, type SourceRef } from "./editor.js";
import { download } from "./dom.js";

interface MapSummary { id: string; title: string; revision: number; updatedAt: number }
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

  // Cambio dominio: chiude la mappa aperta e ricarica l'elenco.
  useEffect(() => {
    setCurrent(null); setSource(null); setError("");
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
        expandConcept: (req) =>
          json("/api/maps/expand", {
            method: "POST",
            body: JSON.stringify({ domainId: domainRef.current, concept: req.concept, path: req.path, existing: req.existing, present: req.present }),
          }),
        resolveSource: async (ref: SourceRef) => {
          const { citation } = await json<{ citation: SourceView }>(`/api/maps/source?chunkId=${encodeURIComponent(ref.chunkId)}`);
          setSource(citation);
        },
        requestQuiz: async (req) => {
          const { created } = await json<{ created: number }>("/api/cards", {
            method: "POST", body: JSON.stringify({ domainId: domainRef.current, topic: req.concepts[0].title, n: 3 }),
          });
          return created ? `${created} carte su «${req.concepts[0].title}» aggiunte al Ripasso.` : "Nessuna carta generata da questo concetto.";
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
    setSaveState("Salvato");
    return () => {
      closed = true; clearTimeout(timer);
      // Ultimo salvataggio "best effort" prima di chiudere.
      if (ed.getStatus().dirty && !ed.getStatus().saving) ed.save().catch(() => {});
      ed.destroy(); editor.current = null;
    };
  }, [current, refresh]);

  async function open(id: string) {
    if (!id) { setCurrent(null); return; }
    setError(""); setSource(null);
    try { setCurrent((await json<{ map: MapDoc }>(`/api/maps/${encodeURIComponent(id)}`)).map); }
    catch (e) { setError(String(e)); }
  }

  async function generate() {
    if (!domainId || !topic.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const { map } = await json<{ map: MapDoc }>("/api/maps", { method: "POST", body: JSON.stringify({ domainId, topic: topic.trim() }) });
      setTopic(""); await refresh(); setCurrent(map);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!current || !confirm(`Eliminare la mappa «${current.title}»?`)) return;
    const id = current.id;
    setCurrent(null);
    await json(`/api/maps/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }).catch((e) => setError(String(e)));
    await refresh();
  }

  function exportSvg() {
    const ed = editor.current;
    if (ed) download(`${ed.getDocument().title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 80) || "mappa"}.svg`, ed.exportSvg(), "image/svg+xml");
  }

  return (
    <div style={S.wrap}>
      <div style={S.bar}>
        <select value={current?.id ?? ""} onChange={(e) => open(e.target.value)} style={{ ...S.input, maxWidth: 280 }} disabled={!domainId}>
          <option value="">{maps.length ? "Apri una mappa…" : "Nessuna mappa salvata"}</option>
          {maps.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") generate(); }}
          placeholder="Nuova mappa su un argomento…" style={{ ...S.input, flex: 1, minWidth: 200 }} disabled={!domainId || busy} />
        <button onClick={generate} disabled={!domainId || busy || !topic.trim()} style={S.primary}>
          {busy ? <><span className="spin" /> genero…</> : "Genera mappa"}
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
        ? <div ref={host} style={S.host} />
        : <div style={S.empty}>
            {busy ? <><span className="spin" /> Leggo il materiale e costruisco la mappa…</>
              : "Scrivi un argomento per generare una mappa dal materiale, oppure apri una mappa salvata. Doppio clic su una bolla per entrarci: il dettaglio viene generato dal materiale la prima volta che entri."}
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
  host: { flex: 1, minHeight: 520 },
  empty: { color: "var(--muted)", textAlign: "center", margin: "auto", maxWidth: 520, lineHeight: 1.6 },
  source: { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 10 },
  sourceHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 },
  snippet: { fontSize: 13, color: "var(--muted)", lineHeight: 1.55, maxHeight: 140, overflowY: "auto", whiteSpace: "pre-wrap", marginTop: 8 },
  x: { background: "transparent", border: "none", color: "var(--muted)", fontSize: 14 },
};
