/** Classi CSS condizionali (i componenti SF6 del vault usano solo stringhe e ternari). */
export function cn(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}
