import axios from 'axios';
import { load as loadHtml } from 'cheerio';
import { BaseParser } from './BaseParsers.js';
import { ParsedGame } from '../types.js';
import { dedupeByTitle, delay, parsePriceText } from './helpers.js';

const STEAM_STORE = 'https://store.steampowered.com';

// Регион магазина. По умолчанию — российский Steam: цены в рублях, названия и описания на русском.
const COUNTRY_CODE = process.env.STEAM_COUNTRY_CODE || 'ru';
const LANGUAGE = process.env.STEAM_LANGUAGE || 'russian';

// Сколько страниц поиска по акциям обойти (0 — не обходить вовсе, только витрину).
const SEARCH_PAGES = Number.parseInt(process.env.STEAM_SEARCH_PAGES || '3', 10);
const SEARCH_PAGE_SIZE = 100;

const REQUEST_TIMEOUT = 15000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/** Валюта региона, если Steam её не вернул явно. */
const FALLBACK_CURRENCY: Record<string, string> = {
  ru: 'RUB',
  kz: 'KZT',
  by: 'BYN',
  ua: 'UAH',
  us: 'USD',
};

interface SteamFeaturedItem {
  id: number;
  type?: number;
  name: string;
  discounted?: boolean;
  discount_percent?: number;
  original_price?: number | null;
  final_price?: number | null;
  currency?: string;
  discount_expiration?: number;
  header_image?: string;
  large_capsule_image?: string;
  small_capsule_image?: string;
}

interface SteamFeaturedCategory {
  id?: string;
  name?: string;
  items?: SteamFeaturedItem[];
}

interface SteamFeaturedCategoriesResponse {
  specials?: SteamFeaturedCategory;
  top_sellers?: SteamFeaturedCategory;
  new_releases?: SteamFeaturedCategory;
  coming_soon?: SteamFeaturedCategory;
  status?: number;
}

interface SteamSearchResponse {
  success?: number;
  results_html?: string;
  start?: number;
  total_count?: number;
}

/**
 * Парсер российского Steam.
 *
 * Данные берутся из двух источников:
 *   1. /api/featuredcategories/ — витрина (скидки, топ продаж, новинки) с точными ценами;
 *   2. /search/results/ с фильтром specials — полный список акций постранично.
 *
 * Оба запроса идут с cc/l региона, поэтому цены приходят в рублях, а названия — на русском.
 */
export class SteamParser extends BaseParser {
  constructor() {
    super('steam', `Steam (${COUNTRY_CODE.toUpperCase()})`);
  }

  async parse(): Promise<ParsedGame[]> {
    const games = new Map<number, ParsedGame>();

    const featured = await this.parseFeaturedCategories();
    for (const [appId, game] of featured) {
      games.set(appId, game);
    }

    if (SEARCH_PAGES > 0) {
      const specials = await this.parseSpecials();
      for (const [appId, game] of specials) {
        // Витрина отдаёт точные цены из API — не затираем её данными из HTML.
        if (!games.has(appId)) {
          games.set(appId, game);
        }
      }
    }

    const unique = dedupeByTitle([...games.values()]);

    console.log(
      `📊 Steam (${COUNTRY_CODE}/${LANGUAGE}): найдено ${unique.length} игр (витрина: ${featured.size})`
    );

    return unique;
  }

  /** Витрина магазина: скидки, топ продаж, новинки. */
  private async parseFeaturedCategories(): Promise<Map<number, ParsedGame>> {
    const games = new Map<number, ParsedGame>();

    try {
      const response = await axios.get<SteamFeaturedCategoriesResponse>(
        `${STEAM_STORE}/api/featuredcategories/`,
        {
          params: {
            cc: COUNTRY_CODE,
            l: LANGUAGE,
          },
          headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': `${COUNTRY_CODE},en;q=0.5`,
          },
          timeout: REQUEST_TIMEOUT,
        }
      );

      const data = response.data || {};

      // coming_soon намеренно пропущен: у неанонсированных игр нет цены,
      // и они бы попали в базу как «бесплатные».
      const categories: SteamFeaturedCategory[] = [
        data.specials || {},
        data.top_sellers || {},
        data.new_releases || {},
      ];

      for (const category of categories) {
        for (const item of category.items || []) {
          if (!item?.id || !item.name) continue;
          if (games.has(item.id)) continue;

          const game = this.toParsedGame(item);
          if (game) {
            games.set(item.id, game);
          }
        }
      }
    } catch (error) {
      console.error('❌ Steam витрина, ошибка:', error instanceof Error ? error.message : error);
    }

