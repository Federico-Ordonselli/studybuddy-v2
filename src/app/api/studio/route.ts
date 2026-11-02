import { handle } from "@/lib/http";
import { listLessons } from "@/lib/studio";

export const runtime = "nodejs";

/** Lezioni audio Full Studio registrate, con avanzamento. */
export function GET() {
  return handle(() => ({ lessons: listLessons() }));
}
