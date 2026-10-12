import { S } from "./styles";
import { mmss, type PlayingVideo } from "./types";

/** Player del video sorgente, aperto al secondo della citazione. */
export default function VideoPanel({ video, onClose }: { video: PlayingVideo | null; onClose: () => void }) {
  if (!video) return null;
  return (
    <div style={S.player}>
      <div style={S.playerHead}>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>▶ {video.label} · {mmss(video.startSec)}</span>
        <button onClick={onClose} style={S.x} aria-label="Chiudi il video">✕</button>
      </div>
      <video key={video.path + video.startSec}
        src={`/api/video?path=${encodeURIComponent(video.path)}#t=${video.startSec}`}
        controls autoPlay style={{ width: "100%", borderRadius: 8, background: "var(--bg)" }} />
    </div>
  );
}
