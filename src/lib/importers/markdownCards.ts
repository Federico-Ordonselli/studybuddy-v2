/** Estrazione letterale: ogni titolo numerato in grassetto apre una domanda. */
export function parseMarkdownCards(markdown: string): { question: string; answer: string }[] {
  if (typeof markdown !== "string" || markdown.length > 2_000_000) throw new Error("File Markdown troppo grande (massimo 2 milioni di caratteri).");
  const lines = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const cards: { question: string; answer: string }[] = [];
  let current: { question: string; lines: string[] } | undefined;
  let fence: string | undefined;
  const flush = () => {
    if (!current) return;
    const answer = current.lines.join("\n").trim();
    if (!answer) throw new Error(`Risposta mancante: ${current.question}`);
    if (current.question.length > 10000 || answer.length > 10000) throw new Error("Domanda o risposta oltre 10000 caratteri.");
    cards.push({ question: current.question, answer });
  };
  for (const line of lines) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && new RegExp(`^\\s{0,3}${marker}\\s*$`).test(line)) fence = undefined;
      current?.lines.push(line);
      continue;
    }
    const heading = !fence && /^\*\*\d+\.\s+(.+?)\*\*\s*$/.exec(line);
    if (heading) {
      flush();
      current = { question: heading[1].trim(), lines: [] };
    } else current?.lines.push(line);
  }
  flush();
  if (!cards.length) throw new Error("Nessuna coppia trovata. Formato atteso: **1. Domanda** seguito dalla risposta.");
  if (cards.length > 500) throw new Error("Massimo 500 carte per importazione.");
  return cards;
}
