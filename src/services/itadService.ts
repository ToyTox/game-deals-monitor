import axios from 'axios';

const ITAD_API = 'https://api.isthereanydeal.com';

export const ITAD_SHOP_IDS = {
  steam: 61,
  gog: 35,
  epic: 16,
} as const;

export type SupportedStore = keyof typeof ITAD_SHOP_IDS;

const SUPPORTED_STORES: SupportedStore[] = ['steam', 'gog', 'epic'];

/** Время жизни кэшированной истории в памяти. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Максимальное число записей в кэше (вытесняется самая давно записанная). */
const MAX_CACHE_ENTRIES = 100;

/** Период в миллисекундах для расчёта динамики. */
const PERIODS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  half_year: 180 * 24 * 60 * 60 * 1000,
} as const;

export type GraphPoint = {
  timestamp: string; // ISO-дата
  price: number | null;
};

export type PriceDynamics = {
  country: string;
  currency: string | null;
  shop: SupportedStore;
  currentPrice: number | null;
  graphPoints: GraphPoint[];
  periods: {
    day: PeriodData;
    week: PeriodData;
    month: PeriodData;
    half_year: PeriodData;
  };
  allTimeLowest: {
    price: number;
    timestamp: string; // ISO-дата
  } | null;
};

export type PeriodData = {
  price: number | null;
  change: number | null;
  lowest: number | null;
};

export type PriceDynamicsErrorCode = 'no_key' | 'unsupported_shop' | 'not_found' | 'upstream';

export class PriceDynamicsError extends Error {
  constructor(
    readonly code: PriceDynamicsErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PriceDynamicsError';
  }
}

/** Запись истории цены: валидная дата и числовая цена. */
export type PriceRecord = {
  timestamp: string; // ISO-дата
  price: number;
};

export type PriceAnalysis = Pick<PriceDynamics, 'currentPrice' | 'graphPoints' | 'periods' | 'allTimeLowest'>;

/**
 * Считает текущую цену, график за 180 дней, периоды и исторический минимум.
 * Чистая функция: «сейчас» приходит аргументом.
 */
export function analyzePriceHistory(input: PriceRecord[], now: number): PriceAnalysis {
  const records = input
    .map((rec) => ({ ...rec, time: new Date(rec.timestamp).getTime() }))
    .filter((rec) => !isNaN(rec.time) && rec.time <= now)
    .sort((a, b) => a.time - b.time);

  // Цена на момент t — цена последней записи с датой не позже t
  const priceAt = (t: number): number | null => {
    let price: number | null = null;
    for (const rec of records) {
      if (rec.time > t) break;
      price = rec.price;
    }
    return price;
  };

  const currentPrice = priceAt(now);

  let allTimeLowest: PriceDynamics['allTimeLowest'] = null;
  for (const rec of records) {
    if (allTimeLowest === null || rec.price < allTimeLowest.price) {
      allTimeLowest = { price: rec.price, timestamp: rec.timestamp };
    }
  }

  const windowStart = now - PERIODS.half_year;
  const graphPoints: GraphPoint[] = [];
  if (currentPrice !== null) {
    const startPrice = priceAt(windowStart);
    if (startPrice !== null) {
      graphPoints.push({ timestamp: new Date(windowStart).toISOString(), price: startPrice });
    }
    for (const rec of records) {
      if (rec.time > windowStart) {
        graphPoints.push({ timestamp: rec.timestamp, price: rec.price });
      }
    }
    graphPoints.push({ timestamp: new Date(now).toISOString(), price: currentPrice });
  }

  const period = (periodMs: number): PeriodData => {
    const periodStart = now - periodMs;
    const priceAtStart = priceAt(periodStart);

    const candidates = records.filter((rec) => rec.time > periodStart).map((rec) => rec.price);
    if (priceAtStart !== null) candidates.push(priceAtStart);
    if (currentPrice !== null) candidates.push(currentPrice);
    const lowest = candidates.length > 0 ? Math.min(...candidates) : null;

    let change: number | null = null;
    if (priceAtStart !== null && priceAtStart !== 0 && currentPrice !== null) {
      change = Math.round(((currentPrice - priceAtStart) / priceAtStart) * 100);
    }

    return { price: priceAtStart, change, lowest };
  };

  return {
    currentPrice,
    graphPoints,
    periods: {
      day: period(PERIODS.day),
      week: period(PERIODS.week),
      month: period(PERIODS.month),
      half_year: period(PERIODS.half_year),
    },
    allTimeLowest,
  };
}

interface RawGameLookup {
  found?: boolean;
  game?: {
    id?: string;
    title?: string;
  };
}

