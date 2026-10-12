"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, post } from "@/lib/client/api";
import type { Job, Kind, Material, Module } from "@/lib/autogenerate";
import Markdown from "./Markdown";
const labels: Record<Kind,string> = {cards:"Schede di studio",flashcards:"Flashcard",map:"Mappe",summary:"Riassunti",glossary:"Glossario"};
interface Data {modules:Module[];materials:Material[];job:Job|null}
export default function AutoGenerate({domainId,onMap,onAskTutor}:{domainId:number;onMap:()=>void;onAskTutor:(text:string)=>void}) {
  const [data,setData] = useState<Data|null>(null);
  const [open,setOpen] = useState(false);
  const [keys,setKeys] = useState<string[]>([]);
  const [kinds,setKinds] = useState<Kind[]>(Object.keys(labels) as Kind[]);
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await api<Data>("GET",`/api/autogenerate?domainId=${domainId}`);
        if (!stopped) { setData(result); timer=setTimeout(refresh,result.job?.status === "running" ? 2000 : 10000); }
      } catch(e) { if (!stopped) {setError(String(e));timer=setTimeout(refresh,10000);} }
    }
    void refresh();
    return () => {stopped=true;clearTimeout(timer);};
  },[domainId]);
  async function start(retry=false) {
    setBusy(true);setError("");
    try {
      const result=await post<{job:Job}>("/api/autogenerate",{domainId,modules:keys,kinds,retry});
      setData(d => d ? {...d,job:result.job}:d);setOpen(false);
    } catch(e) {setError(String(e));} finally {setBusy(false);}
  }
  const job=data?.job;
  const completed=job?.steps.filter(s => s.status !== "pending").length ?? 0;
  const errors=job?.steps.filter(s => s.status === "error") ?? [];
  const materials=data?.materials.filter(m => (!filter || m.kind === filter) && `${m.module} ${m.content}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <section className="border border-border rounded-lg p-4 mb-5 space-y-3">
    <div className="flex flex-wrap justify-between gap-3 items-center"><h2 className="font-display text-xl">Materiali del corso</h2><button className="border border-border rounded-md px-3 py-2" onClick={()=>setOpen(!open)}>Autogenera</button></div>
    {error && <p role="alert">{error}</p>}
    {open && <div className="space-y-3">
      <p>1. Scegli cosa generare</p><div className="flex flex-wrap gap-4">{(Object.keys(labels) as Kind[]).map(k=><label key={k}><input type="checkbox" checked={kinds.includes(k)} onChange={e=>setKinds(e.target.checked ? [...kinds,k]:kinds.filter(v=>v!==k))}/> {labels[k]}</label>)}</div>
      <p>2. Scegli i moduli</p>
      {!data?.modules.length && <p>Importa prima il corso da <Link href="/corsi/add" className="underline">Aggiungi corso</Link>.</p>}
      <button className="underline" onClick={()=>setKeys(data?.modules.map(m=>m.key) ?? [])}>Tutto il corso</button> <button className="underline" onClick={()=>setKeys([])}>Deseleziona</button>
      <div className="max-h-56 overflow-auto space-y-2">{data?.modules.map(m=><label className="block" key={m.key}><input type="checkbox" checked={keys.includes(m.key)} onChange={e=>setKeys(e.target.checked ? [...keys,m.key]:keys.filter(k=>k!==m.key))}/> {m.label}</label>)}</div>
      <p className="text-sm text-fg-muted">{keys.length} moduli × {kinds.length} materiali. I materiali vengono salvati per modulo; rigenerare aggiorna quelli esistenti. Le flashcard duplicate vengono saltate.</p>
      <button className="bg-accent text-bg rounded-md px-4 py-2" disabled={busy || !keys.length || !kinds.length || job?.status === "running"} onClick={()=>start()}>Genera materiali</button>
    </div>}
    {job && <div aria-live="polite">
      <p>{job.status === "running" ? "Generazione in corso" : errors.length ? "Generazione terminata con errori" : "Generazione completata"} · {completed}/{job.steps.length} passaggi</p>
      <progress className="w-full" max={job.steps.length} value={completed} aria-label="Avanzamento generazione"/>
      {job.status === "running" && <p className="text-sm text-fg-muted">{job.steps.find(s=>s.status === "pending")?.label} · l’avanzamento è per materiale, i tempi dipendono dal modello. Puoi cambiare pagina.</p>}
      {errors.map((s,i)=><p key={i} className="text-sm">{s.label} · {labels[s.kind]}: {s.error}</p>)}
      {(errors.length>0 || job.status === "running") && <button className="underline" disabled={busy} onClick={()=>start(true)}>Riprendi / riprova i passaggi incompleti</button>}
    </div>}
    <div className="flex flex-wrap gap-2"><input className="bg-surface border border-border rounded-md px-3 py-2 flex-1 min-w-40" aria-label="Cerca nei materiali" placeholder="Cerca nei materiali generati…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Tipo di materiale" className="bg-surface border border-border rounded-md px-2" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Tutti i materiali</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
    {!materials.length && <p className="text-sm text-fg-muted">{data?.materials.length ? "Nessun risultato." : "Genera il corso per ritrovare qui schede, mappe, riassunti e glossario."}</p>}
    {materials.map(m=><details key={m.id} className="border border-border rounded-md p-3"><summary className="cursor-pointer">{labels[m.kind]} · {m.module || "Materiale generale"}</summary><div className="pt-3 space-y-3">{m.kind === "map" ? <button className="underline" onClick={onMap}>Apri le mappe del corso</button> : <Markdown text={m.content}/>}<div className="flex gap-4 flex-wrap"><button className="underline" onClick={()=>onAskTutor(`Aiutami a studiare ${query || m.module || "questo corso"}`)}>Chiedi al tutor</button><Link className="underline" href={`/study/${m.domainId}?mode=quiz&topic=${encodeURIComponent(query || m.module)}`}>Quiz al volo</Link><Link className="underline" href={`/study/${m.domainId}?mode=review`}>Ripassa le flashcard</Link></div></div></details>)}
  </section>;
}
