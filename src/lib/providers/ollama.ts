import { ollama as cfg } from "@/lib/config";
import type { LLMProvider, GenerateOptions } from "./types";

/** URL di Ollama (letto a ogni chiamata: i test e Docker lo cambiano via env). */
export const ollamaBaseUrl = () => process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const BASE = ollamaBaseUrl;

export const ollamaProvider: LLMProvider = {
  name: "ollama",

  async generate(model, opts: GenerateOptions) {
    const messages = [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      ...opts.messages,
    ];
    const res = await fetch(`${BASE()}/api/chat`, {
      signal: opts.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: opts.schema ?? (opts.json ? "json" : undefined),
        // modelli reasoning: thinking off di default (vedi config.ollama), opt-in per chiamata.
        think: opts.think ?? cfg.think,
        options: {
          num_ctx: opts.numCtx ?? cfg.numCtx,
          temperature: opts.temperature ?? 0.7,
          num_predict: opts.maxTokens ?? 1024,
        },
      }),
    });
    if (!res.ok) throw new Error(`Ollama generate failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.message?.content ?? "";
  },

  async *generateStream(model, opts) {
    const res = await fetch(`${BASE()}/api/chat`, {
      method: "POST", signal: opts.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({model, messages: [...(opts.system ? [{role:"system",content:opts.system}] : []), ...opts.messages],
        stream: true, think: opts.think ?? cfg.think, format: opts.schema ?? (opts.json ? "json" : undefined),
        options: {num_ctx: opts.numCtx ?? cfg.numCtx, temperature: opts.temperature ?? 0.7, num_predict: opts.maxTokens ?? 1024}}),
    });
    if (!res.ok) throw new Error(`Ollama generate failed: ${res.status} ${await res.text()}`);
    if (!res.body) throw new Error("Ollama: stream assente");
    let done = false;
    for await (const line of decodedLines(res.body)) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      if (data.error) throw new Error(`Ollama: ${data.error}`);
      if (data.message?.content) yield data.message.content;
      if (data.done) { done = true; break; }
    }
    if (!done) throw new Error("Ollama: stream incompleto");
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

/** Decodifica UTF-8 anche quando una riga o un carattere attraversa più pacchetti. */
export async function* decodedLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const {value, done} = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, {stream:true});
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        yield pending.slice(0,end).replace(/\r$/, "");
        pending = pending.slice(end+1);
      }
      if (done) break;
    }
    if (pending) yield pending;
  } finally { await reader.cancel(); reader.releaseLock(); }
}
