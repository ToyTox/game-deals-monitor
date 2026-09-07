export type Platform = "steam" | "epic" | "gog" | "ubisoft" | "origin" | "xbox";

export interface ParsedGame {
  title: string;
  platform: Platform;
  originalPrice?: number;
  currentPrice?: number;
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
