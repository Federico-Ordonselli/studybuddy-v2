import { models, type Task } from "@/lib/config";
import type { LLMProvider, GenerateOptions } from "./types";
import { ollamaProvider } from "./ollama";
import { anthropicProvider } from "./anthropic";
import { openAICompatibleProvider } from "./openai-compatible";

const registry: Record<string, LLMProvider> = {
  ollama: ollamaProvider,
  anthropic: anthropicProvider,
  "openai-compatible": openAICompatibleProvider,
};

/** Esegue un task usando il modello/provider configurato in config.ts. */
export function generate(task: Task, opts: GenerateOptions): Promise<string> {
  const ref = models[task];
  return registry[ref.provider].generate(ref.model, opts);
}

export function embed(texts: string[]): Promise<number[][]> {
  const ref = models.embed;
  return registry[ref.provider].embed(ref.model, texts);
}

export type { GenerateOptions, ChatMessage } from "./types";

/** Streaming nativo dove disponibile, fallback con un unico pezzo. */
export async function* generateStream(task: Task, opts: GenerateOptions): AsyncIterable<string> {
  const ref = models[task];
  const provider = registry[ref.provider];
  opts.signal?.throwIfAborted();
  if (provider.generateStream) yield* provider.generateStream(ref.model, opts);
  else yield await provider.generate(ref.model, opts);
}
