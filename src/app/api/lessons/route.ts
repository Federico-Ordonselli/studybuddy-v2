import { NextRequest } from "next/server";
import { listLessons } from "@/lib/lessonStudy";
import { handle } from "@/lib/http";
import { positiveId } from "@/lib/validation";

export const runtime = "nodejs";
export function GET(req: NextRequest) {
  return handle(() => ({ lessons: listLessons(positiveId(Number(req.nextUrl.searchParams.get("domainId")), "domainId", true)!) }));
}
