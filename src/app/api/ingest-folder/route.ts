import { NextRequest, NextResponse } from "next/server";
import { activeJob, createJob, getJob } from "@/lib/jobs";
import { applyPlan, parsePlan, runPlan } from "@/lib/ingestTree";
import { LibraryError } from "@/lib/library";

export const runtime = "nodejs";

/** Avvia l'import (background) di un piano esplicito costruito dall'anteprima. Ritorna un jobId. */
export async function POST(req: NextRequest) {
  const { plan } = await req.json();
  if (activeJob()) return NextResponse.json({ error: "c'è già un import in corso" }, { status: 409 });
  let steps;
  try {
    const p = parsePlan(plan);
    steps = applyPlan(p);
    if (!steps.length) return NextResponse.json({ error: "nessun corso selezionato" }, { status: 400 });
    const job = createJob();
    // fire-and-forget: l'ingestione prosegue nel processo, il client fa polling su GET.
    runPlan(steps, { whisper: p.whisper, report: (courses) => { job.courses = courses; } })
      .then((courses) => { job.courses = courses; job.status = "done"; })
      .catch((e) => { job.status = "error"; job.error = String(e); });
    return NextResponse.json({ jobId: job.id });
  } catch (e) {
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Stato di un job (`?job=`) o il job attivo (`?active=1`). */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("active")) return NextResponse.json({ job: activeJob() ?? null });
  const id = req.nextUrl.searchParams.get("job");
  const job = id ? getJob(id) : undefined;
  if (!job) return NextResponse.json({ error: "job non trovato" }, { status: 404 });
  return NextResponse.json(job);
}
