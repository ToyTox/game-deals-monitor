import axios from 'axios';
import { BaseParser } from './BaseParsers.js';
import { ParsedGame } from '../types.js';
import { dedupeByTitle, delay, parseMoscowDate } from './helpers.js';

const VKPLAY_API = 'https://api.vkplay.ru/play/games/';
const VKPLAY_STORE = 'https://vkplay.ru/play/game';

// API отдаёт не больше 75 записей на страницу (limit=200 и 1000 тоже дают 75).
// Стандартные 24 превращали обход каталога в ~426 запросов.
const PAGE_SIZE = 75;

function intFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

// Сколько страниц каталога обойти. 0 (и нечисловое значение) — весь каталог.
const MAX_PAGES = intFromEnv('VKPLAY_MAX_PAGES', 0);

// По умолчанию сохраняем только игры со скидкой: полный каталог — это ~10 000 записей.
const ONLY_DISCOUNTED = process.env.VKPLAY_ONLY_DISCOUNTED !== 'false';

// Пауза между запросами одного воркера, мс.
const REQUEST_DELAY = intFromEnv('VKPLAY_REQUEST_DELAY', 300);

// Сколько страниц грузить одновременно. На 8 параллельных запросах API начинает рвать соединения.
const CONCURRENCY = Math.max(1, intFromEnv('VKPLAY_CONCURRENCY', 3));

// Соединение с API периодически обрывается даже без нагрузки — страницу повторяем.
const MAX_ATTEMPTS = 3;
// Базовая пауза перед повтором, мс; растёт с номером попытки.
const RETRY_DELAY = intFromEnv('VKPLAY_RETRY_DELAY', 1000);

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
 * Данные берутся из постраничного обхода каталога API (/play/games/?page=N&limit=75).
 * Фильтров для скидок нет, поэтому отбор по has_discount делается на нашей стороне,
 * а каталог приходится обходить целиком. Первая страница задаёт число страниц
 * (по count), остальные грузятся параллельно пулом из VKPLAY_CONCURRENCY воркеров.
 */
export class VkPlayParser extends BaseParser {
  constructor() {
    super('vkplay', 'VK Play');
  }

  async parse(): Promise<ParsedGame[]> {
    const first = await this.fetchPage(1);
    // Без первой страницы нечего сохранять: пусть площадка честно упадёт,
    // а не отчитается об успехе с нулём игр
    if (!first) {
      throw new Error('VK Play: не удалось загрузить первую страницу каталога');
    }

    const lastPage = this.countPages(first);
    // Индекс — номер страницы минус один; разбираем строго по порядку,
    // чтобы дедупликация не зависела от того, какой воркер ответил раньше
    const pages: VkPlayGame[][] = [first.results || []];
    const failed: number[] = [];
    let nextPage = 2;

    const worker = async () => {
      while (nextPage <= lastPage) {
        const page = nextPage++;
        await delay(REQUEST_DELAY);
        const response = await this.fetchPage(page);
        if (response) {
          pages[page - 1] = response.results || [];
        } else {
          failed.push(page);
        }
      }
    };

    const workers = Math.min(CONCURRENCY, lastPage - 1);
    await Promise.all(Array.from({ length: workers }, worker));

    if (failed.length > 0) {
      console.warn(
        `⚠️  VK Play: пропущены страницы ${failed.sort((a, b) => a - b).join(', ')} — не ответили за ${MAX_ATTEMPTS} попытки`
      );
    }

    const games = new Map<number, ParsedGame>();
    for (const results of pages) {
      for (const item of results ?? []) {
        if (games.has(item.id)) continue;

        const game = this.toParsedGame(item);
        if (game) {
          games.set(item.id, game);
        }
      }
    }

    const unique = dedupeByTitle([...games.values()]);

    console.log(
      `📊 VK Play: найдено ${unique.length} игр (${ONLY_DISCOUNTED ? 'только со скидкой' : 'все продаваемые'})`
    );

    return unique;
  }

  /**
   * Сколько страниц обойти: по count и фактическому размеру первой страницы
   * (API может отдать меньше запрошенного limit), с учётом VKPLAY_MAX_PAGES.
   */
  private countPages(first: VkPlayListResponse): number {
    const size = first.results?.length ?? 0;
    if (!first.next || size === 0) return 1;

    if (!first.count) {
      console.warn('⚠️  VK Play: API не отдал count — обходим только первую страницу');
      return 1;
    }

    const total = Math.ceil(first.count / size);
    return MAX_PAGES > 0 ? Math.min(total, MAX_PAGES) : total;
  }

  /**
   * Получить страницу каталога. Соединение с API периодически рвётся, поэтому
   * страница запрашивается до MAX_ATTEMPTS раз; если все попытки неудачны — null.
   */
  private async fetchPage(page: number): Promise<VkPlayListResponse | null> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await axios.get<VkPlayListResponse>(VKPLAY_API, {
          params: { page, limit: PAGE_SIZE },
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json',
          },
          timeout: REQUEST_TIMEOUT,
        });

        return response.data || null;
      } catch (error) {
        console.error(
          `❌ VK Play, страница ${page}, попытка ${attempt}/${MAX_ATTEMPTS}:`,
          error instanceof Error ? error.message : error
        );
        if (attempt < MAX_ATTEMPTS) {
          await delay(RETRY_DELAY * attempt);
        }
      }
    }

    return null;
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
      storeId: 'vkplay',
      originalPrice,
      currentPrice,
      discountPercent: cost.discount || 0,
      isFree: currentPrice === 0,
      // item.url содержит реферальный mt_link_id — собираем чистую ссылку из slug.
      gameUrl: `${VKPLAY_STORE}/${item.slug}/`,
      imageUrl: item.picture_horizontal || item.picture || item.logo,
      description: description || undefined,
      currency: cost.currency || 'RUB',
      saleEndDate: parseMoscowDate(cost.date_end),
    };
  }

}

export default VkPlayParser;
