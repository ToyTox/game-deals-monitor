import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import VkPlayParser from '../../src/parsers/vkPlayParsers.js';
import { ParsedGame } from '../../src/types.js';
import { readJsonFixture } from '../helpers/fixtures.js';
import { withEnv } from '../helpers/withEnv.js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const mockedGet = axios.get as unknown as Mock;

const page1 = readJsonFixture('vkplay-page1.json');
const page2 = readJsonFixture('vkplay-page2.json');

const byTitle = (games: ParsedGame[], title: string) => games.find((g) => g.title === title);

function mockPages() {
  mockedGet.mockResolvedValueOnce({ data: page1 }).mockResolvedValueOnce({ data: page2 });
}

function vkItem(id: number, name: string) {
  return {
    id,
    slug: `game-${id}`,
    name,
    is_sellable: true,
    cost_info: { has_discount: true, actual_cost: 100, original_cost: 200, discount: 50 },
  };
}

/** Каталог из pageCount страниц по perPage записей: «Игра <страница>-<позиция>». */
function catalog(pageCount: number, perPage = 3) {
  return Array.from({ length: pageCount }, (_, i) => ({
    count: pageCount * perPage,
    next: i < pageCount - 1 ? `https://api.test/?page=${i + 2}` : null,
    results: Array.from({ length: perPage }, (_, j) => vkItem(i * perPage + j + 1, `Игра ${i + 1}-${j + 1}`)),
  }));
}

/**
 * Отвечать по номеру страницы, а не по порядку вызовов: воркеры и повторы
 * перемешивают очередность запросов. failures — сколько раз подряд странице упасть.
 */
function serve(pages: ReturnType<typeof catalog>, failures: Record<number, number> = {}) {
  mockedGet.mockImplementation(async (_url: string, config: { params: { page: number } }) => {
    const page = config.params.page;
    if ((failures[page] ?? 0) > 0) {
      failures[page]--;
      throw new Error(`страница ${page} недоступна`);
    }
    return { data: pages[page - 1] };
  });
}

// В vitest.config VKPLAY_MAX_PAGES=2 — для каталогов длиннее снимаем лимит
const loadUnlimited = () =>
  withEnv({ VKPLAY_MAX_PAGES: '0' }, () => import('../../src/parsers/vkPlayParsers.js'));

