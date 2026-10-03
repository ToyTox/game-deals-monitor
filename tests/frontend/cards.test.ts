import { afterEach, describe, expect, it } from 'vitest';
import { loadPage, type Page } from './page.js';

const WISHLIST_USER = '76561198000000000';

const game = (over: Record<string, unknown> = {}) => ({
  title: 'Test Game',
  platform: 'steam',
  gameUrl: 'https://store.steampowered.com/app/123/Test_Game/',
  currentPrice: 500,
  originalPrice: 1000,
  discountPercent: 50,
  currency: 'RUB',
  isFree: false,
  ...over,
});

let page: Page;
afterEach(() => page?.close());

async function open(section: 'deals' | 'wishlist', games: unknown[], itadEnabled: boolean) {
  const payload = { games, total: games.length };
  page = await loadPage({
    storage: section === 'wishlist' ? { steamWishlistUser: WISHLIST_USER } : {},
    routes: {
      '/api/price-dynamics/status': { enabled: itadEnabled },
      '/api/games': (url: URL) => (url.searchParams.get('free') === 'true' ? { games: [], total: 0 } : payload),
      '/api/wishlist': payload,
    },
  });
  const grid = page.document.getElementById(`${section}-grid`)!;
  await page.waitFor(() => grid.querySelectorAll('.card').length === games.length, 'карточки не отрисованы');
  expect(page.errors).toEqual([]);
  return grid;
}

describe('отрисовка карточек', () => {
  for (const section of ['deals', 'wishlist'] as const) {
    for (const withSlug of [true, false]) {
      for (const itad of [true, false]) {
        it(`${section}, ${withSlug ? 'со slug' : 'без slug'}, ITAD ${itad ? 'включён' : 'выключен'}`, async () => {
          const games = [game(withSlug ? { id: 1, slug: 'test-game' } : {})];
          const grid = await open(section, games, itad);

          const card = grid.querySelector('.card')!;
          expect(card.querySelector('h3 a')!.textContent).toBe('Test Game');
          expect(card.querySelector('.badge-platform')!.textContent).toBe('steam');
          expect(card.querySelector('.badge-discount')!.textContent).toBe('-50%');
          expect(card.querySelector('.card-price .current')).not.toBeNull();
          expect(card.querySelector('.card-dynamics')).not.toBeNull();

          const titleLink = card.querySelector('h3 a')!.getAttribute('href')!;
          if (withSlug) {
            expect(titleLink).toBe('/game.html?slug=test-game');
            expect(card.querySelector('.card-store-link a')).not.toBeNull();
          } else {
            expect(titleLink).toBe((games[0] as { gameUrl: string }).gameUrl);
            expect(card.querySelector('.card-store-link')).toBeNull();
          }

          expect(card.querySelector('.btn-price-dynamics') !== null).toBe(itad);
        });
      }
    }
  }
});
