/**
 * SF6 Fundamentals — knowledge that's NOT character-specific.
 *
 * Reuses the sf6_tips table with a sentinel character_slug to avoid migrations.
 * Each tip is either character-specific (slug ∈ roster) or fundamental (slug == FUNDAMENTALS_SLUG).
 */

/** Sentinel value stored in sf6_tips.character_slug for fundamentals. */
export const FUNDAMENTALS_SLUG = "__general__";

export type FundamentalType = "system" | "neutral" | "offense" | "defense" | "mental";

export const FUNDAMENTAL_TYPES: readonly FundamentalType[] = [
  "system",
  "neutral",
  "offense",
  "defense",
  "mental",
] as const;

export type FundamentalTypeMeta = {
  label: string;
  description: string;
  /** Tailwind classes for type chip (colori: token --sf6-* in app/tokens.css). */
  color: string;
  bg: string;
  border: string;
};

export const FUNDAMENTAL_TYPE_META: Record<FundamentalType, FundamentalTypeMeta> = {
  system: {
    label: "System",
    description: "Drive Impact, Drive Rush, Burnout, Super Arts, Modern vs Classic",
    color: "text-[var(--sf6-shoto)]",
    bg: "bg-[var(--sf6-shoto)]/15",
    border: "border-[var(--sf6-shoto)]/40",
  },
  neutral: {
    label: "Neutral",
    description: "Footsies, walk speed, anti-air, spacing, whiff punish",
    color: "text-[var(--sf6-stance)]",
    bg: "bg-[var(--sf6-stance)]/15",
    border: "border-[var(--sf6-stance)]/40",
  },
  offense: {
    label: "Offense",
    description: "Pressure, frame trap, strike/throw, shimmy, conditioning",
    color: "text-[var(--sf6-rushdown)]",
    bg: "bg-[var(--sf6-rushdown)]/15",
    border: "border-[var(--sf6-rushdown)]/40",
  },
  defense: {
    label: "Defense",
    description: "Parry, reversal, throw tech, delay tech, wakeup",
    color: "text-[var(--sf6-charge)]",
    bg: "bg-[var(--sf6-charge)]/15",
    border: "border-[var(--sf6-charge)]/40",
  },
  mental: {
    label: "Mental",
    description: "Scouting, adaptation, mindgame, focus, routine",
    color: "text-[var(--sf6-trickster)]",
    bg: "bg-[var(--sf6-trickster)]/15",
    border: "border-[var(--sf6-trickster)]/40",
  },
};

export function isFundamentalType(t: string): t is FundamentalType {
  return (FUNDAMENTAL_TYPES as readonly string[]).includes(t);
}
