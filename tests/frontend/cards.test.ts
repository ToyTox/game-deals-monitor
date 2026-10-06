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
          const games = [game(withSlug ? { id: 1, slug: 'test-game' } : { appId: 123 })];
          const grid = await open(section, games, itad);

          const card = grid.querySelector('.card')!;
          expect(card.querySelector('h3 a')!.textContent).toBe('Test Game');
          expect(card.querySelector('.badge-platform')!.textContent).toBe('steam');
          expect(card.querySelector('.badge-discount')!.textContent).toBe('-50%');
          expect(card.querySelector('.card-price .current')).not.toBeNull();
          expect(card.querySelector('.card-dynamics')).not.toBeNull();

          const titleLink = card.querySelector('h3 a')!.getAttribute('href')!;
          expect(titleLink).toBe(withSlug ? '/game.html?slug=test-game' : '/game.html?steamAppId=123');
          expect(card.querySelector('.card-store-link a')!.getAttribute('href')).toBe(game().gameUrl);

          expect(card.querySelector('.btn-price-dynamics') !== null).toBe(itad);
        });
      }
    }
  }
});

describe('компактная карточка', () => {
  it('показывает только первый тег', async () => {
    const grid = await open('deals', [game({ id: 1, slug: 'g', tags: [{ name: 'RPG' }, { name: 'Indie' }, { name: 'Co-op' }] })], false);
    const tags = grid.querySelectorAll('.card-tag');
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toBe('RPG');
  });

  it('без тегов тег не рисуется', async () => {
    const grid = await open('deals', [game({ id: 1, slug: 'g' })], false);
    expect(grid.querySelector('.card-tag')).toBeNull();
  });

  it('не показывает ID, даты и историю цен', async () => {
    const grid = await open('deals', [game({
      id: 7,
      slug: 'g',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      priceHistory: [{ createdAt: '2024-01-01T00:00:00Z', oldPrice: 1, newPrice: 2, oldDiscount: 0, newDiscount: 0 }],
    })], false);
    const card = grid.querySelector('.card')!;
    expect(card.querySelector('.card-meta')).toBeNull();
    expect(card.querySelector('.card-history')).toBeNull();
    expect(card.textContent).not.toMatch(/ID:|Создано|Обновлено|История цен/);
  });

  it('вся карточка — одна ссылка, кнопка динамики и магазин не внутри неё', async () => {
    const grid = await open('deals', [game({ id: 1, slug: 'g' })], true);
    const card = grid.querySelector('.card')!;
    expect(card.querySelectorAll('a a')).toHaveLength(0);
    expect(card.querySelectorAll('a.card-link')).toHaveLength(1);
    expect(card.querySelector('a.card-link')!.getAttribute('href')).toBe('/game.html?slug=g');
    expect(card.querySelector('.card-store-link a')!.getAttribute('href')).toBe(game().gameUrl);

    const btn = card.querySelector<HTMLButtonElement>('.btn-price-dynamics')!;
    expect(btn.closest('a')).toBeNull();
    const click = new page.window.MouseEvent('click', { bubbles: true, cancelable: true });
    btn.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(page.window.location.href).toBe('http://localhost/');
  });

  it('позиция вишлиста без slug ведёт на страницу игры по appId, магазин — отдельной ссылкой в новой вкладке', async () => {
    const grid = await open('wishlist', [game({ appId: 123 })], false);
    const link = grid.querySelector('.card a.card-link')!;
    expect(link.getAttribute('href')).toBe('/game.html?steamAppId=123');
    expect(link.getAttribute('target')).toBeNull();

    const store = grid.querySelector('.card .card-store-link a')!;
    expect(store.getAttribute('href')).toBe(game().gameUrl);
    expect(store.getAttribute('target')).toBe('_blank');
  });

  it('позиция вишлиста со slug ведёт на обычную страницу игры', async () => {
    const grid = await open('wishlist', [game({ appId: 123, slug: 'test-game' })], false);
    expect(grid.querySelector('.card a.card-link')!.getAttribute('href')).toBe('/game.html?slug=test-game');
    expect(grid.querySelector('.card .card-store-link a')).not.toBeNull();
  });
});
