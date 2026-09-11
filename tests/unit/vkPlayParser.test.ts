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
    it('идёт на следующую страницу, пока API отдаёт next', async () => {
      mockPages();
      await new VkPlayParser().parse();

      expect(mockedGet).toHaveBeenCalledTimes(2);
      expect(mockedGet.mock.calls[0][1]?.params).toEqual({ page: 1 });
      expect(mockedGet.mock.calls[1][1]?.params).toEqual({ page: 2 });
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

    // В отличие от Steam, ошибка страницы здесь не фатальна:
    // fetchPage возвращает null, обход прерывается, но уже собранное сохраняется.
    it('при ошибке страницы возвращает частичный результат', async () => {
      mockedGet
        .mockResolvedValueOnce({ data: page1 })
        .mockRejectedValueOnce(new Error('network down'));

      const games = await new VkPlayParser().parse();

      expect(byTitle(games, 'Atomic Heart')).toBeDefined();
      expect(byTitle(games, 'Бесплатная раздача')).toBeUndefined();
    });

    it('не ходит дальше лимита VKPLAY_MAX_PAGES', async () => {
      const { VkPlayParser: Parser } = await withEnv({ VKPLAY_MAX_PAGES: '1' }, () =>
        import('../../src/parsers/vkPlayParsers.js')
      );

      mockPages();
      await new Parser().parse();

      expect(mockedGet).toHaveBeenCalledTimes(1);
    });

    // БАГ (зафиксировано текущее поведение): нечисловое значение даёт NaN,
    // условие `page <= NaN` ложно с первой итерации, и парсер молча возвращает
    // ноль игр, отчитавшись об успехе. Починка — Number.isFinite(MAX) ? MAX : 0.
    it('БУДУЩИЙ БАГФИКС: нечисловой VKPLAY_MAX_PAGES тихо даёт ноль игр', async () => {
      const { VkPlayParser: Parser } = await withEnv({ VKPLAY_MAX_PAGES: 'abc' }, () =>
        import('../../src/parsers/vkPlayParsers.js')
      );

      mockPages();

      expect(await new Parser().parse()).toEqual([]);
      expect(mockedGet).not.toHaveBeenCalled();
    });
  });
});
