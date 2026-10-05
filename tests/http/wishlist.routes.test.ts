import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { ProfileError } from '../../src/services/steamProfileService.js';
import { prisma, resetDb, seedOffer } from '../helpers/db.js';
import { WishlistError, type WishlistItem } from '../../src/services/steamWishlistService.js';

// Роут не должен ходить в сеть: сервис заменяем целиком. Форма с default обязательна —
// роутер импортирует готовый экземпляр. WishlistError берётся из настоящего модуля,
// поэтому здесь же переэкспортируем его, иначе instanceof в роуте не сработает.
vi.mock('../../src/services/steamWishlistService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/steamWishlistService.js')>();
  return {
    ...actual,
    default: { getWishlist: vi.fn(), getApp: vi.fn(), resolveSteamId: vi.fn(), resetCache: vi.fn() },
  };
});

vi.mock('../../src/services/steamProfileService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/steamProfileService.js')>();
  return { ...actual, default: { getProfile: vi.fn(), resetCache: vi.fn() } };
});

const { default: steamProfileService } = await import('../../src/services/steamProfileService.js');
const mockedGetProfile = steamProfileService.getProfile as unknown as Mock;

const { default: steamWishlistService } = await import('../../src/services/steamWishlistService.js');
const mockedGetWishlist = steamWishlistService.getWishlist as unknown as Mock;

