import { NextRequest, NextResponse } from "next/server";
import { createJob, getJob } from "@/lib/jobs";
import { ingestSelection } from "@/lib/ingestTree";

export const runtime = "nodejs";

/** Avvia l'ingestione (background) di una o più cartelle. Ritorna un jobId. */
export async function POST(req: NextRequest) {
  const { paths, whisper } = await req.json();
  if (!Array.isArray(paths) || !paths.length) {
    return NextResponse.json({ error: "paths richiesto" }, { status: 400 });
  }
  const job = createJob();
  // fire-and-forget: l'ingestione prosegue nel processo, il client fa polling su GET.
  ingestSelection(paths, { whisper: !!whisper, report: (courses) => { job.courses = courses; } })
    .then((courses) => { job.courses = courses; job.status = "done"; })
    .catch((e) => { job.status = "error"; job.error = String(e); });
  return NextResponse.json({ jobId: job.id });
}

/** Stato del job di ingestione. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("job");
  const job = id ? getJob(id) : undefined;
  if (!job) return NextResponse.json({ error: "job non trovato" }, { status: 404 });
  return NextResponse.json(job);
}
