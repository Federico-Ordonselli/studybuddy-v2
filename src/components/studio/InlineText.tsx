/** Solo `codice` e **grassetto**: React fa l'escape di tutto il resto. */
export function InlineText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 1 ? <code key={i} className="font-mono text-[0.9em]">{part.slice(1, -1)}</code>
        : part.startsWith("**") && part.endsWith("**") && part.length > 3 ? <strong key={i}><InlineText text={part.slice(2, -2)} /></strong>
        : part,
      )}
    </>
  );
}