describe('VkPlayParser', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  describe('преобразование записи каталога', () => {
    // Ключевая асимметрия с Steam: VK Play отдаёт цены сразу в рублях.
    // Если кто-то «приведёт парсеры к единому виду» и добавит /100,
    // цены разъедутся в сто раз — этот тест для того и написан.
    it('берёт цены как есть, без деления на 100', async () => {
      mockPages();

      expect(byTitle(await new VkPlayParser().parse(), 'Atomic Heart')).toMatchObject({
        platform: 'vkplay',
        originalPrice: 2999,
        currentPrice: 1999,
        discountPercent: 33,
        currency: 'RUB',
        isFree: false,
      });
    });

    it('обрезает пробелы в названии', async () => {
      mockPages();

      expect(byTitle(await new VkPlayParser().parse(), 'Atomic Heart')).toBeDefined();
    });

    // item.url содержит реферальный mt_link_id — ссылку собираем из slug.
    it('собирает чистую ссылку из slug', async () => {
      mockPages();

      expect(byTitle(await new VkPlayParser().parse(), 'Atomic Heart')?.gameUrl).toBe(
        'https://vkplay.ru/play/game/atomic-heart/'
      );
    });

    it('берёт первую доступную картинку из трёх полей', async () => {
      mockPages();
      const games = await new VkPlayParser().parse();

      expect(byTitle(games, 'Atomic Heart')?.imageUrl).toBe('https://cdn.test/101/horizontal.jpg');
      expect(byTitle(games, 'Бесплатная раздача')?.imageUrl).toBe('https://cdn.test/201/logo.jpg');
    });

    it('считает бесплатной игру с нулевой ценой', async () => {
      mockPages();

      expect(byTitle(await new VkPlayParser().parse(), 'Бесплатная раздача')).toMatchObject({
        currentPrice: 0,
        isFree: true,
        discountPercent: 100,
      });
    });

    it('разбирает дату окончания скидки как московское время', async () => {
      mockPages();

      expect(
        byTitle(await new VkPlayParser().parse(), 'Atomic Heart')?.saleEndDate?.toISOString()
      ).toBe('2031-02-22T21:00:00.000Z');
    });
  });

  describe('отбрасывание записей', () => {
    it('пропускает недоступные к покупке, без cost_info, без slug и без цены', async () => {
      mockPages();
      const titles = (await new VkPlayParser().parse()).map((g) => g.title);

      expect(titles).not.toContain('Недоступна к покупке');
      expect(titles).not.toContain('Без блока цены');
      expect(titles).not.toContain('Без slug');
      expect(titles).not.toContain('Без актуальной цены');
    });

    it('по умолчанию сохраняет только игры со скидкой', async () => {
      mockPages();

      expect(byTitle(await new VkPlayParser().parse(), 'Игра без скидки')).toBeUndefined();
    });

    it('при VKPLAY_ONLY_DISCOUNTED=false берёт и игры без скидки', async () => {
      const { VkPlayParser: Parser } = await withEnv({ VKPLAY_ONLY_DISCOUNTED: 'false' }, () =>
        import('../../src/parsers/vkPlayParsers.js')
      );

      mockPages();

      expect(byTitle(await new Parser().parse(), 'Игра без скидки')).toBeDefined();
    });
  });

  describe('постраничный обход', () => {
    it('запрашивает страницы по 75 записей — максимум, который отдаёт API', async () => {
      mockPages();
      await new VkPlayParser().parse();

      expect(mockedGet).toHaveBeenCalledTimes(2);
      expect(mockedGet.mock.calls[0][1]?.params).toEqual({ page: 1, limit: 75 });
      expect(mockedGet.mock.calls[1][1]?.params).toEqual({ page: 2, limit: 75 });
    });

    it('считает число страниц по count и не запрашивает лишнего', async () => {
      const { VkPlayParser: Parser } = await loadUnlimited();
      const pages = catalog(3);
      // Даже если последняя страница по ошибке ссылается дальше — count главнее
      pages[2].next = 'https://api.test/?page=4';
      serve(pages);

      const games = await new Parser().parse();

      expect(mockedGet).toHaveBeenCalledTimes(3);
      expect(games).toHaveLength(9);
    });

    it('собирает игры в порядке страниц, даже если ответы пришли вразнобой', async () => {
      const { VkPlayParser: Parser } = await loadUnlimited();
      const pages = catalog(4);
      serve(pages, { 2: 1 });

      const titles = (await new Parser().parse()).map((g) => g.title);

      expect(titles.slice(0, 6)).toEqual(['Игра 1-1', 'Игра 1-2', 'Игра 1-3', 'Игра 2-1', 'Игра 2-2', 'Игра 2-3']);
    });

    it('останавливается, когда next пуст', async () => {
      mockedGet.mockResolvedValueOnce({ data: page2 });
      await new VkPlayParser().parse();

      expect(mockedGet).toHaveBeenCalledTimes(1);
    });

    it('останавливается на пустом списке результатов', async () => {
      mockedGet.mockResolvedValueOnce({ data: { next: 'есть', results: [] } });
      await new VkPlayParser().parse();

      expect(mockedGet).toHaveBeenCalledTimes(1);
    });

    // Соединение с API VK Play периодически рвётся: раньше первая же ошибка
    // молча обрывала обход, и в базу уезжала только часть каталога.
    it('повторяет упавшую страницу и не теряет её игры', async () => {
      const { VkPlayParser: Parser } = await loadUnlimited();
      serve(catalog(3), { 2: 1 });

      const titles = (await new Parser().parse()).map((g) => g.title);

      expect(titles).toContain('Игра 2-1');
      expect(mockedGet).toHaveBeenCalledTimes(4);
    });

    it('страница, не ответившая за все попытки, пропускается, а обход продолжается', async () => {
      const { VkPlayParser: Parser } = await loadUnlimited();
      serve(catalog(3), { 2: 3 });

      const titles = (await new Parser().parse()).map((g) => g.title);

      expect(titles).toContain('Игра 1-1');
      expect(titles).not.toContain('Игра 2-1');
      expect(titles).toContain('Игра 3-1');
      expect(mockedGet).toHaveBeenCalledTimes(5);
    });

    it('если не ответила даже первая страница — площадка падает с ошибкой', async () => {
      serve(catalog(1), { 1: 3 });

      await expect(new VkPlayParser().parse()).rejects.toThrow('первую страницу');
      expect(mockedGet).toHaveBeenCalledTimes(3);
    });

    it('не ходит дальше лимита VKPLAY_MAX_PAGES', async () => {
      const { VkPlayParser: Parser } = await withEnv({ VKPLAY_MAX_PAGES: '1' }, () =>
        import('../../src/parsers/vkPlayParsers.js')
      );

      mockPages();
      await new Parser().parse();

      expect(mockedGet).toHaveBeenCalledTimes(1);
    });

    // Раньше NaN из parseInt давал ноль игр с отчётом об успехе
    it('нечисловой VKPLAY_MAX_PAGES означает весь каталог', async () => {
      const { VkPlayParser: Parser } = await withEnv({ VKPLAY_MAX_PAGES: 'abc' }, () =>
        import('../../src/parsers/vkPlayParsers.js')
      );

      mockPages();

      expect(await new Parser().parse()).not.toEqual([]);
      expect(mockedGet).toHaveBeenCalledTimes(2);
    });
  });
});
