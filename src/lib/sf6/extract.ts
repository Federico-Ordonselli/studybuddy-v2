import { generate } from "@/lib/providers";
import { LibraryError } from "@/lib/errors";
import { getSf6Character, type Sf6Character } from "./roster";
import { FUNDAMENTAL_TYPES } from "./fundamentals";

/**
 * Estrazione di combo e consigli da una trascrizione (da learning-vault@439b105, sf6/import.ts).
 * Prompt e schema sono quelli del vault; la chiamata passa da `generate("extract")`.
 * Il trascritto si taglia a MAX_TRANSCRIPT_CHARS: oltre il contesto Ollama tronca l'INIZIO
 * del prompt, cioè il system prompt, e l'estrazione diventa spazzatura senza errori.
 */
/** Type covers BOTH character-specific extraction and fundamentals extraction. */
export type ExtractedItem = {
  type:
    | "overview"
    | "combo"
    | "tech"
    | "strategy"
    | "matchup"
    | "general"
    | "system"
    | "neutral"
    | "offense"
    | "defense"
    | "mental";
  title: string;
  content: string;
  notation: string | null;
};

const CHARACTER_TYPES = ["overview", "combo", "tech", "strategy", "matchup", "general"] as const;

/** ~15k token di trascritto: con prompt (~2k) e uscita (8192) sta nei 32k di contesto. */
export const MAX_TRANSCRIPT_CHARS = 60_000;
const NUM_CTX = 32768;
const MAX_OUTPUT_TOKENS = 8192; // overview fino a 2000 caratteri + 20 item: il default 1024 tronca il JSON

export interface Extraction { items: ExtractedItem[]; truncated: boolean }

function clip(transcript: string): { text: string; truncated: boolean } {
  const t = transcript.trim();
  return t.length > MAX_TRANSCRIPT_CHARS ? { text: t.slice(0, MAX_TRANSCRIPT_CHARS), truncated: true } : { text: t, truncated: false };
}

const TRANSLATION_RULES = `REGOLE DI TRADUZIONE da inglese parlato a notation FGC SF6:

NORMALS:
- "jab" / "light punch" → LP (o 5LP)
- "short" / "light kick" → LK (o 5LK)
- "strong" / "medium punch" → MP (o 5MP)
- "forward" / "medium kick" → MK
- "fierce" / "heavy punch" → HP
- "roundhouse" / "heavy kick" → HK
- "crouching X" / "low X" / "down X" → cr.X (es. "crouching medium punch" → cr.MP)
- "standing X" / "up close X" → st.X o solo X
- "jumping X" / "air X" / "jump-in X" → j.X (es. "jumping heavy punch" → j.HP)
- "back X" → b.X  ·  "forward X" → f.X  ·  "down-back X" → db.X

DRIVE SYSTEM SF6:
- "drive impact" → DI
- "drive rush" → DR  ·  "drive rush cancel" / "DR cancel" → DRC
- "drive parry" → Parry  ·  "drive reversal" → DRev
- "overdrive" / "EX" → OD prefix (es. "EX DP" → OD DP+K, "EX spiral" → OD 236+K)
- "level 1/2/3" / "super 1/2/3" → SA1, SA2, SA3
- "critical art" → CA

MOTION GENERICI (qualsiasi personaggio):
- "fireball motion" / "quarter circle forward" → qcf  (= 236)
- "quarter circle back" → qcb  (= 214)
- "dragon punch" / "shoryuken" / "DP" motion → dp  (= 623)
- "reverse DP" → rdp  (= 421)
- "half circle forward" → hcf  (= 41236)  ·  "half circle back" → hcb  (= 63214)
- "360" / "spinning piledriver motion" → 360

SPECIAL MOVES — usa il nome del move se non sai la motion esatta:
- Quando un guide menziona uno special per nome (es. "Spiral Arrow", "Cannon Spike", "Spin Knuckle", "Hooligan", "Tatsu", "Hadoken"), USA quel nome + strength prefix.
- Esempio: "L Spin Knuckle" → "L Spin Knuckle" (o "214+LP" se la motion è ovvia).
- Esempio: "spiral arrow heavy" → "H Spiral Arrow" o "236+HK"
- Esempio: "EX Hooligan" → "OD Hooligan"
- NON inventare numpad se non sei sicuro — meglio il nome del move che una notation sbagliata.

CONCATENAZIONE:
- "into" / "cancel into" / "xx" → ">" (cancel)
- "link into" / ", then" → ","  (link)
- "rapid fire" / "chain" → "~"`;

