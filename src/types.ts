/** Идентификатор магазина. Свободная строка: ITAD приносит десятки магазинов. */
export type StoreId = string;

/** Вид магазина: официальная площадка издателя/платформы или перепродавец ключей. */
export type StoreKind = 'official' | 'keyshop';

export interface StoreDefinition {
  id: StoreId;
  name: string;
  kind: StoreKind;
}

/** Магазины, которые обслуживаются собственными парсерами. Используется для сида таблицы Store. */
export const KNOWN_STORES: StoreDefinition[] = [
  { id: 'steam', name: 'Steam', kind: 'official' },
  { id: 'epic', name: 'Epic Games Store', kind: 'official' },
  { id: 'gog', name: 'GOG', kind: 'official' },
  { id: 'vkplay', name: 'VK Play', kind: 'official' },
];

/** Тип товара: полноценная игра или то, что разделы каталога по умолчанию скрывают. */
export const GAME_KINDS = ["game", "demo", "dlc", "kit"] as const;
export type GameKind = (typeof GAME_KINDS)[number];

/** Тег игры из каталога магазина: slug для склейки между магазинами, name — подпись на карточке. */
export interface ParsedTag {
  slug: string;
  name: string;
}

export interface ParsedGame {
  title: string;
  storeId: StoreId;
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
  /** Жанры и метки магазина; сохраняются на канонической игре. */
  tags?: ParsedTag[];
}

export interface UpdateResult {
  storeId: StoreId;
  total: number;
  new: number;
  updated: number;
  freed: number;
  error?: string;
}

/** Запись истории цен оффера в ответе API. */
export interface PriceHistoryView {
  id: number;
  oldPrice: number | null;
  newPrice: number | null;
  oldDiscount: number;
  newDiscount: number;
  createdAt: Date;
}

/** Оффер в ответе API: цена магазина плюс её рублёвый эквивалент. */
export interface OfferView {
  id: number;
  /** Дублирует storeId: карточки и страница игры читают платформу из этого поля. */
  platform: StoreId;
  storeId: StoreId;
  storeName: string;
  storeKind: StoreKind;
  originalPrice: number | null;
  currentPrice: number | null;
  currency: string | null;
  originalPriceRub: number | null;
  currentPriceRub: number | null;
  discountPercent: number;
  isFree: boolean;
  gameUrl: string;
  saleEndDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  priceHistory: PriceHistoryView[];
}

/**
 * Игра со всеми предложениями магазинов — ответ GET /api/games/slug/:slug
 * для страницы одной игры. В отличие от элемента списка собирается от Game,
 * поэтому офферов может быть несколько.
 */
export interface GameDetail {
  id: number;
  slug: string;
  title: string;
  kind: string;
  imageUrl: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: ParsedTag[];
  /** От самого дешёвого предложения к дорогому; без цены — в конце. */
  offers: OfferView[];
}

export interface StatsResponse {
  totalGames: number;
  freeGames: number;
  discountedGames: number;
  averageDiscount: number;
  byStore: {
    [key: string]: {
      total: number;
      free: number;
      discounted: number;
    };
  };
  topDiscounts: {
    title: string;
    slug: string;
    storeId: string;
    discount: number;
  }[];
  lastUpdate: Date | null;
}
