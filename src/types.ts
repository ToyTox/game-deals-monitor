export type Platform = "steam" | "epic" | "gog" | "vkplay" | "ubisoft" | "origin" | "xbox";

/** Тип товара: полноценная игра или то, что разделы каталога по умолчанию скрывают. */
export const GAME_KINDS = ["game", "demo", "dlc", "kit"] as const;
export type GameKind = (typeof GAME_KINDS)[number];

export interface ParsedGame {
  title: string;
  platform: Platform;
  originalPrice?: number;
  currentPrice?: number;
  /** Валюта цен, ISO 4217 (например, RUB для российского Steam). */
  currency?: string;
  discountPercent: number;
  isFree: boolean;
  gameUrl: string;
  imageUrl?: string;
  description?: string;
  saleEndDate?: Date;
}

export interface UpdateResult {
  platform: Platform;
  total: number;
  new: number;
  updated: number;
  freed: number;
  error?: string;
}

export interface StatsResponse {
  totalGames: number;
  freeGames: number;
  discountedGames: number;
  averageDiscount: number;
  byPlatform: {
    [key: string]: {
      total: number;
      free: number;
      discounted: number;
    };
  };
  topDiscounts: {
    title: string;
    platform: string;
    discount: number;
  }[];
  lastUpdate: Date | null;
}
