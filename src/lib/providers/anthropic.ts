import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, GenerateOptions } from "./types";

let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY non impostata (.env)");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export const anthropicProvider: LLMProvider = {
  name: "anthropic",

  async generate(model, opts: GenerateOptions) {
    const msg = await getClient().messages.create({
      model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      system: opts.json
        ? `${opts.system ?? ""}\nRispondi SOLO con JSON valido, senza testo o backtick.`.trim()
        : opts.system,
      messages: opts.messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    });
    const block = msg.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "";
  },

  async embed() {
    // Anthropic non espone un endpoint di embeddings: usa Ollama (bge-m3) per gli embed.
    throw new Error("anthropic provider non supporta embed(); usa ollama per il task 'embed'.");
  },
};