interface RawHistoryRecord {
  timestamp?: string; // ISO-дата
  shop?: {
    id?: number;
  };
  deal?: {
    price?: {
      amount?: number;
      currency?: string;
    };
    regular?: number;
    cut?: number;
  };
}

interface CacheEntry {
  value: PriceDynamics;
  at: number;
}

export class ItadService {
  private cache = new Map<string, CacheEntry>();

  private getApiKey(): string {
    return process.env.ITAD_API_KEY || '';
  }

  private getCountry(): string {
    return process.env.ITAD_COUNTRY || 'RU';
  }

  isFunctionEnabled(): boolean {
    return this.getApiKey().length > 0;
  }

  getSupportedStores(): SupportedStore[] {
    return [...SUPPORTED_STORES];
  }

  /**
   * Ищет игру по APPID (Steam) или названию (любой магазин).
   * Контракт ITAD: параметры `key` и (`appid` или `title`), без `shop`.
   * Ответ: { found, game: { id, title } }
   */
  async lookupGame(store: SupportedStore, appIdOrTitle: string | number): Promise<string> {
    const key = this.getApiKey();
    if (!key) {
      throw new PriceDynamicsError('no_key', 'ITAD API key is not configured');
    }

    const params: Record<string, any> = { key };

    if (store === 'steam' && typeof appIdOrTitle === 'number') {
      params.appid = appIdOrTitle;
    } else {
      params.title = String(appIdOrTitle);
    }

    try {
      const response = await axios.get<RawGameLookup>(`${ITAD_API}/games/lookup/v1`, {
        params,
        timeout: 10000,
      });

      const found = response.data?.found ?? false;
      const id = response.data?.game?.id;

      if (!found || !id) {
        throw new PriceDynamicsError('not_found', `Game not found on ${store}`);
      }

      return id;
    } catch (error) {
      if (error instanceof PriceDynamicsError) {
        throw error;
      }

      throw new PriceDynamicsError(
        'upstream',
        `ITAD lookup failed: ${error instanceof Error ? error.message : 'unknown'}`
      );
    }
  }

  /**
   * Получает историю цены для игры на определённом магазине.
   * Результат кэшируется на CACHE_TTL_MS.
   */
  async getPriceDynamics(store: SupportedStore, appIdOrTitle: string | number): Promise<PriceDynamics> {
    if (!this.isFunctionEnabled()) {
      throw new PriceDynamicsError('no_key', 'ITAD API key is not configured');
    }

    if (!SUPPORTED_STORES.includes(store)) {
      throw new PriceDynamicsError('unsupported_shop', `Store ${store} is not supported`);
    }

    const cacheKey = `${store}:${appIdOrTitle}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }

    const gameId = await this.lookupGame(store, appIdOrTitle);
    const shopId = ITAD_SHOP_IDS[store];
    const country = this.getCountry();
    const key = this.getApiKey();

    let records: PriceRecord[] = [];
    let currency: string | null = null;

    try {
      const sinceDate = new Date('2000-01-01').toISOString().split('T')[0];
      const response = await axios.get<RawHistoryRecord[]>(`${ITAD_API}/games/history/v2`, {
        params: {
          key,
          id: gameId,
          country,
          shops: shopId,
          since: sinceDate,
        },
        timeout: 10000,
      });

      if (Array.isArray(response.data)) {
        // Отбросить записи чужого магазина, записи с нечисловой ценой (цена 0 — валидная), записи с невалидной датой
        const valid = response.data.filter((rec) => {
          if (rec.shop?.id !== shopId) return false;
          const amount = rec.deal?.price?.amount;
          if (typeof amount !== 'number' || isNaN(amount)) return false;
          if (!rec.timestamp) return false;
          return !isNaN(new Date(rec.timestamp).getTime());
        });

        records = valid.map((rec) => ({
          timestamp: rec.timestamp as string,
          price: rec.deal!.price!.amount as number,
        }));

        // Взять валюту из первой валидной записи
        for (const rec of valid) {
          if (rec.deal?.price?.currency) {
            currency = rec.deal.price.currency;
            break;
          }
        }
      }
    } catch (error) {
      throw new PriceDynamicsError(
        'upstream',
        `ITAD history fetch failed: ${error instanceof Error ? error.message : 'unknown'}`
      );
    }

    const analysis = analyzePriceHistory(records, Date.now());

    const result: PriceDynamics = {
      country,
      currency,
      shop: store,
      ...analysis,
    };

    // Кэш вытесняет по возрасту записи: перезапись переносит ключ в конец, без дубликатов
    this.cache.delete(cacheKey);
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(cacheKey, { value: result, at: Date.now() });

    return result;
  }

  /** Сбрасывает кэш. Нужен тестам. */
  resetCache(): void {
    this.cache.clear();
  }
}

export default new ItadService();
