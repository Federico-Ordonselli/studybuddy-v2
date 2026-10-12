import { after } from "next/server";
import { createJob, latestJob, listMaterials, listModules, retryJob, runJob } from "@/lib/autogenerate";
import { badJson, handle, readJson } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  return handle(() => {
    const id = Number(new URL(req.url).searchParams.get("domainId"));
    return {modules:listModules(id),materials:listMaterials(id),job:latestJob(id)};
  });
}
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return badJson();
  return handle(() => {
    const id = Number(body.domainId);
    const job = body.retry === true ? retryJob(id) : createJob(id,body.modules,body.kinds);
    after(() => runJob(job));
    return {job};
  });
}
