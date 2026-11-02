import { NextRequest } from "next/server";
import { handleAsync } from "@/lib/http";
import { quizPool } from "@/lib/studio";
import { positiveId } from "@/lib/validation";

export const runtime = "nodejs";

/** Domande sulle sezioni già ascoltate (`?id=&n=`). */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return handleAsync(async () => ({ questions: await quizPool(positiveId(Number(p.get("id")), "id", true)!, Number(p.get("n") ?? 10)) }));
}