const mockedGetApp = steamWishlistService.getApp as unknown as Mock;

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
  beforeEach(async () => {
    mockedGetWishlist.mockReset();
    await resetDb();
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

describe('GET /api/wishlist: slug игры из базы', () => {
  beforeEach(async () => {
    mockedGetWishlist.mockReset();
    await resetDb();
  });

  it('находит игру по Steam-офферу с тем же appId, точное совпадение appId', async () => {
    const offer = await seedOffer({ title: 'Совсем другое название в базе' });
    await prisma.offer.update({
      where: { id: offer.id },
      data: { gameUrl: 'https://store.steampowered.com/app/123/Some_Game/' },
    });
    mockWishlist([
      item({ appId: 123, title: 'Some Game' }),
      item({ appId: 12, title: 'Other Game' }),
    ]);

    const res = await request(app).get(`/api/wishlist?user=${STEAM_ID}`).expect(200);
    const bySlug = Object.fromEntries(res.body.games.map((g: { appId: number; slug?: string }) => [g.appId, g.slug]));

    expect(bySlug[123]).toBe('sovsem-drugoe-nazvanie-v-baze');
    expect(bySlug[12]).toBeUndefined();
  });

  it('если оффера Steam нет, сопоставляет по нормализованному названию', async () => {
    await seedOffer({ title: 'Dead Space', platform: 'gog' });
    mockWishlist([
      item({ appId: 1, title: 'Dead Space™' }),
      item({ appId: 2, title: 'Нет такой в базе' }),
    ]);

    const res = await request(app).get(`/api/wishlist?user=${STEAM_ID}`).expect(200);
    const games = res.body.games as { appId: number; slug?: string }[];

    expect(games.find((g) => g.appId === 1)?.slug).toBe('dead-space');
    expect(games.find((g) => g.appId === 2)).not.toHaveProperty('slug');
  });

  it('не портит позиции в кэше сервиса', async () => {
    await seedOffer({ title: 'Dead Space' });
    const items = [item({ appId: 1, title: 'Dead Space' })];
    mockWishlist(items);

    await request(app).get(`/api/wishlist?user=${STEAM_ID}`).expect(200);

    expect(items[0]).not.toHaveProperty('slug');
  });
});

describe('GET /api/wishlist/app/:appId', () => {
  const steamApp = {
    id: null,
    slug: null,
    appId: 620,
    title: 'Portal 2',
    kind: 'game',
    imageUrl: null,
    description: 'Головоломка',
    createdAt: null,
    updatedAt: null,
    tags: [],
    offers: [{ platform: 'steam', currentPrice: 385, priceHistory: [] }],
  };

  beforeEach(async () => {
    mockedGetApp.mockReset();
    await resetDb();
  });

  it('отдаёт игру Steam без slug, если её нет в базе', async () => {
    mockedGetApp.mockResolvedValue(steamApp);

    const res = await request(app).get('/api/wishlist/app/620').expect(200);

    expect(res.body).toMatchObject({ appId: 620, title: 'Portal 2', slug: null, tags: [] });
    expect(mockedGetApp).toHaveBeenCalledWith(620);
  });

  it('отдаёт slug, если игра есть в базе', async () => {
    await seedOffer({ title: 'Portal 2' });
    mockedGetApp.mockResolvedValue(steamApp);

    const res = await request(app).get('/api/wishlist/app/620').expect(200);

    expect(res.body.slug).toBe('portal-2');
  });

  it('невалидный appId — 400 без похода в Steam', async () => {
    await request(app).get('/api/wishlist/app/abc').expect(400);
    await request(app).get('/api/wishlist/app/0').expect(400);
    await request(app).get('/api/wishlist/app/-5').expect(400);
    await request(app).get('/api/wishlist/app/12x').expect(400);

    expect(mockedGetApp).not.toHaveBeenCalled();
  });

  it('позиция, которой Steam не знает, — 404', async () => {
    mockedGetApp.mockRejectedValue(new WishlistError('not_found', 'Игра не найдена в Steam'));

    const res = await request(app).get('/api/wishlist/app/999').expect(404);

    expect(res.body.code).toBe('not_found');
  });

  it('сбой Steam — 502', async () => {
    mockedGetApp.mockRejectedValue(new WishlistError('upstream', 'Steam не ответил'));

    const res = await request(app).get('/api/wishlist/app/620').expect(502);

    expect(res.body.code).toBe('upstream');
  });

  it('прочая ошибка — 500', async () => {
    mockedGetApp.mockRejectedValue(new Error('упало'));

    await request(app).get('/api/wishlist/app/620').expect(500);
  });
});

describe('GET /api/wishlist/profile', () => {
  beforeEach(() => {
    mockedGetProfile.mockReset();
  });

  it('отдаёт профиль со статичным фоном', async () => {
    const profile = {
      steamId: STEAM_ID,
      avatarUrl: 'https://avatars.steamstatic.com/a_full.jpg',
      name: 'Игрок',
      background: { imageUrl: 'https://img/static.jpg', videoWebmUrl: null, videoMp4Url: null },
    };
    mockedGetProfile.mockResolvedValue(profile);

    const res = await request(app).get(`/api/wishlist/profile?steamId=${STEAM_ID}`).expect(200);

    expect(res.body).toEqual(profile);
    expect(mockedGetProfile).toHaveBeenCalledWith(STEAM_ID);
  });

  it('отдаёт профиль с анимированным фоном', async () => {
    const background = {
      imageUrl: 'https://img/poster.jpg',
      videoWebmUrl: 'https://img/movie.webm',
      videoMp4Url: 'https://img/movie.mp4',
    };
    mockedGetProfile.mockResolvedValue({ steamId: STEAM_ID, avatarUrl: null, name: null, background });

    const res = await request(app).get(`/api/wishlist/profile?steamId=${STEAM_ID}`).expect(200);

    expect(res.body.background).toEqual(background);
    expect(res.body.avatarUrl).toBeNull();
  });

  it('частичный сбой: missing в ответе, при полном профиле его нет', async () => {
    mockedGetProfile.mockResolvedValue({
      steamId: STEAM_ID, avatarUrl: null, name: null, background: null, missing: ['avatar'],
    });
    const partial = await request(app).get(`/api/wishlist/profile?steamId=${STEAM_ID}`).expect(200);
    expect(partial.body.missing).toEqual(['avatar']);

    mockedGetProfile.mockResolvedValue({ steamId: STEAM_ID, avatarUrl: null, name: null, background: null });
    const full = await request(app).get(`/api/wishlist/profile?steamId=${STEAM_ID}`).expect(200);
    expect(full.body).not.toHaveProperty('missing');
  });

  it('плохой SteamID -> 400 без похода в Steam', async () => {
    await request(app).get('/api/wishlist/profile').expect(400);
    await request(app).get('/api/wishlist/profile?steamId=gaben').expect(400);
    await request(app).get('/api/wishlist/profile?steamId=123').expect(400);

    expect(mockedGetProfile).not.toHaveBeenCalled();
  });

  it('Steam не ответил -> 502', async () => {
    mockedGetProfile.mockRejectedValue(new ProfileError('Steam не ответил'));

    const res = await request(app).get(`/api/wishlist/profile?steamId=${STEAM_ID}`).expect(502);

    expect(res.body.code).toBe('upstream');
  });
});
