import { randomUUID } from "node:crypto";
import { sqlite } from "@/lib/db";
import { resolveScope, type Retrieved } from "@/lib/rag/store";
import { LibraryError } from "@/lib/errors";
import { mapReduceSummary } from "@/lib/summarize";
import { generate } from "@/lib/providers";
import { generateCardDrafts } from "@/lib/tutor/cardGen";
import { saveCards } from "@/lib/tutor/cards";
import { generateMap } from "@/lib/conceptmap";
import { getMap, saveMap } from "@/lib/mappe/store";

export const KINDS = ["cards", "flashcards", "map", "summary", "glossary"] as const;
export type Kind = typeof KINDS[number];
export interface Module { key: string; domainId: number; module: string; label: string }
export interface Step extends Module { kind: Kind; status: "pending" | "done" | "error"; error?: string }
export interface Job { id: string; domainId: number; status: "running" | "complete"; steps: Step[] }
export interface Material { id: string; domainId: number; module: string; kind: Kind; content: string }
const workers = new Set<string>();

function requireDomain(id: number) {
  if (!Number.isSafeInteger(id) || !sqlite.prepare("SELECT id FROM domains WHERE id = ?").get(id)) throw new LibraryError("Corso non trovato", 404);
}
export function listModules(id: number): Module[] {
  requireDomain(id);
  return (resolveScope(id) ?? [id]).flatMap(domainId => {
    const rows = sqlite.prepare(`SELECT DISTINCT coalesce(json_extract(d.meta, '$.module'), '') AS module, n.name
      FROM documents d JOIN chunks c ON c.document_id = d.id JOIN domains n ON n.id = d.domain_id
      WHERE d.domain_id = ? ORDER BY module`).all(domainId) as {module:string;name:string}[];
    return rows.map(r => ({ key: JSON.stringify([domainId,r.module]), domainId, module:r.module, label:`${r.name} · ${r.module || "Materiale generale"}` }));
  });
}
export function listMaterials(id: number): Material[] {
  requireDomain(id);
  return (resolveScope(id) ?? [id]).flatMap(domainId => sqlite.prepare("SELECT id, domain_id AS domainId, module, kind, content FROM study_materials WHERE domain_id = ? ORDER BY module, kind").all(domainId) as Material[]);
}
function persist(job: Job) {
  sqlite.prepare("INSERT INTO generation_jobs(id, domain_id, state) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state").run(job.id,job.domainId,JSON.stringify(job));
}
export function latestJob(id: number): Job | null {
  requireDomain(id);
  const row = sqlite.prepare("SELECT state FROM generation_jobs WHERE domain_id = ? ORDER BY rowid DESC LIMIT 1").get(id) as {state:string} | undefined;
  return row ? JSON.parse(row.state) : null;
}
export function createJob(id: number, keys: unknown, kinds: unknown): Job {
  const available = listModules(id);
  if (!Array.isArray(keys) || !keys.length || keys.some(k => typeof k !== "string" || !available.some(m => m.key === k))) throw new LibraryError("Seleziona moduli validi con materiale importato");
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(k => !KINDS.includes(k))) throw new LibraryError("Seleziona i materiali da generare");
  if (latestJob(id)?.status === "running") throw new LibraryError("Generazione già presente: riprendila",409);
  const job: Job = {id:randomUUID(),domainId:id,status:"running",steps:available.filter(m => keys.includes(m.key)).flatMap(m => [...new Set(kinds as Kind[])].map(kind => ({...m,kind,status:"pending" as const})))};
  persist(job); return job;
}
export function moduleChunks(step: Module): Retrieved[] {
  return (sqlite.prepare(`SELECT c.id AS chunkId, c.document_id AS documentId, c.content, c.meta, d.meta AS docMeta, d.source, d.kind AS docKind
    FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.domain_id = ? AND coalesce(json_extract(d.meta, '$.module'), '') = ? ORDER BY d.id, c.ordinal`).all(step.domainId,step.module) as (Omit<Retrieved,"meta"|"docMeta"|"distance"> & {meta:string|null;docMeta:string|null})[])
    .map(r => ({...r,distance:0,meta:r.meta ? JSON.parse(r.meta):undefined,docMeta:r.docMeta ? JSON.parse(r.docMeta):undefined}));
}
export async function generateStep(step: Step, summaries = new Map<string,string>()): Promise<void> {
  const chunks = moduleChunks(step);
  if (!chunks.length) throw new Error("Modulo senza materiale: reimporta il corso");
  const texts = chunks.map(c => c.content);
  let content = "";
  if (step.kind === "flashcards") {
    let created = 0, flagged = 0;
    for (let i=0;i<chunks.length;i+=6) {
      const batch = chunks.slice(i,i+6);
      const drafts = await generateCardDrafts(batch,{n:5});
      if (!drafts.length) throw new Error("Il modello non ha prodotto flashcard valide");
      // Senza anteprima: entrano solo le carte che passano il controllo di qualità (Fase 3).
      const valid = drafts.filter(d => !d.issues.length);
      const saved = valid.length ? saveCards(step.domainId,valid) : {created:0,skipped:0};
      created += saved.created; flagged += drafts.length - valid.length;
    }
    content = `${created} nuove flashcard aggiunte al ripasso. Saltate le domande già presenti${flagged ? ` e ${flagged} ${flagged === 1 ? "carta non atomica" : "carte non atomiche"}` : ""}.`;
  } else {
    const summary = summaries.get(step.key) ?? await mapReduceSummary(texts,step.module);
    if (!summary.trim()) throw new Error("Sintesi del modulo vuota");
    summaries.set(step.key,summary);
    if (step.kind === "summary") content = summary;
    else if (step.kind === "map") {
      // Sintesi di tutti i passaggi: copertura del modulo senza retrieval su altri moduli.
      const doc = await generateMap(step.domainId,step.module || "Materiale generale",Array.from({length:Math.ceil(summary.length/2500)},(_,i)=>({...chunks[0],content:summary.slice(i*2500,(i+1)*2500)})));
      // La sintesi non è una fonte primaria: evita citazioni attribuite al primo chunk.
      for (const concept of Object.values(doc.concepts) as {sourceRefs?:unknown[]}[]) concept.sourceRefs = [];
      const existing = sqlite.prepare("SELECT content FROM study_materials WHERE id = ?").get(JSON.stringify([step.domainId,step.module,step.kind])) as {content:string} | undefined;
      const previous = existing ? getMap(existing.content) : null;
      if (previous) { doc.id = previous.doc.id; doc.revision = previous.doc.revision; }
      const saved = saveMap(step.domainId,doc,doc.revision); content = saved.id;
    } else content = await generate("summarize",{
      system:step.kind === "glossary" ? "Crea un glossario in markdown: un titolo per termine, definizione ed esempio quando disponibile. Usa esclusivamente il materiale. Lingua del materiale." : "Crea schede di studio in markdown, una sezione per concetto: titolo, spiegazione, esempio e punti da ricordare. Usa esclusivamente il materiale. Lingua del materiale.",
      messages:[{role:"user",content:summary}],maxTokens:4000,temperature:0.3,
    });
  }
  if (!content.trim()) throw new Error("Risposta del modello vuota");
  const id = JSON.stringify([step.domainId,step.module,step.kind]);
  sqlite.prepare("INSERT INTO study_materials(id, domain_id, module, kind, content) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content").run(id,step.domainId,step.module,step.kind,content);
}
export async function runJob(job: Job, execute?: (step: Step) => Promise<void>) {
  if (workers.has(job.id)) return;
  workers.add(job.id);
  const summaries = new Map<string,string>();
  try {
    for (const step of job.steps) {
      if (step.status === "done") continue;
      step.status = "pending"; delete step.error; persist(job);
      try { await (execute ? execute(step) : generateStep(step,summaries)); step.status = "done"; }
      catch (e) { step.status = "error"; step.error = e instanceof Error ? e.message : "Generazione fallita"; }
      persist(job);
    }
    job.status = "complete"; persist(job);
  } finally { workers.delete(job.id); }
}
export function retryJob(id: number): Job {
  const job = latestJob(id);
  if (!job || job.steps.every(s => s.status === "done")) throw new LibraryError("Nessuna generazione da riprendere");
  if (workers.has(job.id)) throw new LibraryError("Generazione in corso",409);
  job.status = "running"; persist(job); return job;
}
