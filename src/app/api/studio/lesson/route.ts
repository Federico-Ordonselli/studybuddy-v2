import { NextRequest } from "next/server";
import { handleAsync } from "@/lib/http";
import { getLesson } from "@/lib/studio";
import { positiveId } from "@/lib/validation";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return handleAsync(() => getLesson(positiveId(Number(req.nextUrl.searchParams.get("id")), "id", true)!));
}
