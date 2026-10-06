import { reranker as cfg } from "@/lib/config";
import type { PreTrainedTokenizer, PreTrainedModel } from "@huggingface/transformers";

/**
 * Cross-encoder reranker (bge-reranker-v2-m3) via Transformers.js/ONNX.
 * A differenza del bi-encoder per l'embedding, valuta la coppia (query, testo)
 * insieme → punteggi di rilevanza molto più accurati per il rerank.
 *
 * Il modello (~280MB q8) si carica una sola volta come singleton, lazy, al primo
 * rerank; le chiamate successive sono in-process e veloci (~decine di ms).
 */
let modelPromise: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }> | null = null;

function load() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import("@huggingface/transformers");
      env.cacheDir = cfg.cacheDir; // cache del modello locale al progetto
      const tokenizer = await AutoTokenizer.from_pretrained(cfg.model);
      const model = await AutoModelForSequenceClassification.from_pretrained(cfg.model, { dtype: cfg.dtype });
      return { tokenizer, model };
    })();
  }
  return modelPromise;
}

/** Punteggi di rilevanza [0..1] del cross-encoder per ogni testo rispetto alla query. */
export async function scoreCrossEncoder(query: string, texts: string[]): Promise<number[]> {
  if (!texts.length) return [];
  const { tokenizer, model } = await load();
  const inputs = tokenizer(new Array(texts.length).fill(query), {
    text_pair: texts,
    padding: true,
    truncation: true,
  });
  const output = (await model(inputs)) as { logits: { sigmoid(): { tolist(): number[][] } } };
  return output.logits.sigmoid().tolist().map((row) => row[0]);
}