const SYSTEM_PROMPT = `Sei un esperto di Street Fighter 6 e dei suoi sistemi. Analizzi trascrizioni di guide e le trasformi in conoscenza strutturata in italiano per un giocatore che impara il personaggio.

OUTPUT FORMAT — un singolo oggetto JSON con un solo campo "items" (array). NIENTE markdown, NIENTE preamble, NIENTE testo fuori dal JSON.

L'array "items" DEVE iniziare con UN item di type="overview" che riassume in prosa il game plan generale del personaggio secondo questa guida — quale è la strategia core, quali sono i buff/nerf rilevanti (se menzionati), come si gioca in neutral/advantage/disadvantage. L'overview è un riassunto NARRATIVO di 800-2000 caratteri scritto in italiano fluente, non una lista. Catturare il "filo del discorso" del coach.

DOPO l'overview, aggiungi 5-20 items strutturati con type in: combo | tech | strategy | matchup | general.

TIPI:
- combo: combo concreta. SEMPRE con il campo "notation" in FGC notation.
- tech: setup, gimmick, oki, frame trap, meaty, safe jump, side swap.
- strategy: principio generale di gioco (game plan, neutral, gestione meter).
- matchup: consiglio specifico contro un altro personaggio.
- general: tutto il resto (patch notes, tier, sistemi del gioco).

LIMITI:
- title: max 80 caratteri, in italiano, descrittivo.
- content: max 400 caratteri per items normali, max 2000 per overview, in italiano.
- notation: SOLO per type="combo". OBBLIGATORIA per combo. null per gli altri tipi.

${TRANSLATION_RULES}

PRINCIPI:
- Se nel transcript trovi una combo descritta a parole, TRADUCI in notation FGC seguendo le regole sopra. Non lasciare descrizioni verbali nel campo "notation".
- Ignora intro, outro, sponsorship, like-and-subscribe.
- Se il transcript non parla del personaggio richiesto, ritorna lista vuota.
- Scrivi tutto in italiano (title, content, overview). La notation resta in FGC inglese standard.`;

const EXAMPLE_OUTPUT = `Schema (esempio illustrativo, NON copiare il contenuto):
{
  "items": [
    {
      "type": "overview",
      "title": "Game plan generale",
      "content": "Riassunto narrativo del game plan secondo questa guida, 800-2000 caratteri, in italiano. Cattura come il coach vuole farti giocare il personaggio, le idee chiave, i cambi di patch rilevanti, le decisioni strategiche più importanti.",
      "notation": null
    },
    {
      "type": "combo",
      "title": "Punish base midscreen",
      "content": "Combo basic da punish a centro stage. Niente meter, decente damage.",
      "notation": "cr.MP > st.HP > 236+K"
    },
    {
      "type": "tech",
      "title": "Setup hooligan +3 ovunque",
      "content": "Dopo b.MP target combo > L Spin Knuckle sei plus 3 sia midscreen che corner. EX-DP-safe.",
      "notation": null
    }
  ]
}`;

