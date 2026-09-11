import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import SteamParser from '../../src/parsers/steamParsers.js';
import { ParsedGame } from '../../src/types.js';
import { readFixture, readJsonFixture } from '../helpers/fixtures.js';
import { withEnv } from '../helpers/withEnv.js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const mockedGet = axios.get as unknown as Mock;

const featured = readJsonFixture('steam-featuredcategories.json');
const searchHtml = readFixture('steam-search-results.html');

const byTitle = (games: ParsedGame[], title: string) => games.find((g) => g.title === title);

/** Ответ витрины; поиск в базовой конфигурации отключён (STEAM_SEARCH_PAGES=0). */
function mockFeatured(data: unknown = featured) {
  mockedGet.mockResolvedValue({ data });
}

describe('SteamParser: витрина', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('переводит цены из копеек в рубли', async () => {
    mockFeatured();

    const games = await new SteamParser().parse();
    const halfLife = byTitle(games, 'Half-Life');

    expect(halfLife).toMatchObject({
      platform: 'steam',
      originalPrice: 1999,
      currentPrice: 999.5,
      discountPercent: 50,
      isFree: false,
      gameUrl: 'https://store.steampowered.com/app/70',
      imageUrl: 'https://cdn.test/70/header.jpg',
      currency: 'RUB',
    });
  });

  it('обрезает пробелы в названии', async () => {
    mockFeatured();

    const games = await new SteamParser().parse();
    expect(byTitle(games, 'Portal')).toBeDefined();
  });

  it('при отсутствии оригинальной цены подставляет текущую', async () => {
    mockFeatured();

    // Portal 2: original_price = null, скидки нет.
    expect(byTitle(await new SteamParser().parse(), 'Portal 2')).toMatchObject({
      originalPrice: 899,
      currentPrice: 899,
      discountPercent: 0,
    });
  });

  it('превращает discount_expiration в дату', async () => {
    mockFeatured();

    const halfLife = byTitle(await new SteamParser().parse(), 'Half-Life');
    expect(halfLife?.saleEndDate?.toISOString()).toBe(new Date(1900000000 * 1000).toISOString());
  });

  it('подставляет валюту региона, если Steam её не вернул', async () => {
    mockFeatured();

    // Portal 2 приходит без поля currency — берётся RUB по STEAM_COUNTRY_CODE=ru.
    expect(byTitle(await new SteamParser().parse(), 'Portal 2')?.currency).toBe('RUB');
  });

  it('считает бесплатной игру с нулевой ценой', async () => {
    mockFeatured();

    expect(byTitle(await new SteamParser().parse(), 'Portal')).toMatchObject({
      currentPrice: 0,
      isFree: true,
    });
  });

  // Намеренное исключение: у неанонсированных игр нет цены, и они попали бы
  // в базу как «бесплатные».
  it('пропускает категорию coming_soon', async () => {
    mockFeatured();

    expect(byTitle(await new SteamParser().parse(), 'Неанонсированная игра')).toBeUndefined();
  });

  it('пропускает игру без final_price', async () => {
    mockFeatured();

    expect(byTitle(await new SteamParser().parse(), 'Counter-Strike 2')).toBeUndefined();
  });

  it('одинаковый appId в двух категориях учитывает один раз', async () => {
    mockFeatured();

    const games = await new SteamParser().parse();

    // Half-Life есть и в specials, и в top_sellers — побеждает первая категория.
    expect(games.filter((g) => g.gameUrl.endsWith('/app/70'))).toHaveLength(1);
    expect(byTitle(games, 'Half-Life (дубль из другой категории)')).toBeUndefined();
  });

  it('передаёт регион и язык в параметрах запроса', async () => {
    mockFeatured();
    await new SteamParser().parse();

    expect(mockedGet.mock.calls[0][1]?.params).toMatchObject({ cc: 'ru', l: 'russian' });
  });

  it('при ошибке сети возвращает пустой список, а не падает', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));

    await expect(new SteamParser().parse()).resolves.toEqual([]);
  });
});

describe('SteamParser: разбор HTML поиска', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  /** Витрина пустая, поиск отдаёт одну страницу — так изолируется HTML-путь. */
  async function parseSearchOnly() {
    const { SteamParser: Parser } = await withEnv({ STEAM_SEARCH_PAGES: '1' }, () =>
      import('../../src/parsers/steamParsers.js')
    );

    mockedGet
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { results_html: searchHtml, total_count: 5 } });

    return new Parser().parse();
  }

  it('разбирает карточку со скидкой и зачёркнутой ценой', async () => {
    expect(byTitle(await parseSearchOnly(), 'Half-Life')).toMatchObject({
      currentPrice: 999.5,
      originalPrice: 1999,
      discountPercent: 50,
      currency: 'RUB',
      gameUrl: 'https://store.steampowered.com/app/70',
      imageUrl: 'https://cdn.test/70/capsule.jpg',
    });
  });

  it('без зачёркнутой цены восстанавливает оригинальную по проценту скидки', async () => {
    expect(byTitle(await parseSearchOnly(), 'Portal')).toMatchObject({
      currentPrice: 249.5,
      originalPrice: 499,
      discountPercent: 50,
    });
  });

  it('пропускает карточку без данных о цене', async () => {
    expect(byTitle(await parseSearchOnly(), 'Counter-Strike 2')).toBeUndefined();
  });

  it('без атрибута скидки ставит ноль', async () => {
    expect(byTitle(await parseSearchOnly(), 'The Witcher 3')).toMatchObject({
      currentPrice: 1299,
      originalPrice: 1299,
      discountPercent: 0,
    });
  });

  // БАГ: при скидке 100% без зачёркнутой цены формула делит на ноль.
  // Тест написан на корректное поведение и падает намеренно.
  // Починка — ограничить формулу диапазоном 0 < discountPercent < 100.
  it('при скидке 100% не выдаёт нечисловую оригинальную цену', async () => {
    const portal2 = byTitle(await parseSearchOnly(), 'Portal 2');

    expect(portal2).toMatchObject({ currentPrice: 0, discountPercent: 100, isFree: true });
    expect(Number.isFinite(portal2?.originalPrice ?? NaN)).toBe(true);
  });
});

describe('SteamParser: константы окружения', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('при STEAM_SEARCH_PAGES=0 в поиск не ходит вовсе', async () => {
    mockFeatured();
    await new SteamParser().parse();

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet.mock.calls[0][0]).toContain('/api/featuredcategories/');
  });

  // Фиксируем текущее поведение: нечисловое значение даёт NaN, сравнение
  // `NaN > 0` ложно, и поиск молча отключается.
  it('нечисловой STEAM_SEARCH_PAGES тихо отключает поиск по акциям', async () => {
    const { SteamParser: Parser } = await withEnv({ STEAM_SEARCH_PAGES: 'abc' }, () =>
      import('../../src/parsers/steamParsers.js')
    );

    mockFeatured();
    await new Parser().parse();

    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('STEAM_COUNTRY_CODE меняет валюту по умолчанию', async () => {
    const { SteamParser: Parser } = await withEnv(
      { STEAM_COUNTRY_CODE: 'us', STEAM_SEARCH_PAGES: '0' },
      () => import('../../src/parsers/steamParsers.js')
    );

    mockFeatured();

    // Portal 2 приходит без currency — подставляется валюта региона.
    expect(byTitle(await new Parser().parse(), 'Portal 2')?.currency).toBe('USD');
  });
});
