import { NextRequest } from "next/server";
import { readLesson } from "@/lib/lessonStudy";
import { handle } from "@/lib/http";
import { positiveId } from "@/lib/validation";

export const runtime = "nodejs";
export function GET(req: NextRequest) {
  return handle(() => readLesson(
    positiveId(Number(req.nextUrl.searchParams.get("domainId")), "domainId", true)!,
    positiveId(Number(req.nextUrl.searchParams.get("documentId")), "documentId", true)!));
}
