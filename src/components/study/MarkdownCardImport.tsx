"use client";
import { useState } from "react";
import { post } from "@/lib/client/api";
import { parseMarkdownCards } from "@/lib/importers/markdownCards";
import { S } from "./styles";

export default function MarkdownCardImport({ domainId, onDone }: { domainId: number; onDone: (message: string) => Promise<void> }) {
  const [file, setFile] = useState<{ name: string; markdown: string; count: number } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0); // svuota il campo file dopo l'import
  return <details style={{ ...S.card, marginTop: 20 }}>
    <summary>Importa domande e risposte da Markdown</summary>
    <p>Una carta per ogni domanda numerata in grassetto, con risposta integrale. Nessuna riscrittura AI. Dopo l’importazione puoi rispondere e usare il giudicatore nel Ripasso.</p>
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
    <input key={inputKey} type="file" accept=".md,.markdown,text/markdown" aria-label="File Markdown con domande e risposte" disabled={busy}
      onChange={async (event) => {
        const selected = event.target.files?.[0];
        setFile(null); setMessage("");
        if (!selected) return;
        setBusy(true);
        try {
          if (selected.size > 8_000_000) throw new Error("File troppo grande.");
          const markdown = await selected.text();
          setFile({ name: selected.name, markdown, count: parseMarkdownCards(markdown).length });
        } catch (error) { setMessage(error instanceof Error ? error.message : "Lettura non riuscita"); }
        finally { setBusy(false); }
      }} />
    <button style={S.send} disabled={busy || !file} onClick={async () => {
      if (!file || busy) return;
      setBusy(true); setMessage("");
      try {
        const result = await post<{ created: number; skipped: number }>("/api/cards", { domainId, markdown: file.markdown });
        setFile(null); setInputKey((k) => k + 1);
        await onDone(`Importate ${result.created} carte; ${result.skipped} duplicati saltati.`);
      } catch (error) { setMessage(error instanceof Error ? error.message : "Importazione non riuscita"); }
      finally { setBusy(false); }
    }}>{busy ? "Lettura/importazione…" : "Importa nel corso"}</button>
    </div>
    {file && <p>{file.name}: {file.count} carte trovate. I duplicati già presenti verranno saltati.</p>}
    {message && <p role="alert">{message}</p>}
  </details>;
}
