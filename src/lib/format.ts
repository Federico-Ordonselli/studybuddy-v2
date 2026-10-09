/** Formati per la UI (date relative, saluto): puri, usati da server e client. */

/** "ora", "5 min fa", "3 h fa", "2 g fa", oltre una settimana la data ("9 set"). */
export function relativeTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const min = Math.round((now.getTime() - date.getTime()) / 60000);
  if (min < 1) return "ora";
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h fa`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} g fa`;
  return date.toLocaleDateString("it-IT", { day: "numeric", month: "short" }).replace(".", "");
}

export function greeting(hour: number): string {
  if (hour < 6) return "Buonanotte";
  if (hour < 12) return "Buongiorno";
  if (hour < 18) return "Buon pomeriggio";
  return "Buonasera";
}

/** "venerdì 9 ottobre". */
export function todayLabel(d = new Date()): string {
  return d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
}
