"use client";

/** Mini renderer markdown: titoletti (##/###), bullet (-/*), grassetto **…**. */
export default function Markdown({ text }: { text: string }) {
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>);
  const lines = text.split("\n");
  return (
    <div style={{ lineHeight: 1.6 }}>
      {lines.map((l, i) => {
        const t = l.trim();
        if (/^#{1,6}\s/.test(t)) return <h3 key={i} style={{ margin: "14px 0 6px", color: "var(--accent)", fontSize: "1.17em", fontWeight: 700 }}>{t.replace(/^#{1,6}\s/, "")}</h3>;
        if (/^[-*]\s/.test(t)) return <div key={i} style={{ paddingLeft: 16 }}>• {bold(t.replace(/^[-*]\s/, ""))}</div>;
        if (!t) return <div key={i} style={{ height: 6 }} />;
        return <p key={i} style={{ margin: "4px 0" }}>{bold(t)}</p>;
      })}
    </div>
  );
}
