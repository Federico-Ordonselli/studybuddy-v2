/** Fiducia prima della risposta (Fase 6): 1 «Non sicuro» · 2 «Abbastanza» · 3 «Sicuro». */
export type Confidence = 1 | 2 | 3;

export interface ConfidenceKey { key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; typing: boolean }

/**
 * Scorciatoie della fiducia: 1/2/3 fuori dai campi di testo; mentre scrivi la risposta Alt+1/2/3
 * (letto dal tasto fisico, perché con Alt alcune tastiere producono un altro carattere). Ctrl/Meta restano al browser.
 */
export function confidenceFromKey(e: ConfidenceKey): Confidence | null {
  if (e.ctrlKey || e.metaKey) return null;
  const digit = e.altKey ? /^(?:Digit|Numpad)([1-3])$/.exec(e.code)?.[1] : e.typing ? undefined : /^[1-3]$/.exec(e.key)?.[0];
  return digit ? (Number(digit) as Confidence) : null;
}
