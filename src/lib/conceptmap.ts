import { generate } from "@/lib/providers";
import { vectorSearch } from "@/lib/rag/store";

/** Mappa concettuale: nodi (concetti) + archi (relazioni etichettate). */
export interface ConceptNode { id: string; label: string }
export interface ConceptEdge { from: string; to: string; label?: string }
export interface ConceptMap { nodes: ConceptNode[]; edges: ConceptEdge[] }

const SCHEMA = {
  type: "object",
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, label: { type: "string" } },
        required: ["id", "label"],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" } },
        required: ["from", "to"],
      },
    },
  },
  required: ["nodes", "edges"],
} as const;

export async function conceptMap(domainId: number, topic: string): Promise<ConceptMap> {
  const found = await vectorSearch(topic, 16, domainId);
  if (!found.length) return { nodes: [], edges: [] };
  const ctx = found.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n");

  const raw = await generate("summarize", {
    system:
      "Estrai una mappa concettuale dal materiale fornito. " +
      "nodes = concetti chiave (max 12, `id` corto in snake_case, `label` leggibile); " +
      "il PRIMO nodo è il concetto centrale. edges = relazioni tra nodi con `label` breve (un verbo/relazione). " +
      "Usa SOLO `id` esistenti negli archi. Basati ESCLUSIVAMENTE sul materiale. Lingua: quella del materiale.",
    json: true,
    schema: SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.3,
    maxTokens: 1200,
    messages: [{ role: "user", content: `Argomento: ${topic}\n\nMateriale:\n${ctx}` }],
  });

  try {
    const m = JSON.parse(raw) as ConceptMap;
    const nodes = (m.nodes ?? []).filter((n) => n.id && n.label);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (m.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
    return { nodes, edges };
  } catch {
    return { nodes: [], edges: [] };
  }
}
