// Notation parser per Street Fighter 6 / FGC standard.
//
// Supporta:
//   - Numpad notation: 5HP, 2HK, 236P, 214+MK, 41236HP, j.HK
//   - Letter motion: qcf, qcb, hcf, hcb, dp, rdp, 360, 720
//   - Bottoni: LP MP HP LK MK HK | PP KK | P K (any)
//   - Position modifier: cr. j. st. f. (anche "cl.", "close.", "far.")
//   - Separator: ">"  "xx"  "->"  ","  "~"
//   - SF6-specific: DI, DR, DRC, OD, Parry, PP (perfect parry), SA1/2/3, CA, Lv1/2/3
//
// L'output è una lista flat di token. Il renderer si occupa di raggruppare
// in "move" tra separator.

export type ButtonStrength = "L" | "M" | "H" | "Any";
export type ButtonFamily = "P" | "K" | "PP" | "KK";

export type Token =
  | { kind: "motion"; raw: string; numpad: string; arrow: string; label: string }
  | { kind: "button"; raw: string; strength: ButtonStrength; family: ButtonFamily; label: string }
  | { kind: "modifier"; raw: string; label: string }
  | { kind: "drive"; raw: string; label: string }
  | { kind: "super"; raw: string; label: string }
  | { kind: "separator"; raw: string; sep: "cancel" | "link" | "rapid" }
  | { kind: "text"; raw: string };

// Mappature direzioni
const NUMPAD_ARROW: Record<string, string> = {
  "1": "↙", "2": "↓", "3": "↘",
  "4": "←", "5": "•", "6": "→",
  "7": "↖", "8": "↑", "9": "↗",
};

const LETTER_TO_NUMPAD: Record<string, string> = {
  qcf: "236",
  qcb: "214",
  hcf: "41236",
  hcb: "63214",
  dp: "623",
  rdp: "421",
  "360": "360",
  "720": "720",
  fdp: "623", // alias
};

const LETTER_TO_LABEL: Record<string, string> = {
  qcf: "QCF",
  qcb: "QCB",
  hcf: "HCF",
  hcb: "HCB",
  dp: "DP",
  rdp: "rDP",
  "360": "360°",
  "720": "720°",
};

const BUTTONS = new Set(["LP", "MP", "HP", "LK", "MK", "HK", "PP", "KK", "P", "K"]);

const DRIVE_TOKENS: Record<string, string> = {
  DI: "Drive Impact",
  DR: "Drive Rush",
  DRC: "DR Cancel",
  OD: "Overdrive",
  EX: "Overdrive", // legacy alias
  PP_DRIVE: "Perfect Parry", // disambiguated from PP=two punches
  PARRY: "Drive Parry",
};

const SUPER_TOKENS: Record<string, string> = {
  SA1: "Super Lv.1",
  SA2: "Super Lv.2",
  SA3: "Super Lv.3",
  CA: "Critical Art",
  LV1: "Super Lv.1",
  LV2: "Super Lv.2",
  LV3: "Super Lv.3",
};

const MODIFIERS_PREFIX = ["cr.", "j.", "st.", "f.", "c.", "cl.", "close.", "far.", "n."];

function buttonInfo(b: string): { strength: ButtonStrength; family: ButtonFamily; label: string } {
  const up = b.toUpperCase();
  if (up === "PP") return { strength: "Any", family: "PP", label: "PP" };
  if (up === "KK") return { strength: "Any", family: "KK", label: "KK" };
  if (up === "P")  return { strength: "Any", family: "P",  label: "P"  };
  if (up === "K")  return { strength: "Any", family: "K",  label: "K"  };
  const strength = (up[0] as ButtonStrength);
  const family = (up[1] as ButtonFamily);
  return { strength, family, label: up };
}

function makeMotion(numpad: string, label?: string): Token {
  // Build arrow string from numpad: e.g. "236" -> "↓↘→"
  const arrow = [...numpad].map((d) => NUMPAD_ARROW[d] ?? d).join("");
  return {
    kind: "motion",
    raw: numpad,
    numpad,
    arrow,
    label: label ?? numpad,
  };
}

/**
 * Pre-normalize the input then tokenize on whitespace, then classify each token.
 */
