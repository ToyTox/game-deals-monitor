import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import GOGParser from '../../src/parsers/gogParsers.js';
import { readJsonFixture } from '../helpers/fixtures.js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const mockedGet = axios.get as unknown as Mock;

const catalogFixture = readJsonFixture<{ products: Record<string, unknown>[] }>('gog-catalog.json');
const freeFixture = readJsonFixture<{ products: Record<string, unknown>[] }>('gog-free.json');

/** Товар в форме витринного API: цены строками, storeLink абсолютный. */
function product(overrides: Record<string, unknown> = {}) {
  const { price, ...rest } = overrides as { price?: Record<string, unknown> };

  return {
    id: 'gog-1',
    slug: 'cyberpunk_2077',
    title: 'Cyberpunk 2077',
    coverHorizontal: 'https://cdn.test/cp2077.jpg',
    storeLink: 'https://www.gog.com/ru/game/cyberpunk_2077',
    productType: 'game',
    ...rest,
    price: {
      final: '1 499 ₽',
      base: '2 999 ₽',
      discount: '-50%',
      finalMoney: { amount: '1499', currency: 'RUB' },
      baseMoney: { amount: '2999', currency: 'RUB' },
      ...price,
    },
  };
}

/** Каталог отдаёт одну страницу, затем идёт запрос бесплатных игр. */
function mockSinglePage(products: unknown[], freeProducts: unknown[] = []) {
  mockedGet
    .mockResolvedValueOnce({ data: { products, pages: 1 } })
    .mockResolvedValueOnce({ data: { products: freeProducts } });
}

