import axios from 'axios';
import { BaseParser } from './BaseParsers.js';
import { ParsedGame } from '../types.js';

const VKPLAY_API = 'https://api.vkplay.ru/play/games/';
const VKPLAY_STORE = 'https://vkplay.ru/play/game';

// Сколько страниц каталога обойти. 0 — идти до конца (пока API отдаёт next).
const MAX_PAGES = Number.parseInt(process.env.VKPLAY_MAX_PAGES || '0', 10);

// По умолчанию сохраняем только игры со скидкой: полный каталог — это ~9000 записей.
const ONLY_DISCOUNTED = process.env.VKPLAY_ONLY_DISCOUNTED !== 'false';

// Пауза между страницами, мс.
const REQUEST_DELAY = Number.parseInt(process.env.VKPLAY_REQUEST_DELAY || '300', 10);

const REQUEST_TIMEOUT = 15000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

interface VkPlayCostInfo {
  currency?: string;
  original_cost?: number | null;
  actual_cost?: number | null;
  has_discount?: boolean;
  discount?: number;
  discount_val?: number;
  /** Наивная дата по московскому времени: "2031-02-23 00:00:00". Пустая строка — скидки нет. */
  date_end?: string;
}

interface VkPlayGame {
  id: number;
  slug?: string;
  name?: string;
  is_sellable?: boolean;
  cost_info?: VkPlayCostInfo | null;
  picture_horizontal?: string;
  picture?: string;
  logo?: string;
  short_descr?: string;
  descr?: string;
}

interface VkPlayListResponse {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: VkPlayGame[];
}

/**
 * Парсер каталога VK Play.
 *
 * Данные берутся из постраничного обхода каталога API (/play/games/?page=N).
 * API отдаёт до 24 записей на странице. Фильтров для скидок нет,
 * поэтому отбор по has_discount делается на нашей стороне.
 */
export class VkPlayParser extends BaseParser {
  constructor() {
    super('vkplay', 'VK Play');
  }

  async parse(): Promise<ParsedGame[]> {
    const games = new Map<number, ParsedGame>();

    for (let page = 1; MAX_PAGES <= 0 || page <= MAX_PAGES; page++) {
      const response = await this.fetchPage(page);
      if (!response) break;

      const results = response.results || [];
      if (results.length === 0) break;

      for (const item of results) {
        if (games.has(item.id)) continue;

        const game = this.toParsedGame(item);
        if (game) {
          games.set(item.id, game);
        }
      }

      if (!response.next) break;
      await this.delay(REQUEST_DELAY);
    }

    const unique = this.dedupeByTitle([...games.values()]);

    console.log(
      `📊 VK Play: найдено ${unique.length} игр (${ONLY_DISCOUNTED ? 'только со скидкой' : 'все продаваемые'})`
    );

    return unique;
  }

  /**
   * Получить страницу каталога. При ошибке логирует и возвращает null
   * — частичный результат всё равно сохранится.
   */
  private async fetchPage(page: number): Promise<VkPlayListResponse | null> {
    try {
      const response = await axios.get<VkPlayListResponse>(VKPLAY_API, {
        params: { page },
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
        timeout: REQUEST_TIMEOUT,
      });

      return response.data || null;
    } catch (error) {
      console.error(
        `❌ VK Play, страница ${page}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Преобразовать запись API в ParsedGame.
   * Цены VK Play приходят целиком в рублях, делить на 100 не надо.
   */
  private toParsedGame(item: VkPlayGame): ParsedGame | null {
    const cost = item.cost_info;

    if (!item.is_sellable || !cost || !item.name || !item.slug) return null;
    if (ONLY_DISCOUNTED && cost.has_discount !== true) return null;

    const actual = cost.actual_cost;
    if (actual === undefined || actual === null) return null;

    const currentPrice = actual;
    const originalRaw = cost.original_cost;
    const originalPrice =
      originalRaw !== undefined && originalRaw !== null && originalRaw > 0 ? originalRaw : currentPrice;

    const description = (item.short_descr || item.descr || '').trim();

    return {
      title: item.name.trim(),
      platform: 'vkplay',
      originalPrice,
      currentPrice,
      discountPercent: cost.discount || 0,
      isFree: currentPrice === 0,
      // item.url содержит реферальный mt_link_id — собираем чистую ссылку из slug.
      gameUrl: `${VKPLAY_STORE}/${item.slug}/`,
      imageUrl: item.picture_horizontal || item.picture || item.logo,
      description: description || undefined,
      currency: cost.currency || 'RUB',
      saleEndDate: this.parseSaleEndDate(cost.date_end),
    };
  }

  /**
   * Пара (title, platform) в базе уникальна, поэтому одинаковые названия внутри одного
   * прогона схлопываем заранее — иначе одна и та же запись создаётся и тут же перезаписывается.
   */
  private dedupeByTitle(games: ParsedGame[]): ParsedGame[] {
    const byTitle = new Map<string, ParsedGame>();

    for (const game of games) {
      const key = game.title.toLowerCase();
      const existing = byTitle.get(key);

      // Из дублей оставляем вариант с большей скидкой.
      if (!existing || game.discountPercent > existing.discountPercent) {
        byTitle.set(key, game);
      }
    }

    return [...byTitle.values()];
  }

  /**
   * API отдаёт наивную строку по московскому времени.
   */
  private parseSaleEndDate(raw?: string): Date | undefined {
    if (!raw) return undefined;

    const date = new Date(`${raw.replace(' ', 'T')}+03:00`);
    return Number.isFinite(date.getTime()) ? date : undefined;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default VkPlayParser;