function userPrompt(character: Sf6Character, transcript: string, sourceTitle?: string): string {
  return [
    `Personaggio: ${character.name} (${character.archetype}).`,
    sourceTitle ? `Video: "${sourceTitle}".` : null,
    "",
    "Transcript:",
    "---",
    transcript,
    "---",
    "",
    `Genera l'analisi JSON per ${character.name}. Inizia SEMPRE con l'overview narrativo.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// JSON Schema used by Ollama's constrained decoding (Ollama 0.5+).
// Forces the model to output exactly this shape at the token level —
// it's literally impossible for it to emit a key that isn't "items".
const ITEMS_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["overview", "combo", "tech", "strategy", "matchup", "general"],
          },
          title: { type: "string" },
          content: { type: "string" },
          notation: { type: ["string", "null"] },
        },
        required: ["type", "title", "content", "notation"],
      },
    },
  },
  required: ["items"],
};

export async function extractFromTranscript({
  characterSlug,
  transcript,
  sourceTitle,
}: {
  characterSlug: string;
  transcript: string;
  sourceTitle?: string;
}): Promise<Extraction> {
  const character = getSf6Character(characterSlug);
  if (!character) throw new LibraryError(`personaggio sconosciuto: ${characterSlug}`);
  const { text, truncated } = clip(transcript);
  if (text.length < 20) return { items: [], truncated: false };

  const raw = await generate("extract", {
    system: SYSTEM_PROMPT + "\n\n" + EXAMPLE_OUTPUT,
    messages: [{ role: "user", content: userPrompt(character, text, sourceTitle) }],
    schema: ITEMS_JSON_SCHEMA,
    numCtx: NUM_CTX,
    maxTokens: MAX_OUTPUT_TOKENS,
  });
  const items = parseItems(raw, CHARACTER_TYPES);
  console.log(`[sf6/extract] personaggio ${characterSlug}: ${items.length} item da ${raw.length} caratteri`);
  return { items, truncated };
}

// =====================================================================
// FUNDAMENTALS extraction (non character-specific)
// =====================================================================

const FUNDAMENTALS_SYSTEM_PROMPT = `Sei un esperto di Street Fighter 6 e in generale dei concetti universali dei picchiaduro 2D moderni. Analizzi trascrizioni di guide sui FONDAMENTALI del gioco — meccaniche di sistema, neutral game, pressione, difesa, mentalità — e le trasformi in conoscenza strutturata in italiano per un giocatore che impara.

Queste guide NON parlano di un personaggio specifico: parlano di concetti che valgono per qualunque personaggio. Esempi: "come usare il Drive Impact", "come migliorare nel neutral", "come uscire dal burnout", "anti-air theory", "frame data basics", "come scoutare l'avversario".

OUTPUT FORMAT — un singolo oggetto JSON con un solo campo "items" (array). NIENTE markdown, NIENTE preamble, NIENTE testo fuori dal JSON.

L'array "items" DEVE iniziare con UN item di type="overview" che riassume in prosa il tema della guida — qual è il concetto centrale, perché è importante, come si traduce in pratica. L'overview è un riassunto NARRATIVO di 600-1800 caratteri in italiano fluente, non una lista.

DOPO l'overview, aggiungi 4-15 items strutturati con type in: system | neutral | offense | defense | mental.

TIPI:
- system: meccaniche del gioco SF6 (Drive Impact, Drive Rush, Drive Parry, Drive Reversal, Burnout recovery, Perfect Parry, Super Arts livello 1/2/3, Critical Art, Modern vs Classic).
- neutral: gioco a media distanza (footsies, walk speed, anti-air, spacing, whiff punish, threat range, controllo dello spazio).
- offense: quando hai il turno (pressure, frame trap, strike/throw, shimmy, tick throw, meaty setup, mixup, conditioning, throw loop).
- defense: quando subisci pressione (parry timing, reversal options, throw tech, delay tech, OD reversal, wakeup mixup defense, anti-jump).
- mental: meta-gioco (scouting dell'avversario, adattamento mid-set, gestione del tilt, focus, routine di studio, su cosa concentrarsi a ogni rank).

LIMITI:
- title: max 80 caratteri, italiano, descrittivo.
- content: max 400 caratteri per items normali, max 1800 per overview, italiano.
- notation: SEMPRE null per i fondamentali (non ci sono combo specifiche).

PRINCIPI:
- I termini tecnici FGC e SF6 (Drive Impact, DI, parry, frame trap, shimmy, OD, meaty, oki, neutral, footsies, anti-air, burnout) restano in inglese — è il linguaggio standard della community.
- Il resto è in italiano fluente.
- Ignora intro, outro, sponsorship, like-and-subscribe.
- Non inventare contenuti che non sono nel transcript. Se la guida copre solo 2-3 concetti, estrai solo quelli.`;

const FUNDAMENTALS_EXAMPLE_OUTPUT = `Schema (esempio illustrativo, NON copiare):
{
  "items": [
    {
      "type": "overview",
      "title": "Drive system: panoramica",
      "content": "Riassunto narrativo del concetto della guida, 600-1800 caratteri in italiano, con i termini tecnici in inglese.",
      "notation": null
    },
    {
      "type": "system",
      "title": "Drive Impact: quando usarlo",
      "content": "Il Drive Impact è una mossa armored che assorbe due colpi. Costa 1 barra di drive ed è punibile su block (-5). Usalo come tool di reset del neutral quando l'avversario è prevedibile, o come reversal contro pressure scontata. Non spammarlo: dopo il primo, il tuo avversario lo aspetta.",
      "notation": null
    },
    {
      "type": "neutral",
      "title": "Anti-air come priorità #1",
      "content": "Se non antiar consistentemente, perdi metà dei matchup. Pratica anti-air buttoni del tuo personaggio in training, almeno 100 reps a sessione, finché diventano riflesso.",
      "notation": null
    }
  ]
}`;

function fundamentalsUserPrompt(transcript: string, sourceTitle?: string): string {
  return [
    sourceTitle ? `Video: "${sourceTitle}".` : null,
    "",
    "Transcript:",
    "---",
    transcript,
    "---",
    "",
    "Genera l'analisi JSON dei fondamentali coperti da questa guida. Inizia SEMPRE con l'overview narrativo.",
  ]
    .filter(Boolean)
    .join("\n");
}

const FUNDAMENTALS_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["overview", "system", "neutral", "offense", "defense", "mental"],
          },
          title: { type: "string" },
          content: { type: "string" },
          notation: { type: ["string", "null"] },
        },
        required: ["type", "title", "content", "notation"],
      },
    },
  },
  required: ["items"],
};

const FUNDAMENTAL_PARSE_TYPES = ["overview", ...FUNDAMENTAL_TYPES] as const;

export async function extractFundamentalsFromTranscript({
  transcript,
  sourceTitle,
}: {
  transcript: string;
  sourceTitle?: string;
}): Promise<Extraction> {
  const { text, truncated } = clip(transcript);
  if (text.length < 20) return { items: [], truncated: false };

  const raw = await generate("extract", {
    system: FUNDAMENTALS_SYSTEM_PROMPT + "\n\n" + FUNDAMENTALS_EXAMPLE_OUTPUT,
    messages: [{ role: "user", content: fundamentalsUserPrompt(text, sourceTitle) }],
    schema: FUNDAMENTALS_JSON_SCHEMA,
    numCtx: NUM_CTX,
    maxTokens: MAX_OUTPUT_TOKENS,
  });
  const items = parseItems(raw, FUNDAMENTAL_PARSE_TYPES);
  console.log(`[sf6/extract] fondamentali: ${items.length} item da ${raw.length} caratteri`);
  return { items, truncated };
}

export function parseItems(
  raw: string,
  allowedTypes: readonly ExtractedItem["type"][],
): ExtractedItem[] {
  let jsonText = raw.trim();

  // Strip markdown fences
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  }

  // Extract outermost JSON object
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];
  jsonText = jsonText.slice(start, end + 1);

  type ParsedShape = { items?: unknown };
  let parsed: ParsedShape;
  try {
    parsed = JSON.parse(jsonText) as ParsedShape;
  } catch {
    return [];
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const valid: ExtractedItem[] = [];
  const ALLOWED = new Set<string>(allowedTypes);
  // Fundamental tips never carry a notation; only character "combo" type does.
  const isCharacterMode = allowedTypes.includes("combo");

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const rawType = typeof item.type === "string" ? item.type : "";
    const type = ALLOWED.has(rawType)
      ? rawType
      : isCharacterMode
        ? "general"
        : "system"; // sensible fallback per mode
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 200) : "";
    const contentLimit = type === "overview" ? 2500 : 1000;
    const content =
      typeof item.content === "string" ? item.content.trim().slice(0, contentLimit) : "";
    const notation =
      isCharacterMode &&
      type === "combo" &&
      typeof item.notation === "string" &&
      item.notation.trim()
        ? item.notation.trim().slice(0, 300)
        : null;
    if (!title || !content) continue;
    valid.push({
      type: type as ExtractedItem["type"],
      title,
      content,
      notation,
    });
  }

  return valid;
}
