import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import GOGParser from '../../src/parsers/gogParsers.js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const mockedGet = axios.get as unknown as Mock;

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gog-1',
    title: 'Cyberpunk 2077',
    url: '/game/cyberpunk_2077',
    image: 'https://cdn.test/cp2077.jpg',
    normalPrice: 59.99,
    finalPrice: 29.99,
    discount: 50,
    ...overrides,
  };
}

/** Каталог отдаёт одну страницу, затем идёт запрос бесплатных игр. */
function mockSinglePage(products: unknown[], freeProducts: unknown[] = []) {
  mockedGet
    .mockResolvedValueOnce({ data: { products, totalPages: 1 } })
    .mockResolvedValueOnce({ data: { products: freeProducts } });
}

describe('GOGParser', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  describe('преобразование записи', () => {
    // В отличие от Steam и Epic, API GOG отдаёт цены уже в единицах валюты.
    it('берёт цены как есть, без деления на 100', async () => {
      mockSinglePage([product()]);

      expect((await new GOGParser().parse())[0]).toMatchObject({
        title: 'Cyberpunk 2077',
        platform: 'gog',
        originalPrice: 59.99,
        currentPrice: 29.99,
        discountPercent: 50,
        isFree: false,
        gameUrl: 'https://www.gog.com/game/cyberpunk_2077',
        imageUrl: 'https://cdn.test/cp2077.jpg',
      });
    });

    it('жёстко проставляет валюту USD', async () => {
      mockSinglePage([product()]);

      expect((await new GOGParser().parse())[0].currency).toBe('USD');
    });

    it('считает бесплатной игру с нулевой финальной ценой', async () => {
      mockSinglePage([product({ finalPrice: 0 })]);

      expect((await new GOGParser().parse())[0]).toMatchObject({ currentPrice: 0, isFree: true });
    });
  });

  /**
   * GOG — единственный парсер, который не схлопывает дубли по названию.
   * Последствие видно в saveGames: две записи с одним title за один прогон
   * сначала создают строку, потом её же обновляют, и в отчёт попадают
   * одновременно и «новая», и «обновлённая» игра.
   */
  it('дубли по названию не схлопывает', async () => {
    mockSinglePage([product({ discount: 20 }), product({ id: 'gog-2', discount: 70 })]);

    const games = await new GOGParser().parse();

    expect(games).toHaveLength(2);
    expect(games.map((g) => g.title)).toEqual(['Cyberpunk 2077', 'Cyberpunk 2077']);
  });

  describe('постраничный обход', () => {
    it('останавливается на последней странице', async () => {
      mockSinglePage([product()]);
      await new GOGParser().parse();

      // Одна страница каталога плюс запрос бесплатных игр.
      expect(mockedGet).toHaveBeenCalledTimes(2);
    });

    it('не обходит больше пяти страниц, даже если их много', async () => {
      for (let i = 0; i < 5; i++) {
        mockedGet.mockResolvedValueOnce({ data: { products: [product()], totalPages: 100 } });
      }
      mockedGet.mockResolvedValueOnce({ data: { products: [] } });

      const games = await new GOGParser().parse();

      expect(games).toHaveLength(5);
      expect(mockedGet).toHaveBeenCalledTimes(6);
    });

    it('прекращает обход, если в ответе нет products', async () => {
      mockedGet
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { products: [] } });

      await expect(new GOGParser().parse()).resolves.toEqual([]);
    });
  });

  describe('бесплатные игры', () => {
    it('добавляет их с нулевой ценой и стопроцентной скидкой', async () => {
      mockSinglePage([], [product({ title: 'Beneath a Steel Sky', finalPrice: 5 })]);

      const games = await new GOGParser().parse();

      expect(games).toHaveLength(1);
      expect(games[0]).toMatchObject({
        title: 'Beneath a Steel Sky',
        currentPrice: 0,
        discountPercent: 100,
        isFree: true,
        // Оригинальная цена сохраняется, хотя игра отдаётся бесплатно.
        originalPrice: 59.99,
      });
    });

    it('ошибка запроса бесплатных игр не отменяет основной результат', async () => {
      mockedGet
        .mockResolvedValueOnce({ data: { products: [product()], totalPages: 1 } })
        .mockRejectedValueOnce(new Error('network down'));

      expect(await new GOGParser().parse()).toHaveLength(1);
    });
  });

  it('при ошибке каталога возвращает пустой список, не бросая исключение', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));

    await expect(new GOGParser().parse()).resolves.toEqual([]);
  });
});