export function parseNotation(input: string): Token[] {
  if (!input || !input.trim()) return [];

  // Step 1: normalize separator variants
  let s = " " + input + " ";
  s = s.replace(/\s*xx\s*/gi, " > ");
  s = s.replace(/\s*->\s*/g, " > ");
  s = s.replace(/>/g, " > ");
  s = s.replace(/,/g, " , ");
  s = s.replace(/~/g, " ~ ");

  // Step 2: "+" is glue between motion and button: "236+HP" -> "236 HP"
  s = s.replace(/\+/g, " ");

  // Step 3: split position prefix from button: "cr.MK" -> "cr. MK"
  for (const mod of MODIFIERS_PREFIX) {
    const escaped = mod.replace(/\./g, "\\.");
    s = s.replace(new RegExp(`(${escaped})(?=\\S)`, "gi"), "$1 ");
  }

  // Step 4: split "236HP" / "214MK" / "5HP" / "2HK" / etc.
  //   - single-digit prefix + button → split (5HP -> 5 HP)
  //   - multi-digit motion + button → split (236HP -> 236 HP)
  // Use a single regex covering both cases.
  s = s.replace(/(\b[1-9]+)(LP|MP|HP|LK|MK|HK|PP|KK|P|K)\b/gi, "$1 $2");

  // Step 5: split letter motion stuck to button: "qcfHP" -> "qcf HP"
  s = s.replace(/\b(qcf|qcb|hcf|hcb|rdp|dp)(LP|MP|HP|LK|MK|HK|PP|KK|P|K)\b/gi, "$1 $2");

  // Tokenize on whitespace
  const raw = s.split(/\s+/).filter(Boolean);

  return raw.map((tok) => classify(tok));
}

function classify(tok: string): Token {
  // Separator
  if (tok === ">") return { kind: "separator", raw: tok, sep: "cancel" };
  if (tok === ",") return { kind: "separator", raw: tok, sep: "link" };
  if (tok === "~") return { kind: "separator", raw: tok, sep: "rapid" };

  const up = tok.toUpperCase();

  // Drive & super
  if (up in DRIVE_TOKENS && up !== "PP") return { kind: "drive", raw: tok, label: DRIVE_TOKENS[up] };
  if (up === "DI") return { kind: "drive", raw: tok, label: "Drive Impact" };
  if (up === "DR") return { kind: "drive", raw: tok, label: "Drive Rush" };
  if (up === "DRC") return { kind: "drive", raw: tok, label: "DR Cancel" };
  if (up === "OD" || up === "EX") return { kind: "drive", raw: tok, label: "Overdrive" };
  if (up === "PARRY") return { kind: "drive", raw: tok, label: "Parry" };

  if (up in SUPER_TOKENS) return { kind: "super", raw: tok, label: SUPER_TOKENS[up] };

  // Modifier (cr. j. st. f. c. cl. close. far. n.)
  const lower = tok.toLowerCase();
  if (MODIFIERS_PREFIX.includes(lower)) {
    const labelMap: Record<string, string> = {
      "cr.": "cr.",
      "j.": "j.",
      "st.": "st.",
      "f.": "f.",
      "c.": "c.",
      "cl.": "cl.",
      "close.": "close",
      "far.": "far",
      "n.": "n.",
    };
    return { kind: "modifier", raw: tok, label: labelMap[lower] ?? lower };
  }

  // Button (LP MP HP LK MK HK PP KK P K)
  if (BUTTONS.has(up)) {
    const info = buttonInfo(up);
    return { kind: "button", raw: tok, ...info };
  }

  // Letter motion (qcf qcb hcf hcb dp rdp ...)
  if (lower in LETTER_TO_NUMPAD) {
    return makeMotion(LETTER_TO_NUMPAD[lower], LETTER_TO_LABEL[lower]);
  }

  // Numpad single digit (1..9) → modifier (5 = neutral, 2 = crouch, etc.) when alone
  if (/^[1-9]$/.test(tok)) {
    const labelMap: Record<string, string> = {
      "1": "↙", "2": "↓", "3": "↘",
      "4": "←", "5": "n", "6": "→",
      "7": "↖", "8": "↑", "9": "↗",
    };
    return { kind: "modifier", raw: tok, label: labelMap[tok] };
  }

  // Numpad multi-digit motion (236, 214, 41236, 63214, 623, 421, 360, 720, ...)
  if (/^[1-9]{2,}$/.test(tok)) {
    return makeMotion(tok);
  }

  // Fallback
  return { kind: "text", raw: tok };
}
