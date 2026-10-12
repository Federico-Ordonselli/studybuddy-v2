import { S } from "./styles";
import { mmss, type Citation, type PlayingVideo } from "./types";

/** Pillola di una citazione; se il passaggio viene da una trascrizione apre il video al minuto. */
export default function CitationChip({ c, onPlay }: { c: Citation; onPlay: (v: PlayingVideo) => void }) {
  return (
    <button title={c.snippet}
      onClick={() => c.video && onPlay({ path: c.video.path, startSec: c.video.startSec, label: c.label })}
      style={{ ...S.cite, cursor: c.video ? "pointer" : "default" }}>
      <span style={S.citeN}>[{c.n}]</span>
      <span style={{ color: "var(--muted)" }}>{c.kind}</span>
      <span style={S.citeLabel}>{c.label}</span>
      {c.video && <span style={S.citePlay}>▶ {mmss(c.video.startSec)}</span>}
    </button>
  );
}
