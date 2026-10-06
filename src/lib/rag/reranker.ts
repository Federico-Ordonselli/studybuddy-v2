import { reranker as cfg } from "@/lib/config";
import type { PreTrainedTokenizer, PreTrainedModel } from "@huggingface/transformers";

/**
 * Cross-encoder reranker (bge-reranker-v2-m3) via Transformers.js/ONNX.
 * A differenza del bi-encoder per l'embedding, valuta la coppia (query, testo)
 * insieme → punteggi di rilevanza molto più accurati per il rerank.
 *
 * Il modello si carica una sola volta come singleton, lazy, al primo rerank:
 * su GPU (fp16) se disponibile, altrimenti su CPU (q8). Vedi `config.reranker`.
 */
let modelPromise: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }> | null = null;

function load() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import("@huggingface/transformers");
      env.cacheDir = cfg.cacheDir; // cache del modello locale al progetto
      const tokenizer = await AutoTokenizer.from_pretrained(cfg.model);
      if (cfg.device === "cuda") {
        try {
          const model = await AutoModelForSequenceClassification.from_pretrained(cfg.model, { dtype: cfg.dtype, device: "cuda" });
          console.log(`[reranker] ${cfg.model} su CUDA (${cfg.dtype})`);
          return { tokenizer, model };
        } catch (e) {
          console.warn(`[reranker] CUDA non disponibile, uso la CPU: ${String(e).split("\n")[0]}`);
        }
      }
      const model = await AutoModelForSequenceClassification.from_pretrained(cfg.model, { dtype: cfg.cpuDtype, device: "cpu" });
      console.log(`[reranker] ${cfg.model} su CPU (${cfg.cpuDtype})`);
      return { tokenizer, model };
    })();
    // un caricamento fallito non deve restare in cache: il prossimo rerank riprova
    modelPromise.catch(() => { modelPromise = null; });
  }
  return modelPromise;
}

/** Punteggi di rilevanza [0..1] del cross-encoder per ogni testo rispetto alla query. */
export async function scoreCrossEncoder(query: string, texts: string[]): Promise<number[]> {
  if (!texts.length) return [];
  const { tokenizer, model } = await load();
  const scores: number[] = [];
  for (let i = 0; i < texts.length; i += cfg.batchSize) {
    const batch = texts.slice(i, i + cfg.batchSize);
    const inputs = tokenizer(new Array(batch.length).fill(query), {
      text_pair: batch,
      padding: true,
      truncation: true,
      max_length: cfg.maxLength,
    });
    const output = (await model(inputs)) as { logits: { sigmoid(): { tolist(): number[][] } } };
    scores.push(...output.logits.sigmoid().tolist().map((row) => row[0]));
  }
  return scores;
}
