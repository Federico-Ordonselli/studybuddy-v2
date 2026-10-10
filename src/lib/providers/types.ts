export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  signal?: AbortSignal;
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Forza output JSON. Se `schema` e' fornito, alcuni provider lo applicano. */
  json?: boolean;
  schema?: Record<string, unknown>;
  /** Modelli "reasoning" (es. gpt-oss): disattiva il thinking per output diretto/veloce. */
  think?: boolean;
  /** Finestra di contesto per questa chiamata (solo Ollama); default `config.ollama.numCtx`. */
  numCtx?: number;
}

export interface LLMProvider {
  readonly name: string;
  generate(model: string, opts: GenerateOptions): Promise<string>;
  generateStream?(model: string, opts: GenerateOptions): AsyncIterable<string>;
  embed(model: string, texts: string[]): Promise<number[][]>;
}
