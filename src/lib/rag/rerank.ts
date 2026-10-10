import { generate } from "@/lib/providers";
import { reranker as cfg } from "@/lib/config";
import { scoreCrossEncoder } from "./reranker";
import type { Retrieved } from "./store";

/**
 * Rerank dei candidati recuperati. Strategia in `config.reranker`:
 *  - `cross-encoder`: bge-reranker-v2-m3 reale (Transformers.js/ONNX), in-process.
 *  - `llm`: rerank listwise via LLM (fallback automatico se il CE non si carica).
 */
export async function rerank(
  query: string,
  candidates: Retrieved[],
  topN: number,
  force = false
): Promise<Retrieved[]> {
  if (!force && candidates.length <= topN) return candidates;

  if (cfg.strategy === "cross-encoder") {
    try {
      const scores = await scoreCrossEncoder(query, candidates.map((c) => c.content));
      return candidates
        .map((c, i) => ({ c, s: scores[i] ?? -Infinity }))
        .sort((a, b) => b.s - a.s)
        .slice(0, topN)
        .map((x) => x.c);
    } catch (e) {
      console.warn(`[rerank] cross-encoder non disponibile, fallback LLM: ${e}`);
    }
  }

  return rerankLLM(query, candidates, topN);
}

/**
 * Rerank listwise tramite LLM: funziona out-of-the-box con Ollama.
 * Usato come fallback o quando `config.reranker.strategy === "llm"`.
 */
async function rerankLLM(
  query: string,
  candidates: Retrieved[],
  topN: number
): Promise<Retrieved[]> {
  const list = candidates
    .map((c, i) => `[${i}] ${c.content.slice(0, 400)}`)
    .join("\n\n");

  const raw = await generate("rerank", {
    system:
      "Sei un reranker. Data una domanda e una lista di passaggi numerati, " +
      "restituisci SOLO un array JSON con gli indici dei passaggi piu' pertinenti, " +
      "dal piu' al meno pertinente.",
    json: true,
    temperature: 0,
    messages: [{ role: "user", content: `Domanda: ${query}\n\nPassaggi:\n${list}\n\nJSON:` }],
  });

  try {
    const order = JSON.parse(raw) as number[];
    const picked = order
      .filter((i) => i >= 0 && i < candidates.length)
      .map((i) => candidates[i]);
    return picked.slice(0, topN);
  } catch {
    return candidates.slice(0, topN); // fallback: ordine del vector store
  }
}
