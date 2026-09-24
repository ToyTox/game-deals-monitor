import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import { SteamWishlistService, WishlistError } from '../../src/services/steamWishlistService.js';
import { readJsonFixture } from '../helpers/fixtures.js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

// Курсы ЦБ ходят в сеть и в базу — здесь проверяется разбор ответов Steam, не конвертация.
vi.mock('../../src/services/currencyService.js', () => ({
  default: { toRub: vi.fn(async (amount: number | null) => amount) },
}));

const mockedGet = axios.get as unknown as Mock;

const wishlist = readJsonFixture('steam-wishlist.json');
const storeItems = readJsonFixture('steam-store-items.json');

/** Ответы Steam по адресу запроса: профиль, вишлист, карточки товаров. */
function mockSteam({ vanityXml }: { vanityXml?: string } = {}) {
  mockedGet.mockImplementation(async (url: string) => {
    if (url.includes('/id/')) return { data: vanityXml ?? '' };
    if (url.includes('GetWishlist')) return { data: wishlist };
    if (url.includes('GetItems')) return { data: storeItems };
    throw new Error(`неожиданный запрос: ${url}`);
  });
}

const STEAM_ID = '76561198006409530';

function service() {
  return new SteamWishlistService();
}

describe('SteamWishlistService: резолв SteamID', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('пропускает SteamID64 без запроса в сеть', async () => {
    await expect(service().resolveSteamId(STEAM_ID)).resolves.toBe(STEAM_ID);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('достаёт id из ссылки вида /profiles/<id>', async () => {
    const input = `https://steamcommunity.com/profiles/${STEAM_ID}/`;

    await expect(service().resolveSteamId(input)).resolves.toBe(STEAM_ID);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('резолвит ник через XML профиля', async () => {
    mockSteam({ vanityXml: `<profile><steamID64>${STEAM_ID}</steamID64></profile>` });

    await expect(service().resolveSteamId('gaben')).resolves.toBe(STEAM_ID);
  });

  it('резолвит ссылку вида /id/<ник>', async () => {
    mockSteam({ vanityXml: `<profile><steamID64>${STEAM_ID}</steamID64></profile>` });

    await expect(service().resolveSteamId('https://steamcommunity.com/id/gaben')).resolves.toBe(
      STEAM_ID
    );
  });

  it('несуществующий ник — not_found', async () => {
    mockSteam({ vanityXml: '<response><error>The specified profile could not be found.</error></response>' });

    await expect(service().resolveSteamId('zzz-no-such-user')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('пустой ввод — not_found', async () => {
    await expect(service().resolveSteamId('   ')).rejects.toBeInstanceOf(WishlistError);
  });
});

describe('SteamWishlistService: разбор вишлиста', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('пустой ответ Steam — empty_or_private', async () => {
    mockedGet.mockResolvedValue({ data: { response: {} } });

    await expect(service().getWishlist(STEAM_ID)).rejects.toMatchObject({
      code: 'empty_or_private',
    });
  });

  it('переводит копейки в рубли и проставляет валюту региона', async () => {
    mockSteam();

    const { items } = await service().getWishlist(STEAM_ID);
    const portal = items.find((i) => i.appId === 620);

    expect(portal).toMatchObject({
      title: 'Portal 2',
      platform: 'steam',
      currentPrice: 385,
      originalPrice: 385,
      currency: 'RUB',
      discountPercent: 0,
      isFree: false,
      unavailable: false,
      saleEndDate: null,
    });
  });

  it('разбирает скидку вместе с исходной ценой и датой окончания', async () => {
    mockSteam();

    const { items } = await service().getWishlist(STEAM_ID);
    const remnant = items.find((i) => i.appId === 1282100);

    expect(remnant).toMatchObject({
      currentPrice: 573,
      originalPrice: 2869,
      discountPercent: 80,
      unavailable: false,
    });
    expect(remnant?.saleEndDate).toEqual(new Date(1790614800 * 1000));
  });

  it('товар вне региона помечается unavailable, а не бесплатным', async () => {
    mockSteam();

    const { items } = await service().getWishlist(STEAM_ID);
    const cyberpunk = items.find((i) => i.appId === 1091500);

    expect(cyberpunk).toMatchObject({
      title: 'Cyberpunk 2077',
      unavailable: true,
      isFree: false,
      currentPrice: null,
      currency: null,
      discountPercent: 0,
    });
  });

  it('товар без варианта покупки тоже unavailable', async () => {
    mockSteam();

    const { items } = await service().getWishlist(STEAM_ID);

    expect(items.find((i) => i.appId === 2669320)).toMatchObject({ unavailable: true });
  });

  it('собирает ссылку на страницу и обложку', async () => {
    mockSteam();

    const { items } = await service().getWishlist(STEAM_ID);
    const portal = items.find((i) => i.appId === 620);

    expect(portal?.gameUrl).toBe('https://store.steampowered.com/app/620/Portal_2');
    expect(portal?.imageUrl).toBe(
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg?t=1745363004'
    );
  });

  it('переносит приоритет и дату добавления', async () => {
    mockSteam();

    const { items } = await service().getWishlist(STEAM_ID);
    const portal = items.find((i) => i.appId === 620);

    expect(portal?.priority).toBe(1);
    expect(portal?.addedAt).toEqual(new Date(1403384867 * 1000));
  });
});

describe('SteamWishlistService: чанки, потолок и кэш', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  /** Вишлист на заданное число позиций и пустые карточки в ответ на GetItems. */
  function mockLargeWishlist(count: number) {
    const items = Array.from({ length: count }, (_, i) => ({
      appid: i + 1,
      priority: i + 1,
      date_added: 1403384867,
    }));

    mockedGet.mockImplementation(async (url: string) => {
      if (url.includes('GetWishlist')) return { data: { response: { items } } };
      if (url.includes('GetItems')) return { data: { response: { store_items: [] } } };
      throw new Error(`неожиданный запрос: ${url}`);
    });
  }

  const getItemsCalls = () =>
    mockedGet.mock.calls.filter((call) => String(call[0]).includes('GetItems')).length;

  it('150 appid разбиваются на два запроса к GetItems', async () => {
    mockLargeWishlist(150);

    await service().getWishlist(STEAM_ID);

    expect(getItemsCalls()).toBe(2);
  });

  it('вишлист сверх потолка усекается, исходный размер сохраняется', async () => {
    mockLargeWishlist(2500);

    const result = await service().getWishlist(STEAM_ID);

    expect(result.wishlistTotal).toBe(2500);
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(2000);
    expect(getItemsCalls()).toBe(20);
  });

  it('повторный вызов в пределах TTL берётся из кэша, сеть не трогается', async () => {
    mockSteam();
    const sut = service();

    await sut.getWishlist(STEAM_ID);
    const afterFirst = mockedGet.mock.calls.length;
    await sut.getWishlist(STEAM_ID);

    expect(mockedGet.mock.calls.length).toBe(afterFirst);
  });

  it('resetCache заставляет сходить в Steam заново', async () => {
    mockSteam();
    const sut = service();

    await sut.getWishlist(STEAM_ID);
    const afterFirst = mockedGet.mock.calls.length;
    sut.resetCache();
    await sut.getWishlist(STEAM_ID);

    expect(mockedGet.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
