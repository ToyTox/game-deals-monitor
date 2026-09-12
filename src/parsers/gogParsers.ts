import axios from 'axios';
import { BaseParser } from './BaseParsers.js';
import { parsePriceText } from './helpers.js';
import { ParsedGame } from '../types.js';

// Витринный API магазина: тот же, что питает catalog.gog.com. Версионных гарантий у него нет,
// поэтому URL и параметры закреплены тестами — прошлый эндпоинт молча отвечал 404.
const GOG_CATALOG = 'https://catalog.gog.com/v1/catalog';
const STORE_URL = 'https://www.gog.com/ru/game/';
const PAGE_SIZE = 48;
/** Каталог — тысячи страниц; берём верхушку по скидке, как и раньше. */
const MAX_PAGES = 5;
// Регион как у Steam (STEAM_COUNTRY_CODE=ru), чтобы цены в каталоге были в одной валюте.
const COUNTRY_CODE = 'RU';
const CURRENCY = 'RUB';
const LOCALE = 'ru-RU';
const REQUEST_TIMEOUT = 15000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

interface GogMoney {
  amount?: string;
  currency?: string;
}

interface GogPrice {
  final?: string;
  base?: string;
  /** "-95%" у скидки и null у изначально бесплатных. */
  discount?: string | null;
  finalMoney?: GogMoney;
  baseMoney?: GogMoney;
}

/** Необязательно всё, что API может не прислать: прошлый интерфейс врал о структуре. */
interface GogProduct {
  id?: string;
  slug?: string;
  title?: string;
  coverHorizontal?: string;
  storeLink?: string;
  productType?: string;
  price?: GogPrice | null;
}

interface GogCatalogResponse {
  pages?: number;
  productCount?: number;
  products?: GogProduct[];
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

/** Суммы приходят строками: "33", "1399", "1.49". */
function parseMoney(money?: GogMoney): number | undefined {
  const value = Number.parseFloat(money?.amount ?? '');
  return Number.isFinite(value) ? value : undefined;
}

function parseDiscountPercent(
  price: GogPrice | null | undefined,
  originalPrice?: number,
  currentPrice?: number
): number {
  if (price?.discount) {
    const parsed = Number.parseInt(price.discount.replace('%', ''), 10);
    if (Number.isFinite(parsed)) return clampPercent(Math.abs(parsed));
  }

  // У бесплатных discount пустой — считаем сами, если базовая цена вообще есть.
  if (originalPrice && originalPrice > 0 && currentPrice !== undefined) {
    return clampPercent(Math.round((1 - currentPrice / originalPrice) * 100));
  }

  return 0;
}

export class GOGParser extends BaseParser {
  constructor() {
    super('gog', 'GOG.com');
  }

  async parse(): Promise<ParsedGame[]> {
    const games: ParsedGame[] = [];

    try {
      let page = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        const response = await this.fetchPage({
          order: 'desc:discount',
          productType: 'in:game,pack',
          page,
        });

        const products = response.data?.products;
        if (!products || products.length === 0) break;

        for (const item of products) {
          const game = this.toParsedGame(item);
          if (game) games.push(game);
        }

        hasMorePages = page < (response.data.pages || 1) && page < MAX_PAGES;
        page++;
      }

      const freeGames = await this.parseFreeGames();
      games.push(...freeGames);

      console.log(`📊 GOG: найдено ${games.length} игр`);
      return games;
    } catch (error) {
      console.error('❌ GOG парсер ошибка:', error);
      return [];
    }
  }

  /** Один запрос на оба прохода: общий URL, регион и таймаут. */
  private fetchPage(params: Record<string, string | number>) {
    return axios.get<GogCatalogResponse>(GOG_CATALOG, {
      params: {
        limit: PAGE_SIZE,
        countryCode: COUNTRY_CODE,
        locale: LOCALE,
        currencyCode: CURRENCY,
        ...params,
      },
      headers: {
        'User-Agent': USER_AGENT,
      },
      timeout: REQUEST_TIMEOUT,
    });
  }

  private toParsedGame(item: GogProduct): ParsedGame | undefined {
    const gameUrl = item.storeLink || (item.slug ? `${STORE_URL}${item.slug}` : undefined);
    // gameUrl и title — обязательные колонки, запись без них сохранить нельзя.
    if (!item.title || !gameUrl) return undefined;

    const price = item.price;
    const currentPrice = parseMoney(price?.finalMoney) ?? parsePriceText(price?.final);
    const originalPrice = parseMoney(price?.baseMoney) ?? parsePriceText(price?.base);

    return {
      title: item.title,
      platform: 'gog',
      currency: price?.finalMoney?.currency || CURRENCY,
      originalPrice,
      currentPrice,
      discountPercent: parseDiscountPercent(price, originalPrice, currentPrice),
      isFree: currentPrice === 0,
      gameUrl,
      imageUrl: item.coverHorizontal,
    };
  }

  private async parseFreeGames(): Promise<ParsedGame[]> {
    const games: ParsedGame[] = [];

    try {
      // productType отсекает DLC и «прочее», но не демки: у них тоже productType: "game",
      // так что в бесплатные по-прежнему попадают демоверсии — как и до правки.
      const response = await this.fetchPage({
        price: 'between:0,0',
        productType: 'in:game,pack',
        page: 1,
      });

      for (const item of response.data?.products ?? []) {
        const game = this.toParsedGame(item);
        if (!game) continue;

        // Скидку не выставляем в 100 насильно: у изначально бесплатной игры базовой цены нет.
        games.push({ ...game, currentPrice: 0, isFree: true });
      }
    } catch (error) {
      console.error('❌ GOG Free Games парсер ошибка:', error);
    }

    return games;
  }
}

export default GOGParser;
