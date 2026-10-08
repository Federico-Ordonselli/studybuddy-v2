/** Modalità dell'area studio, nell'URL (`?mode=`) così Indietro/ricarica/link funzionano. */
export type UrlMode = "tutor" | "quiz" | "review" | "studio";

export const MODES: { key: UrlMode; label: string }[] = [
  { key: "tutor", label: "Tutor" },
  { key: "quiz", label: "Quiz" },
  { key: "review", label: "Ripasso" },
  { key: "studio", label: "Studio" },
];

export function parseMode(v: unknown): UrlMode {
  return typeof v === "string" && MODES.some((m) => m.key === v) ? (v as UrlMode) : "tutor";
}
