import type { FundamentalType } from "./fundamentals";

/** Tipi condivisi tra store (server) e componenti SF6 (client). Da learning-vault@439b105. */
export const COMBO_STATUSES = ["learning", "practicing", "consolidated"] as const;
export type ComboStatus = (typeof COMBO_STATUSES)[number];

export const CHARACTER_TIP_TYPES = ["overview", "combo", "tech", "strategy", "matchup", "general"] as const;
export type TipType = (typeof CHARACTER_TIP_TYPES)[number] | FundamentalType;

export interface ComboRow {
  id: number;
  characterSlug: string;
  notation: string;
  situation: string | null;
  status: ComboStatus;
  damage: number | null;
  driveCost: number | null;
  notes: string | null;
  createdAt: string; // ISO
}

export interface TipRow {
  id: number;
  characterSlug: string;
  type: TipType;
  title: string;
  content: string;
  notation: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  createdAt: string; // ISO
}
