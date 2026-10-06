import { NextRequest, NextResponse } from "next/server";
import { createJob, getJob } from "@/lib/jobs";
import { ingestSelection } from "@/lib/ingestTree";
import { insideRoot } from "@/lib/fsRoot";

export const runtime = "nodejs";

/** Avvia l'ingestione (background) di una o più cartelle. Ritorna un jobId. */
export async function POST(req: NextRequest) {
  const { paths, whisper } = await req.json();
  if (!Array.isArray(paths) || !paths.length) {
    return NextResponse.json({ error: "paths richiesto" }, { status: 400 });
  }
  // stessa sandbox del browser cartelle: niente ingestione di /etc, ~/.ssh fuori root, ecc.
  const safePaths = paths.map((p) => (typeof p === "string" ? insideRoot(p) : null));
  if (safePaths.some((p) => p === null)) {
    return NextResponse.json({ error: "percorso fuori dalla root consentita" }, { status: 403 });
  }
  const job = createJob();
  // fire-and-forget: l'ingestione prosegue nel processo, il client fa polling su GET.
  ingestSelection(safePaths as string[], { whisper: !!whisper, report: (courses) => { job.courses = courses; } })
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
