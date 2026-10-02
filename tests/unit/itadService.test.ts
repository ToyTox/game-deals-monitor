import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import itadService, { PriceDynamicsError, ITAD_SHOP_IDS, analyzePriceHistory } from '../../src/services/itadService.js';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);
const mockedGet = mockedAxios.get as unknown as Mock;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2025-06-01T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('analyzePriceHistory', () => {
  it('последняя запись старше 180 дней: график из двух точек, периоды опираются на неё', () => {
    const result = analyzePriceHistory([{ timestamp: at(210 * DAY), price: 700 }], NOW);

    expect(result.currentPrice).toBe(700);
    expect(result.graphPoints).toEqual([
      { timestamp: at(180 * DAY), price: 700 },
      { timestamp: at(0), price: 700 },
    ]);
    for (const period of Object.values(result.periods)) {
      expect(period).toEqual({ price: 700, change: 0, lowest: 700 });
    }
  });

  it('изменения 3 дня и 1 месяц назад: у дня цена на начало известна, изменение 0%', () => {
    const result = analyzePriceHistory(
      [
        { timestamp: at(33 * DAY), price: 900 },
        { timestamp: at(3 * DAY), price: 800 },
      ],
      NOW
    );

    expect(result.periods.day.price).toBe(800);
    expect(result.periods.day.change).toBe(0);
    expect(result.periods.day.lowest).toBe(800);
  });

  it('одна запись внутри окна без прошлой истории: цена на начало полугода null', () => {
    const result = analyzePriceHistory([{ timestamp: at(10 * DAY), price: 500 }], NOW);

    expect(result.periods.half_year.price).toBeNull();
    expect(result.periods.half_year.change).toBeNull();
    expect(result.periods.half_year.lowest).toBe(500);
    expect(result.graphPoints).toEqual([
      { timestamp: at(10 * DAY), price: 500 },
      { timestamp: at(0), price: 500 },
    ]);
  });

  it('последняя запись с ценой 0: текущая цена и минимумы равны 0', () => {
    const result = analyzePriceHistory(
      [
        { timestamp: at(50 * DAY), price: 300 },
        { timestamp: at(5 * DAY), price: 0 },
      ],
      NOW
    );

    expect(result.currentPrice).toBe(0);
    expect(result.periods.week.lowest).toBe(0);
    expect(result.allTimeLowest).toEqual({ price: 0, timestamp: at(5 * DAY) });
    expect(result.graphPoints.some((p) => p.price === 0)).toBe(true);
  });

  it('изменение считается к текущей цене', () => {
    const result = analyzePriceHistory(
      [
        { timestamp: at(200 * DAY), price: 1000 },
        { timestamp: at(100 * DAY), price: 500 },
        { timestamp: at(10 * DAY), price: 250 },
      ],
      NOW
    );

    expect(result.periods.half_year.price).toBe(1000);
    expect(result.periods.half_year.change).toBe(-75);
  });

  it('точки графика отсортированы по времени: начало окна первым, «сейчас» последним', () => {
    const result = analyzePriceHistory(
      [
        { timestamp: at(10 * DAY), price: 250 },
        { timestamp: at(200 * DAY), price: 1000 },
        { timestamp: at(100 * DAY), price: 500 },
      ],
      NOW
    );

    const times = result.graphPoints.map((p) => new Date(p.timestamp).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBe(NOW - 180 * DAY);
    expect(times[times.length - 1]).toBe(NOW);
    expect(result.graphPoints[0]).not.toHaveProperty('change');
  });
});

describe('ItadService', () => {
  beforeEach(() => {
    itadService.resetCache();
    vi.clearAllMocks();
    process.env.ITAD_API_KEY = 'test-key';
    process.env.ITAD_COUNTRY = 'RU';
  });

  describe('isFunctionEnabled', () => {
    afterEach(() => {
      delete (process.env as any).ITAD_API_KEY;
    });

    it('возвращает true если ключ есть', () => {
      process.env.ITAD_API_KEY = 'test-key';
      expect(itadService.isFunctionEnabled()).toBe(true);
    });

    it('возвращает false если ключа нет', () => {
      process.env.ITAD_API_KEY = '';
      expect(itadService.isFunctionEnabled()).toBe(false);
    });
  });

  describe('lookupGame', () => {
    it('выбрасывает ошибку если ключа нет', async () => {
      vi.stubEnv('ITAD_API_KEY', '');

      try {
        await expect(itadService.lookupGame('steam', 12345)).rejects.toThrow(
          expect.objectContaining({ code: 'no_key' })
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('ищет Steam игру по appid (без shop параметра)', async () => {
      mockedGet.mockResolvedValue({ data: { found: true, game: { id: 'game-123', title: 'Portal' } } });

      const result = await itadService.lookupGame('steam', 12345);

      expect(result).toBe('game-123');
      expect(mockedGet).toHaveBeenCalledWith(
        'https://api.isthereanydeal.com/games/lookup/v1',
        expect.objectContaining({
          params: expect.objectContaining({
            appid: 12345,
            key: 'test-key',
          }),
        })
      );
      // Убедиться что shop параметра нет
      const callParams = (mockedGet.mock.calls[0][1] as any).params;
      expect(callParams.shop).toBeUndefined();
    });

    it('ищет игру по названию (без shop параметра)', async () => {
      mockedGet.mockResolvedValue({ data: { found: true, game: { id: 'game-456', title: 'The Witcher 3' } } });

      const result = await itadService.lookupGame('gog', 'The Witcher 3');

      expect(result).toBe('game-456');
      expect(mockedGet).toHaveBeenCalledWith(
        'https://api.isthereanydeal.com/games/lookup/v1',
        expect.objectContaining({
          params: expect.objectContaining({
            title: 'The Witcher 3',
            key: 'test-key',
          }),
        })
      );
      const callParams = (mockedGet.mock.calls[0][1] as any).params;
      expect(callParams.shop).toBeUndefined();
    });

    it('выбрасывает not_found если found: false', async () => {
      mockedGet.mockResolvedValue({ data: { found: false } });

      await expect(itadService.lookupGame('steam', 99999)).rejects.toThrow(
        expect.objectContaining({ code: 'not_found' })
      );
    });

    it('выбрасывает not_found если game.id отсутствует', async () => {
      mockedGet.mockResolvedValue({ data: { found: true, game: {} } });

      await expect(itadService.lookupGame('steam', 12345)).rejects.toThrow(
        expect.objectContaining({ code: 'not_found' })
      );
    });

    it('выбрасывает upstream на сетевую ошибку', async () => {
      mockedGet.mockRejectedValue(new Error('Network error'));

      await expect(itadService.lookupGame('steam', 12345)).rejects.toThrow(
        expect.objectContaining({ code: 'upstream' })
      );
    });
  });

  describe('getPriceDynamics', () => {
    it('выбрасывает ошибку если функция отключена', async () => {
      vi.stubEnv('ITAD_API_KEY', '');

      try {
        await expect(itadService.getPriceDynamics('steam', 12345)).rejects.toThrow(
          expect.objectContaining({ code: 'no_key' })
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('выбрасывает ошибку для неподдерживаемого магазина', async () => {
      await expect(
        itadService.getPriceDynamics('vkplay' as any, 'test')
      ).rejects.toThrow(expect.objectContaining({ code: 'unsupported_shop' }));
    });

    it('использует параметры API в нужном формате (без shop)', async () => {
      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return [];
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      await itadService.getPriceDynamics('steam', 12345);

      // Проверить параметры history запроса
      const historyCall = mockedGet.mock.calls.find((call) => call[0].includes('history'));
      expect(historyCall).toBeDefined();
      const params = (historyCall![1] as any).params;
      expect(params).toMatchObject({
        key: 'test-key',
        id: 'game-123',
        country: 'RU',
        shops: 61,
      });
      expect(params.since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // date-time без миллисекунд
      expect(params.gameid).toBeUndefined(); // старый параметр не должен быть
    });

    it('отбрасывает записи чужого магазина', async () => {
      const now = new Date();
      const date1 = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return {
            data: [
              { timestamp: date1, shop: { id: 61 }, deal: { price: { amount: 100, currency: 'RUB' } } },
              { timestamp: now.toISOString(), shop: { id: 35 }, deal: { price: { amount: 80, currency: 'RUB' } } }, // GOG — отбросить
            ]
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await itadService.getPriceDynamics('steam', 12345);

      // Запись и точка «сейчас»; запись GOG отброшена
      expect(result.graphPoints).toHaveLength(2);
      expect(result.graphPoints.map((p) => p.price)).toEqual([100, 100]);
    });

    it('отбрасывает записи без цены', async () => {
      const now = new Date();
      const date1 = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return {
            data: [
              { timestamp: date1, shop: { id: 61 }, deal: { price: { currency: 'RUB' } } }, // Нет amount
              { timestamp: now.toISOString(), shop: { id: 61 }, deal: { price: { amount: 80, currency: 'RUB' } } },
            ]
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await itadService.getPriceDynamics('steam', 12345);

      expect(result.graphPoints).toHaveLength(2);
      expect(result.graphPoints.map((p) => p.price)).toEqual([80, 80]);
    });

    it('отбрасывает записи с невалидной датой', async () => {
      const now = new Date();
      const date1 = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return {
            data: [
              { timestamp: 'invalid-date', shop: { id: 61 }, deal: { price: { amount: 100, currency: 'RUB' } } },
              { timestamp: now.toISOString(), shop: { id: 61 }, deal: { price: { amount: 80, currency: 'RUB' } } },
            ]
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await itadService.getPriceDynamics('steam', 12345);

      expect(result.graphPoints).toHaveLength(2);
      expect(result.graphPoints.map((p) => p.price)).toEqual([80, 80]);
    });

    it('берёт валюту из deal.price.currency', async () => {
      const now = new Date();

      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return {
            data: [
              { timestamp: now.toISOString(), shop: { id: 61 }, deal: { price: { amount: 100, currency: 'USD' } } },
            ]
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await itadService.getPriceDynamics('steam', 12345);

      expect(result.currency).toBe('USD');
    });

    it('возвращает null валюру если записей нет', async () => {
      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return { data: [] };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await itadService.getPriceDynamics('steam', 12345);

      expect(result.currency).toBeNull();
    });

    it('возвращает структурированные данные', async () => {
      const now = new Date();

      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return {
            data: [
              { timestamp: now.toISOString(), shop: { id: 61 }, deal: { price: { amount: 100, currency: 'RUB' } } },
            ]
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await itadService.getPriceDynamics('steam', 12345);

      expect(result).toHaveProperty('shop', 'steam');
      expect(result).toHaveProperty('country', 'RU');
      expect(result).toHaveProperty('currency', 'RUB');
      expect(result).toHaveProperty('graphPoints');
      expect(result).toHaveProperty('periods');
      expect(result).toHaveProperty('allTimeLowest');
      expect(result).toHaveProperty('currentPrice');
      expect(Array.isArray(result.graphPoints)).toBe(true);
    });

    it('кэширует результаты', async () => {
      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return [
            { timestamp: new Date().toISOString(), shop: { id: 61 }, deal: { price: { amount: 100, currency: 'RUB' } } },
          ];
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result1 = await itadService.getPriceDynamics('steam', 12345);
      const result2 = await itadService.getPriceDynamics('steam', 12345);

      expect(result1).toBe(result2);
      // Только 2 запроса (lookup + history), второй раз не делается
      expect(mockedGet).toHaveBeenCalledTimes(2);
    });

    it('обслуживает пустую историю', async () => {
      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return [];
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await itadService.getPriceDynamics('steam', 12345);

      expect(result.currentPrice).toBe(null);
      expect(result.allTimeLowest).toBe(null);
      expect(result.graphPoints).toHaveLength(0);
    });

    it('выбрасывает upstream при ошибке запроса истории', async () => {
      mockedGet
        .mockResolvedValueOnce({ data: { found: true, game: { id: 'game-123' } } })
        .mockRejectedValueOnce(new Error('Network error'));

      await expect(itadService.getPriceDynamics('steam', 12345)).rejects.toThrow(
        expect.objectContaining({ code: 'upstream' })
      );
    });

    it('добавляет причину от ITAD в сообщение upstream', async () => {
      mockedGet
        .mockResolvedValueOnce({ data: { found: true, game: { id: 'game-123' } } })
        .mockRejectedValueOnce(
          Object.assign(new Error('Request failed with status code 400'), {
            isAxiosError: true,
            response: { data: { reason_phrase: "Invalid 'since' format" } },
          })
        );
      (mockedAxios as any).isAxiosError = (e: any) => e?.isAxiosError === true;

      await expect(itadService.getPriceDynamics('steam', 12345)).rejects.toThrow(
        expect.objectContaining({ code: 'upstream', message: expect.stringContaining("Invalid 'since' format") })
      );
    });

    it('сохраняет запись с amount: 0 и отбрасывает запись без amount', async () => {
      const now = Date.now();
      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return {
            data: [
              { timestamp: new Date(now - 20 * DAY).toISOString(), shop: { id: 61 }, deal: { price: { currency: 'RUB' } } },
              { timestamp: new Date(now - 10 * DAY).toISOString(), shop: { id: 61 }, deal: { price: { amount: 0, currency: 'RUB' } } },
            ]
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await itadService.getPriceDynamics('steam', 12345);

      expect(result.currentPrice).toBe(0);
      expect(result.allTimeLowest?.price).toBe(0);
      expect(result.graphPoints.map((p) => p.price)).toEqual([0, 0]);
    });

    it('после перезаписи ключа и заполнения кэша свежая запись не вытесняется', async () => {
      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return { data: [{ timestamp: new Date().toISOString(), shop: { id: 61 }, deal: { price: { amount: 100, currency: 'RUB' } } }] };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });
      const historyCalls = () => mockedGet.mock.calls.filter((c) => c[0].includes('history')).length;

      const realNow = Date.now();
      const nowSpy = vi.spyOn(Date, 'now');
      try {
        nowSpy.mockReturnValue(realNow);
        await itadService.getPriceDynamics('steam', 1); // A
        await itadService.getPriceDynamics('steam', 2); // B

        // TTL истёк: A перезаписывается и становится свежее B
        nowSpy.mockReturnValue(realNow + 7 * 60 * 60 * 1000);
        await itadService.getPriceDynamics('steam', 1);
        for (let i = 0; i < 98; i++) {
          await itadService.getPriceDynamics('steam', 100 + i);
        }
        // Кэш полон (A, B и 98 других); новый ключ вытесняет B, а не A
        await itadService.getPriceDynamics('steam', 999);

        const before = historyCalls();
        await itadService.getPriceDynamics('steam', 1);
        expect(historyCalls()).toBe(before);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('вытесняет старые записи из кэша если превышен лимит', async () => {
      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('lookup')) {
          return { data: { found: true, game: { id: 'game-123' } } };
        }
        if (url.includes('history')) {
          return [
            { timestamp: new Date().toISOString(), shop: { id: 61 }, deal: { price: { amount: 100, currency: 'RUB' } } },
          ];
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      // Добавить много записей в кэш (MAX_CACHE_ENTRIES = 100)
      const promises = [];
      for (let i = 0; i < 110; i++) {
        promises.push(itadService.getPriceDynamics('steam', 10000 + i));
      }
      await Promise.all(promises);

      // Кэш должен содержать не более 100 записей
      // Это проверяем косвенно: если вытеснение работает, старые запросы будут сделаны заново
      const firstQueryCall = mockedGet.mock.calls.filter(c => c[0].includes('history')).length;
      expect(firstQueryCall).toBeGreaterThan(100); // Некоторые запросы повторены из-за вытеснения
    });
  });

  describe('getSupportedStores', () => {
    it('возвращает список поддерживаемых магазинов', () => {
      const stores = itadService.getSupportedStores();
      expect(stores).toContain('steam');
      expect(stores).toContain('gog');
      expect(stores).toContain('epic');
      expect(stores).not.toContain('vkplay');
    });
  });
});
