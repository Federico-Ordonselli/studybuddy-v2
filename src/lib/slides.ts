import { generate } from "@/lib/providers";
import { vectorSearch } from "@/lib/rag/store";
import type { GeneratedImage } from "@/lib/providers/image";

/** Una slide di studio: titolo, bullet, prompt e immagine generata. */
export interface Slide {
  title: string;
  bullets: string[];
  imagePrompt: string;
  image?: GeneratedImage; // riempita lazy lato client (vedi /api/slides/image)
}

const SCHEMA = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          imagePrompt: { type: "string" },
        },
        required: ["title", "bullets", "imagePrompt"],
      },
    },
  },
  required: ["slides"],
} as const;

export async function generateSlides(domainId: number, topic: string, n = 4): Promise<{ slides: Slide[] }> {
  const found = await vectorSearch(topic, 18, domainId);
  if (!found.length) return { slides: [] };
  const ctx = found.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n");

  const raw = await generate("summarize", {
    system:
      `Crea esattamente ${n} slide di studio dal materiale fornito. Ogni slide: ` +
      "`title` breve, `bullets` (3-5 punti concisi), `imagePrompt` = breve descrizione IN INGLESE " +
      "di un'illustrazione/diagramma didattico per la slide. Basati SOLO sul materiale. " +
      "Lingua di title/bullets: quella del materiale.",
    json: true,
    schema: SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.4,
    maxTokens: 1600,
    messages: [{ role: "user", content: `Argomento: ${topic}\n\nMateriale:\n${ctx}` }],
  });

  let slides: Slide[] = [];
  try {
    slides = ((JSON.parse(raw).slides as Slide[]) ?? []).slice(0, n);
  } catch {
    return { slides: [] };
  }

  // Le immagini si generano lazy per-slide (via /api/slides/image) così il deck
  // appare subito e le illustrazioni si riempiono mentre l'utente legge.
  return { slides };
}
