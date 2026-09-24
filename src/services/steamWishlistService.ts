import axios from 'axios';
import { GameKind } from '../types.js';
import { detectGameKind } from '../parsers/helpers.js';
import { delay } from '../parsers/helpers.js';
import {
  COUNTRY_CODE,
  LANGUAGE,
  REQUEST_TIMEOUT,
  USER_AGENT,
  regionCurrency,
} from '../parsers/steamRegion.js';
import currencyService from './currencyService.js';

const STEAM_API = 'https://api.steampowered.com';
const STEAM_STORE = 'https://store.steampowered.com';
const STEAM_COMMUNITY = 'https://steamcommunity.com';
const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';

/** Сколько appid влезает в один запрос к GetItems. Проверено на 100 — отвечает целиком. */
const ITEMS_CHUNK = 100;

/** Пауза между чанками, чтобы не словить ограничение по частоте. В тестах — 0. */
const CHUNK_DELAY_MS = Number.parseInt(process.env.STEAM_WISHLIST_DELAY || '300', 10);

/**
 * Потолок разбора вишлиста. Встречаются аккаунты на десятки тысяч позиций — это сотни
 * запросов к Steam и гарантированный бан по частоте. Берём первые MAX_WISHLIST_ITEMS
 * по приоритету владельца, остальное отбрасываем и помечаем ответ как усечённый.
 */
export const MAX_WISHLIST_ITEMS = 2000;

/** Время жизни разобранного вишлиста в памяти процесса. */
const CACHE_TTL_MS = 15 * 60 * 1000;

/** Сколько вишлистов держим одновременно; самый старый вытесняется. */
const CACHE_MAX_ENTRIES = 50;

export type WishlistErrorCode = 'not_found' | 'empty_or_private' | 'upstream';

export class WishlistError extends Error {
  constructor(
    readonly code: WishlistErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'WishlistError';
  }
}

/** Позиция вишлиста в том же плоском виде, что и элемент списка в /api/games. */
export interface WishlistItem {
  appId: number;
  title: string;
  platform: 'steam';
  kind: GameKind;
  imageUrl: string | null;
  gameUrl: string;
  originalPrice: number | null;
  currentPrice: number | null;
  currency: string | null;
  currentPriceRub: number | null;
  discountPercent: number;
  isFree: boolean;
  /** Нет в продаже в регионе, снято с продажи или ещё не вышло — цены нет. */
  unavailable: boolean;
  saleEndDate: Date | null;
  addedAt: Date | null;
  priority: number;
}

export interface Wishlist {
  steamId: string;
  items: WishlistItem[];
  /** Позиций в вишлисте до применения потолка. */
  wishlistTotal: number;
  truncated: boolean;
}

interface RawWishlistEntry {
  appid: number;
  priority?: number;
  date_added?: number;
}

interface RawPurchaseOption {
  final_price_in_cents?: string;
  original_price_in_cents?: string;
  discount_pct?: number;
  active_discounts?: { discount_end_date?: number }[];
}

interface RawStoreItem {
  appid?: number;
  id?: number;
  success?: number;
  name?: string;
  store_url_path?: string;
  assets?: { asset_url_format?: string };
  best_purchase_option?: RawPurchaseOption;
}

const httpConfig = {
  timeout: REQUEST_TIMEOUT,
  headers: { 'User-Agent': USER_AGENT },
};

/** "38500" -> 385. Копейки приходят строкой. */
function centsToUnits(raw?: string): number | null {
  if (raw === undefined) return null;
  const cents = Number.parseInt(raw, 10);
  return Number.isFinite(cents) ? cents / 100 : null;
}