    return games;
  }

  /** Постраничный обход специальных предложений через поиск магазина. */
  private async parseSpecials(): Promise<Map<number, ParsedGame>> {
    const games = new Map<number, ParsedGame>();

    for (let page = 0; page < SEARCH_PAGES; page++) {
      try {
        const response = await axios.get<SteamSearchResponse>(`${STEAM_STORE}/search/results/`, {
          params: {
            query: '',
            start: page * SEARCH_PAGE_SIZE,
            count: SEARCH_PAGE_SIZE,
            sort_by: '_ASC',
            specials: 1,
            infinite: 1,
            json: 1,
            dynamic_data: '',
            cc: COUNTRY_CODE,
            l: LANGUAGE,
          },
          headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': `${COUNTRY_CODE},en;q=0.5`,
          },
          timeout: REQUEST_TIMEOUT,
        });

        const html = response.data?.results_html;
        if (!html) break;

        const parsed = this.parseSearchHtml(html);
        if (parsed.size === 0) break;

        for (const [appId, game] of parsed) {
          if (!games.has(appId)) {
            games.set(appId, game);
          }
        }

        const total = response.data?.total_count ?? 0;
        if (total > 0 && (page + 1) * SEARCH_PAGE_SIZE >= total) break;

        // Steam не любит частые запросы к поиску.
        await delay(700);
      } catch (error) {
        console.error(
          `❌ Steam акции, страница ${page + 1}:`,
          error instanceof Error ? error.message : error
        );
        break;
      }
    }

    return games;
  }

  /** Разбор HTML-выдачи поиска: одна карточка игры — один <a class="search_result_row">. */
  private parseSearchHtml(html: string): Map<number, ParsedGame> {
    const games = new Map<number, ParsedGame>();
    const $ = loadHtml(html);
    const currency = FALLBACK_CURRENCY[COUNTRY_CODE.toLowerCase()];

    $('a.search_result_row').each((_, element) => {
      const row = $(element);

      const appId = Number.parseInt(row.attr('data-ds-appid') || '', 10);
      const title = row.find('.title').first().text().trim();
      if (!Number.isFinite(appId) || !title) return;

      const priceBlock = row.find('.discount_block').first();
      const finalRaw = priceBlock.attr('data-price-final');
      if (!finalRaw) return; // нет данных о цене — скорее всего F2P или игра недоступна в регионе

      const currentPrice = Number.parseInt(finalRaw, 10) / 100;
      if (!Number.isFinite(currentPrice)) return;

      const discountPercent = Number.parseInt(priceBlock.attr('data-discount') || '0', 10) || 0;

      const originalFromText = parsePriceText(
        row.find('.discount_original_price').first().text()
      );
      const originalPrice =
        originalFromText ??
        (discountPercent > 0 && discountPercent < 100
          ? Math.round((currentPrice / (1 - discountPercent / 100)) * 100) / 100
          : currentPrice);

      games.set(appId, {
        title,
        platform: 'steam',
        originalPrice,
        currentPrice,
        discountPercent,
        isFree: currentPrice === 0,
        gameUrl: `${STEAM_STORE}/app/${appId}`,
        imageUrl: row.find('.search_capsule img').first().attr('src') || undefined,
        currency,
      });
    });

    return games;
  }

  /** Элемент витрины -> ParsedGame. Цены Steam отдаёт в копейках/центах. */
  private toParsedGame(item: SteamFeaturedItem): ParsedGame | null {
    const finalPrice = item.final_price;
    if (finalPrice === undefined || finalPrice === null) return null;

    const currentPrice = finalPrice / 100;
    const originalRaw = item.original_price;
    const originalPrice =
      originalRaw !== undefined && originalRaw !== null && originalRaw > 0
        ? originalRaw / 100
        : currentPrice;

    return {
      title: item.name.trim(),
      platform: 'steam',
      originalPrice,
      currentPrice,
      discountPercent: item.discount_percent || 0,
      isFree: currentPrice === 0,
      gameUrl: `${STEAM_STORE}/app/${item.id}`,
      imageUrl: item.header_image || item.large_capsule_image || item.small_capsule_image,
      currency: item.currency || FALLBACK_CURRENCY[COUNTRY_CODE.toLowerCase()],
      saleEndDate: item.discount_expiration ? new Date(item.discount_expiration * 1000) : undefined,
    };
  }

}

export default SteamParser;
