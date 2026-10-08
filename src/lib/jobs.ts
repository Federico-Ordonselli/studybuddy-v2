import type { CourseProgress } from "@/lib/ingestTree";

/**
 * Registro job in-memory per l'ingestione in background. Next gira in un singolo
 * processo (dev e `next start`), quindi lo stato del modulo persiste tra le richieste.
 */
export interface IngestJob {
  id: string;
  status: "running" | "done" | "error";
  courses: CourseProgress[];
  error?: string;
  startedAt: number;
}

const jobs = new Map<string, IngestJob>();

export function createJob(): IngestJob {
  const id = Math.random().toString(36).slice(2, 10);
  const job: IngestJob = { id, status: "running", courses: [], startedAt: Date.now() };
  jobs.set(id, job);
  // GC dei job vecchi (oltre 1h)
  for (const [k, j] of jobs) if (Date.now() - j.startedAt > 3600_000) jobs.delete(k);
  return job;
}

export function getJob(id: string): IngestJob | undefined {
  return jobs.get(id);
}

/** Il job di ingestione in corso, se c'è: se ne esegue uno alla volta (stesso DB). */
export function activeJob(): IngestJob | undefined {
  for (const j of jobs.values()) if (j.status === "running") return j;
  return undefined;
}