/** Unix-секунды -> Date. Ноль и мусор превращаются в null. */
function fromUnix(seconds?: number): Date | null {
  if (typeof seconds !== 'number' || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

export class SteamWishlistService {
  private cache = new Map<string, { value: Wishlist; at: number }>();

  /**
   * Приводит ввод пользователя к SteamID64. Принимает сам идентификатор, ссылку на
   * профиль в любой из двух форм и голое пользовательское имя.
   */
  async resolveSteamId(input: string): Promise<string> {
    const trimmed = input.trim();

    if (!trimmed) {
      throw new WishlistError('not_found', 'Укажите SteamID, ссылку на профиль или ник');
    }

    if (/^\d{17}$/.test(trimmed)) {
      return trimmed;
    }

    const byProfiles = trimmed.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
    if (byProfiles) {
      return byProfiles[1];
    }

    const byVanityUrl = trimmed.match(/steamcommunity\.com\/id\/([^/?#\s]+)/i);
    const vanity = byVanityUrl ? byVanityUrl[1] : trimmed;

    if (!/^[\w.-]{2,64}$/.test(vanity)) {
      throw new WishlistError(
        'not_found',
        'Не удалось распознать ввод: нужен SteamID64, ссылка на профиль или ник'
      );
    }

    return this.resolveVanity(vanity);
  }

  /**
   * Пользовательское имя -> SteamID64 через XML профиля. Официальный ResolveVanityURL
   * требует ключ Steam Web API, а этот ответ отдаётся анонимно.
   */
  private async resolveVanity(vanity: string): Promise<string> {
    let xml: string;

    try {
      const response = await axios.get<string>(
        `${STEAM_COMMUNITY}/id/${encodeURIComponent(vanity)}/?xml=1`,
        { ...httpConfig, responseType: 'text' }
      );
      xml = String(response.data);
    } catch (error) {
      throw new WishlistError(
        'upstream',
        `Steam не ответил на запрос профиля: ${error instanceof Error ? error.message : 'unknown'}`
      );
    }

    const match = xml.match(/<steamID64>(\d{17})<\/steamID64>/);
    if (!match) {
      throw new WishlistError('not_found', `Профиль «${vanity}» не найден`);
    }

    return match[1];
  }

  /**
   * Список желаемого по SteamID64. Пустой ответ означает либо пустой вишлист, либо
   * закрытый настройками приватности — Steam эти случаи не различает.
   */
  private async fetchWishlist(steamId: string): Promise<RawWishlistEntry[]> {
    let items: RawWishlistEntry[] | undefined;

    try {
      const response = await axios.get<{ response?: { items?: RawWishlistEntry[] } }>(
        `${STEAM_API}/IWishlistService/GetWishlist/v1/`,
        { ...httpConfig, params: { steamid: steamId } }
      );
      items = response.data?.response?.items;
    } catch (error) {
      throw new WishlistError(
        'upstream',
        `Steam не отдал список желаемого: ${error instanceof Error ? error.message : 'unknown'}`
      );
    }

    if (!items || items.length === 0) {
      throw new WishlistError(
        'empty_or_private',
        'Список желаемого пуст или закрыт настройками приватности профиля'
      );
    }

    return items;
  }

  /** Карточки магазина пачками по ITEMS_CHUNK: имя, картинка, цена и скидка. */
  private async fetchStoreItems(appIds: number[]): Promise<Map<number, RawStoreItem>> {
    const byAppId = new Map<number, RawStoreItem>();

    for (let i = 0; i < appIds.length; i += ITEMS_CHUNK) {
      const chunk = appIds.slice(i, i + ITEMS_CHUNK);

      if (i > 0) {
        await delay(CHUNK_DELAY_MS);
      }

      const payload = {
        ids: chunk.map((appid) => ({ appid })),
        context: {
          language: LANGUAGE,
          country_code: COUNTRY_CODE.toUpperCase(),
          steam_realm: 1,
        },
        data_request: {
          include_assets: true,
          include_basic_info: true,
          include_all_purchase_options: true,
        },
      };

      try {
        const response = await axios.get<{ response?: { store_items?: RawStoreItem[] } }>(
          `${STEAM_API}/IStoreBrowseService/GetItems/v1/`,
          { ...httpConfig, params: { input_json: JSON.stringify(payload) } }
        );

        for (const item of response.data?.response?.store_items ?? []) {
          const appId = item.appid ?? item.id;
          // Недоступные позиции Steam отдаёт с appid 0 — сопоставить их не с чем.
          if (typeof appId === 'number' && appId > 0) {
            byAppId.set(appId, item);
          }
        }
      } catch (error) {
        throw new WishlistError(
          'upstream',
          `Steam не отдал карточки товаров: ${error instanceof Error ? error.message : 'unknown'}`
        );
      }
    }

    return byAppId;
  }

  private async toItem(entry: RawWishlistEntry, raw: RawStoreItem | undefined): Promise<WishlistItem> {
    const appId = entry.appid;
    const title = raw?.name || `Приложение ${appId}`;
    const purchase = raw?.best_purchase_option;

    // success === 1 — товар доступен в регионе. Всё остальное (15 и прочие коды)
    // означает, что цены не будет: региональное ограничение, снят с продажи, не вышел.
    const available = raw?.success === 1 && purchase !== undefined;

    const currentPrice = available ? centsToUnits(purchase.final_price_in_cents) : null;
    const originalPrice = available
      ? (centsToUnits(purchase.original_price_in_cents) ?? currentPrice)
      : null;
    const currency = currentPrice === null ? null : regionCurrency();

    const assetFormat = raw?.assets?.asset_url_format;

    return {
      appId,
      title,
      platform: 'steam',
      kind: detectGameKind(title),
      imageUrl: assetFormat ? ASSET_BASE + assetFormat.replace('${FILENAME}', 'header.jpg') : null,
      gameUrl: raw?.store_url_path
        ? `${STEAM_STORE}/${raw.store_url_path}`
        : `${STEAM_STORE}/app/${appId}`,
      originalPrice,
      currentPrice,
      currency,
      currentPriceRub: await currencyService.toRub(currentPrice, currency),
      discountPercent: available ? (purchase.discount_pct ?? 0) : 0,
      isFree: currentPrice === 0,
      unavailable: currentPrice === null,
      saleEndDate: available ? fromUnix(purchase.active_discounts?.[0]?.discount_end_date) : null,
      addedAt: fromUnix(entry.date_added),
      priority: entry.priority ?? 0,
    };
  }

  /** Разобранный вишлист по вводу пользователя. Результат кэшируется на CACHE_TTL_MS. */
  async getWishlist(input: string): Promise<Wishlist> {
    const steamId = await this.resolveSteamId(input);

    const cached = this.cache.get(steamId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }

    const entries = await this.fetchWishlist(steamId);
    const wishlistTotal = entries.length;

    // priority 0 означает «без приоритета» и у Steam идёт в конец списка.
    const ordered = [...entries].sort((a, b) => {
      const left = a.priority || Number.MAX_SAFE_INTEGER;
      const right = b.priority || Number.MAX_SAFE_INTEGER;
      return left - right || a.appid - b.appid;
    });

    const limited = ordered.slice(0, MAX_WISHLIST_ITEMS);
    const storeItems = await this.fetchStoreItems(limited.map((entry) => entry.appid));

    const items = await Promise.all(
      limited.map((entry) => this.toItem(entry, storeItems.get(entry.appid)))
    );

    const value: Wishlist = {
      steamId,
      items,
      wishlistTotal,
      truncated: wishlistTotal > MAX_WISHLIST_ITEMS,
    };

    this.cache.set(steamId, { value, at: Date.now() });

    // Вытесняем самую старую запись; Map хранит порядок вставки.
    if (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) {
        this.cache.delete(oldest.value);
      }
    }

    return value;
  }

  /** Сбрасывает кэш. Нужен тестам. */
  resetCache(): void {
    this.cache.clear();
  }
}

export default new SteamWishlistService();
