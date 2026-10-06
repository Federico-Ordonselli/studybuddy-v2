import { image as cfg } from "@/lib/config";
import { generate } from "@/lib/providers";

/**
 * Provider di generazione immagini, pluggable e local-first.
 * Default `svg-llm`: gpt-oss genera un'illustrazione SVG didattica (vettoriale,
 * stile flat) — nessun servizio esterno. `automatic1111`/`openai` sono predisposti
 * ma opt-in (richiedono server/credenziali).
 */
export interface GeneratedImage {
  format: "svg" | "png";
  /** SVG inline (format svg) oppure data URL (format png). */
  content: string;
}

export async function generateImage(prompt: string): Promise<GeneratedImage> {
  switch (cfg.backend) {
    case "automatic1111":
      return automatic1111(prompt);
    case "openai":
      return openai(prompt);
    default:
      return svgViaLLM(prompt);
  }
}

/** Estrae il blocco <svg>…</svg> e rimuove costrutti pericolosi/inutili. */
function sanitizeSvg(raw: string): string | null {
  // tollera un eventuale troncamento del tag di chiusura (auto-close)
  const start = raw.search(/<svg[\s>]/i);
  if (start < 0) return null;
  const end = raw.toLowerCase().lastIndexOf("</svg>");
  let svg = end > start ? raw.slice(start, end + 6) : raw.slice(start) + "</svg>";
  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "") // handler inline
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  if (!/viewBox=/i.test(svg)) svg = svg.replace(/<svg/i, '<svg viewBox="0 0 400 300"');
  // reso come <img> (data URL): senza namespace il browser non lo disegna
  if (!/<svg[^>]*\sxmlns=/i.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

/** Placeholder vettoriale se l'LLM non produce un SVG valido. */
function placeholderSvg(prompt: string): string {
  const text = prompt.slice(0, 40).replace(/[<&>]/g, " ");
  return `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="300" fill="#1e222b"/><rect x="20" y="20" width="360" height="260" rx="12" fill="none" stroke="#2b6cff" stroke-width="2"/><text x="200" y="155" fill="#98a0b3" font-family="system-ui" font-size="14" text-anchor="middle">${text}</text></svg>`;
}

async function svgViaLLM(prompt: string): Promise<GeneratedImage> {
  // L'SVG generato dall'LLM è non-deterministico: ogni tanto non emette markup.
  // Riproviamo un paio di volte prima di cadere sul placeholder.
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generate("summarize", {
      system:
        "Sei un illustratore tecnico. Genera UNA illustrazione SVG didattica per il concetto richiesto: " +
        "stile flat, pulito, poche forme, frecce e brevi etichette se utili. " +
        'Usa viewBox="0 0 400 300". Palette su sfondo scuro (#1e222b) con accenti #6ea8fe/#6ee7a8 e testo #e6e8ee. ' +
        "Rispondi SOLO con il codice SVG: inizia con `<svg` e finisci con `</svg>`. Niente markdown, niente spiegazioni, niente <script>.",
      temperature: 0.5,
      maxTokens: 2600,
      think: false, // niente catena di reasoning: SVG diretto, più veloce e non troncato
      messages: [{ role: "user", content: `Concetto da illustrare: ${prompt}\n\nOutput: solo <svg>…</svg>.` }],
    });
    const svg = sanitizeSvg(raw);
    if (svg) return { format: "svg", content: svg };
  }
  return { format: "svg", content: placeholderSvg(prompt) };
}

// --- backend opt-in (predisposti) -------------------------------------------

async function automatic1111(prompt: string): Promise<GeneratedImage> {
  const res = await fetch(`${cfg.baseUrl}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps: 20, width: 512, height: 384 }),
  });
  if (!res.ok) throw new Error(`automatic1111 txt2img ${res.status}: avviare il server SD`);
  const data = (await res.json()) as { images?: string[] };
  const b64 = data.images?.[0];
  if (!b64) throw new Error("automatic1111: nessuna immagine restituita");
  return { format: "png", content: `data:image/png;base64,${b64}` };
}

async function openai(prompt: string): Promise<GeneratedImage> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY mancante (backend immagini openai è opt-in)");
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: cfg.model, prompt, size: "1024x1024", response_format: "b64_json" }),
  });
  if (!res.ok) throw new Error(`openai images ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("openai: nessuna immagine restituita");
  return { format: "png", content: `data:image/png;base64,${b64}` };
}
