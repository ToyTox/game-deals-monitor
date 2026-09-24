import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { WishlistError, type WishlistItem } from '../../src/services/steamWishlistService.js';

// Роут не должен ходить в сеть: сервис заменяем целиком. Форма с default обязательна —
// роутер импортирует готовый экземпляр. WishlistError берётся из настоящего модуля,
// поэтому здесь же переэкспортируем его, иначе instanceof в роуте не сработает.
vi.mock('../../src/services/steamWishlistService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/steamWishlistService.js')>();
  return {
    ...actual,
    default: { getWishlist: vi.fn(), resolveSteamId: vi.fn(), resetCache: vi.fn() },
  };
});

const { default: steamWishlistService } = await import('../../src/services/steamWishlistService.js');
const mockedGetWishlist = steamWishlistService.getWishlist as unknown as Mock;

const app = createApp();

const STEAM_ID = '76561198006409530';

function item(overrides: Partial<WishlistItem> = {}): WishlistItem {
  return {
    appId: 1,
    title: 'Игра',
    platform: 'steam',
    kind: 'game',
    imageUrl: null,
    gameUrl: 'https://store.steampowered.com/app/1',
    originalPrice: 1000,
    currentPrice: 500,
    currency: 'RUB',
    currentPriceRub: 500,
    discountPercent: 50,
    isFree: false,
    unavailable: false,
    saleEndDate: null,
    addedAt: null,
    priority: 0,
    ...overrides,
  };
}

function mockWishlist(items: WishlistItem[], truncated = false) {
  mockedGetWishlist.mockResolvedValue({
    steamId: STEAM_ID,
    items,
    wishlistTotal: items.length,
    truncated,
  });
}

const titles = (body: { games: { title: string }[] }) => body.games.map((g) => g.title);