describe('GOGParser', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  /**
   * Ровно этих проверок не хватало раньше: парсер год ходил на несуществующий
   * api.gog.com/v2/games/products, получал 404 и молча отдавал пустой список.
   */
  describe('запрос', () => {
    it('ходит в витринный каталог с региональными параметрами', async () => {
      mockSinglePage([product()]);

      await new GOGParser().parse();

      expect(mockedGet.mock.calls[0][0]).toBe('https://catalog.gog.com/v1/catalog');
      expect(mockedGet.mock.calls[0][1]?.params).toMatchObject({
        limit: 48,
        order: 'desc:discount',
        productType: 'in:game,pack',
        page: 1,
        countryCode: 'RU',
        currencyCode: 'RUB',
        locale: 'ru-RU',
      });
    });

    it('запрашивает бесплатные нулевым ценовым диапазоном', async () => {
      mockSinglePage([product()]);

      await new GOGParser().parse();

      expect(mockedGet.mock.calls.at(-1)?.[1]?.params).toMatchObject({ price: 'between:0,0' });
    });

    // Раньше таймаута не было вовсе: зависший запрос растягивал весь прогон.
    it('ограничивает запрос таймаутом', async () => {
      mockSinglePage([product()]);

      await new GOGParser().parse();

      expect(mockedGet.mock.calls[0][1]?.timeout).toBe(15000);
    });
  });

  describe('преобразование записи', () => {
    // В отличие от Steam и Epic, API GOG отдаёт цены уже в единицах валюты.
    it('берёт цены как есть, без деления на 100', async () => {
      mockSinglePage([product()]);

      expect((await new GOGParser().parse())[0]).toMatchObject({
        title: 'Cyberpunk 2077',
        platform: 'gog',
        originalPrice: 2999,
        currentPrice: 1499,
        discountPercent: 50,
        isFree: false,
        imageUrl: 'https://cdn.test/cp2077.jpg',
      });
    });

    it('берёт валюту из ответа', async () => {
      mockSinglePage([product()]);

      expect((await new GOGParser().parse())[0].currency).toBe('RUB');
    });

    it('ссылку берёт из storeLink как есть, ничего не приклеивая', async () => {
      mockSinglePage([product()]);

      expect((await new GOGParser().parse())[0].gameUrl).toBe(
        'https://www.gog.com/ru/game/cyberpunk_2077'
      );
    });

    it('без storeLink собирает ссылку по slug', async () => {
      mockSinglePage([product({ storeLink: undefined })]);

      expect((await new GOGParser().parse())[0].gameUrl).toBe(
        'https://www.gog.com/ru/game/cyberpunk_2077'
      );
    });

    // gameUrl — обязательная колонка, сохранить такую запись всё равно не выйдет.
    it('пропускает запись без ссылки и без slug', async () => {
      mockSinglePage([product({ storeLink: undefined, slug: undefined })]);

      await expect(new GOGParser().parse()).resolves.toEqual([]);
    });

    it('считает бесплатной игру с нулевой финальной ценой', async () => {
      mockSinglePage([
        product({ price: { final: '0 ₽', discount: null, finalMoney: { amount: '0', currency: 'RUB' } } }),
      ]);

      expect((await new GOGParser().parse())[0]).toMatchObject({ currentPrice: 0, isFree: true });
    });
  });

  describe('скидка', () => {
    it('разбирает строку вида "-95%"', async () => {
      mockSinglePage([product({ price: { discount: '-95%' } })]);

      expect((await new GOGParser().parse())[0].discountPercent).toBe(95);
    });

    // У части позиций discount пустой, хотя базовая цена выше финальной.
    it('при пустом discount считает процент из базовой и финальной цены', async () => {
      mockSinglePage([
        product({
          price: {
            discount: null,
            finalMoney: { amount: '33', currency: 'RUB' },
            baseMoney: { amount: '679', currency: 'RUB' },
          },
        }),
      ]);

      expect((await new GOGParser().parse())[0].discountPercent).toBe(95);
    });

    it('у изначально бесплатной игры оставляет ноль, а не сотню', async () => {
      mockSinglePage([
        product({
          price: {
            final: '0 ₽',
            base: '0 ₽',
            discount: null,
            finalMoney: { amount: '0', currency: 'RUB' },
            baseMoney: { amount: '0', currency: 'RUB' },
          },
        }),
      ]);

      expect((await new GOGParser().parse())[0]).toMatchObject({
        discountPercent: 0,
        isFree: true,
      });
    });
  });

  /**
   * GOG — единственный парсер, который не схлопывает дубли по названию.
   * Последствие видно в saveGames: две записи с одним title за один прогон
   * сначала создают строку, потом её же обновляют, и в отчёт попадают
   * одновременно и «новая», и «обновлённая» игра.
   */
  it('дубли по названию не схлопывает', async () => {
    mockSinglePage([
      product({ price: { discount: '-20%' } }),
      product({ id: 'gog-2', price: { discount: '-70%' } }),
    ]);

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
        mockedGet.mockResolvedValueOnce({ data: { products: [product()], pages: 100 } });
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
    it('добавляет их с нулевой ценой и признаком isFree', async () => {
      mockSinglePage([], [product({ title: 'Beneath a Steel Sky' })]);

      const games = await new GOGParser().parse();

      expect(games).toHaveLength(1);
      expect(games[0]).toMatchObject({
        title: 'Beneath a Steel Sky',
        currentPrice: 0,
        isFree: true,
        // Оригинальная цена сохраняется, хотя игра отдаётся бесплатно.
        originalPrice: 2999,
      });
    });

    it('ошибка запроса бесплатных игр не отменяет основной результат', async () => {
      mockedGet
        .mockResolvedValueOnce({ data: { products: [product()], pages: 1 } })
        .mockRejectedValueOnce(new Error('network down'));

      expect(await new GOGParser().parse()).toHaveLength(1);
    });
  });

  it('при ошибке каталога возвращает пустой список, не бросая исключение', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));

    await expect(new GOGParser().parse()).resolves.toEqual([]);
  });

  // Рукописный мок однажды уже уехал от реальности — здесь разбирается живой ответ.
  describe('на реальном ответе API', () => {
    it('разбирает страницу каталога', async () => {
      // pages сводим к единице: здесь проверяется разбор записи, а не пагинация.
      mockedGet
        .mockResolvedValueOnce({ data: { ...catalogFixture, pages: 1 } })
        .mockResolvedValueOnce({ data: { products: [] } });

      const games = await new GOGParser().parse();

      expect(games).toHaveLength(2);
      expect(games[0]).toMatchObject({
        title: 'Dead Age 1 + 2 Bundle',
        platform: 'gog',
        currency: 'RUB',
        originalPrice: 679,
        currentPrice: 33,
        discountPercent: 95,
        isFree: false,
        gameUrl: 'https://www.gog.com/ru/game/dead_age_1_2_bundle',
      });
    });

    it('разбирает выдачу бесплатных', async () => {
      mockedGet
        .mockResolvedValueOnce({ data: { products: [], pages: 1 } })
        .mockResolvedValueOnce({ data: freeFixture });

      const games = await new GOGParser().parse();

      expect(games[0]).toMatchObject({
        title: 'Gently Packed Demo',
        currentPrice: 0,
        isFree: true,
        discountPercent: 0,
      });
    });
  });
});
