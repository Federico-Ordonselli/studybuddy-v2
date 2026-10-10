import type { LLMProvider, GenerateOptions } from "./types";

const BASE = () => process.env.OPENAI_COMPATIBLE_BASE_URL ?? "";
const KEY = () => process.env.OPENAI_COMPATIBLE_API_KEY ?? "";

/** Funziona con LM Studio, vLLM, OpenRouter, Qwen API, ecc. */
export const openAICompatibleProvider: LLMProvider = {
  name: "openai-compatible",

  async generate(model, opts: GenerateOptions) {
    const messages = [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      ...opts.messages,
    ];
    const res = await fetch(`${BASE()}/chat/completions`, {
      signal: opts.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(KEY() ? { Authorization: `Bearer ${KEY()}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 1024,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`OpenAI-compat generate failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  },

  async embed(model, texts) {
    const res = await fetch(`${BASE()}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(KEY() ? { Authorization: `Bearer ${KEY()}` } : {}),
      },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) throw new Error(`OpenAI-compat embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return (data.data as { embedding: number[] }[]).map((d) => d.embedding);
  },
};