describe('GET /api/wishlist', () => {
  beforeEach(() => {
    mockedGetWishlist.mockReset();
  });

  it('без user отвечает 400 и в Steam не ходит', async () => {
    await request(app).get('/api/wishlist').expect(400);
    await request(app).get('/api/wishlist?user=%20%20').expect(400);

    expect(mockedGetWishlist).not.toHaveBeenCalled();
  });

  it('прокидывает ввод пользователя в сервис как есть', async () => {
    mockWishlist([item()]);

    await request(app).get('/api/wishlist?user=gaben').expect(200);

    expect(mockedGetWishlist).toHaveBeenCalledWith('gaben');
  });

  it('по умолчанию оставляет только позиции со скидкой', async () => {
    mockWishlist([
      item({ appId: 1, title: 'Со скидкой', discountPercent: 50 }),
      item({ appId: 2, title: 'Без скидки', discountPercent: 0 }),
    ]);

    const res = await request(app).get(`/api/wishlist?user=${STEAM_ID}`).expect(200);

    expect(titles(res.body)).toEqual(['Со скидкой']);
    expect(res.body.total).toBe(1);
  });

  it('onlyDiscounted=false возвращает весь вишлист', async () => {
    mockWishlist([
      item({ appId: 1, title: 'Со скидкой', discountPercent: 50 }),
      item({ appId: 2, title: 'Без скидки', discountPercent: 0 }),
    ]);

    const res = await request(app)
      .get(`/api/wishlist?user=${STEAM_ID}&onlyDiscounted=false`)
      .expect(200);

    expect(res.body.total).toBe(2);
  });

  it('счётчики считаются по всему вишлисту, а не по отфильтрованному срезу', async () => {
    mockWishlist([
      item({ appId: 1, discountPercent: 50 }),
      item({ appId: 2, discountPercent: 0 }),
      item({ appId: 3, discountPercent: 0, unavailable: true, currentPrice: null }),
    ]);

    const res = await request(app).get(`/api/wishlist?user=${STEAM_ID}`).expect(200);

    expect(res.body).toMatchObject({
      total: 1,
      wishlistTotal: 3,
      discountedTotal: 1,
      unavailableTotal: 1,
      steamId: STEAM_ID,
    });
  });

  it('режет выдачу по limit и offset, total считает до среза', async () => {
    mockWishlist([
      item({ appId: 1, title: 'A', discountPercent: 90 }),
      item({ appId: 2, title: 'B', discountPercent: 80 }),
      item({ appId: 3, title: 'C', discountPercent: 70 }),
    ]);

    const res = await request(app)
      .get(`/api/wishlist?user=${STEAM_ID}&limit=1&offset=1`)
      .expect(200);

    expect(titles(res.body)).toEqual(['B']);
    expect(res.body).toMatchObject({ total: 3, limit: 1, offset: 1 });
  });

  it('по умолчанию сортирует по скидке', async () => {
    mockWishlist([
      item({ appId: 1, title: 'Слабая', discountPercent: 10 }),
      item({ appId: 2, title: 'Сильная', discountPercent: 90 }),
    ]);

    const res = await request(app).get(`/api/wishlist?user=${STEAM_ID}`).expect(200);

    expect(titles(res.body)).toEqual(['Сильная', 'Слабая']);
    expect(res.body.sort).toBe('discount');
  });

  it('сортирует по цене, цена по возрастанию', async () => {
    mockWishlist([
      item({ appId: 1, title: 'Дорогая', currentPrice: 900 }),
      item({ appId: 2, title: 'Дешёвая', currentPrice: 100 }),
    ]);

    const res = await request(app)
      .get(`/api/wishlist?user=${STEAM_ID}&sort=price_asc`)
      .expect(200);

    expect(titles(res.body)).toEqual(['Дешёвая', 'Дорогая']);
  });

  it('позиции без цены уходят в конец при любой сортировке по цене', async () => {
    mockWishlist([
      item({ appId: 1, title: 'Нет в регионе', currentPrice: null, unavailable: true }),
      item({ appId: 2, title: 'Дешёвая', currentPrice: 100 }),
      item({ appId: 3, title: 'Дорогая', currentPrice: 900 }),
    ]);

    for (const [sort, expected] of [
      ['price_asc', ['Дешёвая', 'Дорогая', 'Нет в регионе']],
      ['price_desc', ['Дорогая', 'Дешёвая', 'Нет в регионе']],
    ] as const) {
      const res = await request(app)
        .get(`/api/wishlist?user=${STEAM_ID}&onlyDiscounted=false&sort=${sort}`)
        .expect(200);

      expect(titles(res.body)).toEqual(expected);
    }
  });

  it('неизвестная сортировка молча заменяется сортировкой по скидке', async () => {
    mockWishlist([item()]);

    const res = await request(app)
      .get(`/api/wishlist?user=${STEAM_ID}&sort=по-настроению`)
      .expect(200);

    expect(res.body.sort).toBe('discount');
  });

  it('признак усечения доходит до ответа', async () => {
    mockWishlist([item()], true);

    const res = await request(app).get(`/api/wishlist?user=${STEAM_ID}`).expect(200);

    expect(res.body.truncated).toBe(true);
  });

  it('закрытый или пустой вишлист — 404 с кодом и внятным текстом', async () => {
    mockedGetWishlist.mockRejectedValue(
      new WishlistError(
        'empty_or_private',
        'Список желаемого пуст или закрыт настройками приватности профиля'
      )
    );

    const res = await request(app).get(`/api/wishlist?user=${STEAM_ID}`).expect(404);

    expect(res.body.code).toBe('empty_or_private');
    expect(res.body.error).toMatch(/приватност/i);
  });

  it('ненайденный профиль — 404', async () => {
    mockedGetWishlist.mockRejectedValue(new WishlistError('not_found', 'Профиль не найден'));

    const res = await request(app).get('/api/wishlist?user=zzz').expect(404);

    expect(res.body.code).toBe('not_found');
  });

  it('недоступность Steam — 502, а не 404', async () => {
    mockedGetWishlist.mockRejectedValue(new WishlistError('upstream', 'Steam не ответил'));

    const res = await request(app).get(`/api/wishlist?user=${STEAM_ID}`).expect(502);

    expect(res.body.code).toBe('upstream');
  });

  it('прочая ошибка сервиса — 500', async () => {
    mockedGetWishlist.mockRejectedValue(new Error('что-то упало'));

    await request(app).get(`/api/wishlist?user=${STEAM_ID}`).expect(500);
  });
});
