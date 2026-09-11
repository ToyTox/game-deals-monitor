import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import EpicParser from '../../src/parsers/epicParsers.js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const mockedPost = axios.post as unknown as Mock;

/**
 * Форма ответа, которую реально возвращает GraphQL Epic: searchStore — объект
 * с полем elements. Именно её запрашивает код (`searchStore(...) { elements { ... } }`),
 * но обходит при этом сам searchStore.
 */
function epicResponse() {
  return {
    data: {
      data: {
        Catalog: {
          searchStore: {
            elements: [
              {
                title: 'Alan Wake 2',
                id: 'alan-wake-2',
                keyImages: [
                  { type: 'Thumbnail', url: 'https://cdn.test/aw2/thumb.jpg' },
                  { type: 'DieselStoreFrontWide', url: 'https://cdn.test/aw2/wide.jpg' },
                ],
                price: { totalPrice: { discountPrice: 2999, originalPrice: 5999 } },
                promotions: {
                  promotionalOffers: [
                    { promotionalOffers: [{ discountSetting: { discountPercentage: 50 } }] },
                  ],
                },
              },
              {
                title: 'Бесплатная раздача недели',
                id: 'free-weekly',
                keyImages: [{ type: 'Thumbnail', url: 'https://cdn.test/free/thumb.jpg' }],
                price: { totalPrice: { discountPrice: 0, originalPrice: 1999 } },
                promotions: null,
              },
            ],
          },
        },
      },
    },
  };
}

describe('EpicParser', () => {
  beforeEach(() => {
    mockedPost.mockReset();
  });

  /**
   * БАГ: код обходит `searchStore` вместо `searchStore.elements`.
   * searchStore — объект, for...of по нему бросает TypeError, ошибка гасится
   * общим catch, и парсер всегда возвращает пустой список. То есть Epic мёртв,
   * но стреляет на каждом тике крона.
   *
   * Тест написан на корректное поведение и падает намеренно.
   * Починка — обходить response.data.data.Catalog.searchStore.elements.
   */
  it('разбирает элементы из searchStore.elements', async () => {
    mockedPost.mockResolvedValue(epicResponse());

    const games = await new EpicParser().parse();

    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({
      title: 'Alan Wake 2',
      platform: 'epic',
      currency: 'USD',
      // Epic, как и Steam, отдаёт цены в центах.
      originalPrice: 59.99,
      currentPrice: 29.99,
      discountPercent: 50,
      isFree: false,
      gameUrl: 'https://www.epicgames.com/store/en-US/p/alan-wake-2',
      imageUrl: 'https://cdn.test/aw2/thumb.jpg',
    });
    expect(games[1]).toMatchObject({
      title: 'Бесплатная раздача недели',
      currentPrice: 0,
      isFree: true,
      discountPercent: 0,
    });
  });

  // Это поведение корректно и сейчас: оно гарантирует, что Promise.allSettled
  // в parserService не получит отказ от Epic из-за недоступности сети.
  it('при ошибке сети возвращает пустой список, не бросая исключение', async () => {
    mockedPost.mockRejectedValue(new Error('network down'));

    await expect(new EpicParser().parse()).resolves.toEqual([]);
  });

  it('на ответе без Catalog возвращает пустой список', async () => {
    mockedPost.mockResolvedValue({ data: { data: {} } });

    await expect(new EpicParser().parse()).resolves.toEqual([]);
  });

  it.todo('parseFreeGames — заглушка: еженедельные раздачи Epic не парсятся');
});
