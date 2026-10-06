import type { LLMProvider, GenerateOptions } from "./types";

const BASE = () => process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export const ollamaProvider: LLMProvider = {
  name: "ollama",

  async generate(model, opts: GenerateOptions) {
    const messages = [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      ...opts.messages,
    ];
    const res = await fetch(`${BASE()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: opts.schema ?? (opts.json ? "json" : undefined),
        // gpt-oss & co.: `think:false` per output diretto senza catena di reasoning.
        ...(opts.think === undefined ? {} : { think: opts.think }),
        options: {
          temperature: opts.temperature ?? 0.7,
          num_predict: opts.maxTokens ?? 1024,
        },
      }),
    });
    if (!res.ok) throw new Error(`Ollama generate failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.message?.content ?? "";
  },

  async embed(model, texts) {
    const res = await fetch(`${BASE()}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.embeddings as number[][];
  },
};
