"use client";

import { useEffect, useState } from "react";
import MapStudio from "@/components/mappe/MapStudio";
import { post } from "@/lib/client/api";
import Markdown from "./Markdown";
import { S } from "./styles";
import type { SlideT } from "./types";

type Tool = "summary" | "map" | "slides";

export default function StudioView({ domainId, onWide, onAskTutor }: { domainId: number; onWide: (wide: boolean) => void; onAskTutor: (text: string) => void }) {
  const [topic, setTopic] = useState("");
  const [tool, setTool] = useState<Tool | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [slides, setSlides] = useState<SlideT[] | null>(null);

  useEffect(() => { onWide(tool === "map"); }, [tool, onWide]);

  async function run(t: Tool) {
    // La mappa ha il suo editor (elenco, generazione, salvataggio): basta aprirlo.
    if (t === "map") { setTool(t); setSummary(null); setSlides(null); return; }
    if (!topic.trim() || !domainId || loading) return;
    setTool(t); setLoading(true); setSummary(null); setSlides(null);
    try {
      if (t === "summary") setSummary((await post<{ summary: string }>("/api/summarize", { domainId, topic })).summary);
      else {
        const r = await post<{ slides: SlideT[] }>("/api/slides", { domainId, topic, n: 4 });
        setSlides(r.slides);
        void loadImages(r.slides);
      }
    } catch (e) {
      if (t === "summary") setSummary(`Errore: ${e}`);
    } finally { setLoading(false); }
  }

  // Immagini lazy, una per slide: il deck è già visibile mentre si riempiono.
  async function loadImages(ss: SlideT[]) {
    for (let i = 0; i < ss.length; i++) {
      try {
        const r = await post<{ image: { format: string; content: string } }>("/api/slides/image", { prompt: ss[i].imagePrompt || ss[i].title });
        setSlides((prev) => { if (!prev) return prev; const c = [...prev]; c[i] = { ...c[i], image: r.image }; return c; });
      } catch { /* slide senza immagine */ }
    }
  }

  const tools: [Tool, string][] = [["summary", "Riassunto"], ["map", "Mappa concettuale"], ["slides", "Slide"]];

  return (
    <div style={S.review}>
      <div style={S.reviewBar}>
        {tool !== "map" && <input value={topic} onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && tool) run(tool); }}
          placeholder="Argomento da studiare…" style={{ ...S.select, flex: 1, minWidth: 220 }} disabled={!domainId} />}
        {tools.map(([t, label]) => (
          <button key={t} onClick={() => run(t)} disabled={loading || !domainId || (t !== "map" && !topic.trim())}
            style={{ ...S.tab, border: "1px solid var(--border)", borderRadius: 8, ...(tool === t ? S.tabActive : {}) }}>
            {label}
          </button>
        ))}
      </div>

      {loading && <div style={{ ...S.empty, marginTop: 24 }}><span className="spin" /> {tool === "slides" ? "genero le slide…" : "riassumo il materiale…"}</div>}

      {!loading && !tool && <div style={S.empty}>Scrivi un argomento e scegli uno strumento: riassunto map-reduce o slide con immagini generate. La mappa concettuale si esplora entrando nelle bolle.</div>}

      {summary !== null && <div style={S.card}><Markdown text={summary} /></div>}
      {tool === "map" && <MapStudio domainId={domainId} onAskTutor={onAskTutor} />}
      {slides !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {slides.map((s, i) => (
            <div key={i} style={S.card}>
              <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 280px" }}>
                  <div style={S.badge}>Slide {i + 1}</div>
                  <h3 style={{ margin: "2px 0 10px", fontSize: "1.17em", fontWeight: 700 }}>{s.title}</h3>
                  <ul className="list-disc" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    {s.bullets.map((b, k) => <li key={k}>{b}</li>)}
                  </ul>
                </div>
                <div style={S.slideImg} className="slide-img">
                  {s.image
                    ? (s.image.format === "svg"
                        // come <img> il browser non esegue script/handler dell'SVG generato dall'LLM
                        ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.image.content)}`} alt={s.title} />
                        : <img src={s.image.content} alt={s.title} />)
                    : <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--muted)", fontSize: 13 }}><span className="spin" /> &nbsp;immagine…</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
