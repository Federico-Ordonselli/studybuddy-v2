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
  /** Tailwind classes for type chip. */
  color: string;
  bg: string;
  border: string;
};

export const FUNDAMENTAL_TYPE_META: Record<FundamentalType, FundamentalTypeMeta> = {
  system: {
    label: "System",
    description: "Drive Impact, Drive Rush, Burnout, Super Arts, Modern vs Classic",
    color: "text-[#F0CC75]",
    bg: "bg-[#D4A437]/15",
    border: "border-[#D4A437]/40",
  },
  neutral: {
    label: "Neutral",
    description: "Footsies, walk speed, anti-air, spacing, whiff punish",
    color: "text-[#7CC0B7]",
    bg: "bg-[#5FA89F]/15",
    border: "border-[#5FA89F]/40",
  },
  offense: {
    label: "Offense",
    description: "Pressure, frame trap, strike/throw, shimmy, conditioning",
    color: "text-[#E07B3D]",
    bg: "bg-[#E07B3D]/15",
    border: "border-[#E07B3D]/40",
  },
  defense: {
    label: "Defense",
    description: "Parry, reversal, throw tech, delay tech, wakeup",
    color: "text-[#7EA8E8]",
    bg: "bg-[#5A85CC]/15",
    border: "border-[#5A85CC]/40",
  },
  mental: {
    label: "Mental",
    description: "Scouting, adaptation, mindgame, focus, routine",
    color: "text-[#B86FB5]",
    bg: "bg-[#B86FB5]/15",
    border: "border-[#B86FB5]/40",
  },
};

export function isFundamentalType(t: string): t is FundamentalType {
  return (FUNDAMENTAL_TYPES as readonly string[]).includes(t);
}
