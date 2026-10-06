import { afterEach, describe, expect, it } from 'vitest';
import { loadPage, type Page } from './page.js';

const steamApp = (over: Record<string, unknown> = {}) => ({
  id: null,
  slug: null,
  appId: 620,
  title: 'Portal 2',
  kind: 'game',
  imageUrl: null,
  description: 'Головоломка от Valve',
  createdAt: null,
  updatedAt: null,
  tags: [],
  offers: [
    {
      id: null,
      platform: 'steam',
      storeId: 'steam',
      storeName: 'Steam',
      storeKind: 'official',
      originalPrice: 1000,
      currentPrice: 500,
      currency: 'RUB',
      originalPriceRub: 1000,
      currentPriceRub: 500,
      discountPercent: 50,
      isFree: false,
      gameUrl: 'https://store.steampowered.com/app/620/Portal_2',
      saleEndDate: null,
      createdAt: null,
      updatedAt: null,
      priceHistory: [],
    },
  ],
  ...over,
});

const dbGame = {
  id: 7,
  slug: 'portal-2',
  title: 'Portal 2 из базы',
  kind: 'game',
  imageUrl: null,
  description: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  tags: [{ slug: 'puzzle', name: 'Головоломка' }],
  offers: steamApp().offers,
};

let page: Page;
afterEach(() => page?.close());

// Страница стартует без параметров (loadPage открывает http://localhost/), поэтому
// адрес выставляем и запускаем загрузку заново, как это делает браузер при переходе.
async function open(search: string, routes: Record<string, unknown>) {
  page = await loadPage({ entry: { html: 'game.html', script: 'game.js' }, routes });
  page.window.history.replaceState(null, '', `/game.html${search}`);
  page.window.eval('loadGame()');
  return page.document.getElementById('game-state')!;
}

describe('страница игры в режиме steamAppId', () => {
  it('показывает данные Steam и скрывает блоки без данных', async () => {
    await open('?steamAppId=620', { '/api/wishlist/app/620': steamApp() });
    const root = page.document.getElementById('game-root')!;
    await page.waitFor(() => !root.hidden, 'игра не показана');

    expect(page.errors).toEqual([]);
    expect(root.querySelector('h2')!.textContent).toBe('Portal 2');
    expect(root.querySelector('.game-desc')!.textContent).toBe('Головоломка от Valve');
    expect(root.querySelector('.game-offers')).not.toBeNull();
    expect(root.querySelector('.card-tags')).toBeNull();
    expect(root.querySelector('.card-history')).toBeNull();
    expect(root.querySelector('.card-meta')).toBeNull();
    expect(page.document.title).toBe('Portal 2 — Game Deals Monitor');
    expect(page.window.location.search).toBe('?steamAppId=620');
  });

  it('если игра есть в базе, заменяет адрес на slug и показывает обычную страницу', async () => {
    await open('?steamAppId=620', {
      '/api/wishlist/app/620': steamApp({ slug: 'portal-2' }),
      '/api/games/slug/portal-2': dbGame,
    });
    const root = page.document.getElementById('game-root')!;
    await page.waitFor(() => !root.hidden, 'игра не показана');

    expect(page.errors).toEqual([]);
    expect(page.window.location.search).toBe('?slug=portal-2');
    expect(page.window.history.length).toBe(1);
    expect(root.querySelector('h2')!.textContent).toBe('Portal 2 из базы');
    expect(root.querySelector('.card-tags')).not.toBeNull();
  });

  it('Steam не знает игру — понятное сообщение', async () => {
    const state = await open('?steamAppId=999', {
      '/api/wishlist/app/999': { status: 404, body: { error: 'Игра не найдена в Steam', code: 'not_found' } },
    });
    await page.waitFor(() => state.className === 'state-empty', 'состояние не выставлено');

    expect(state.textContent).toContain('Steam не знает такой игры');
    expect(page.document.getElementById('game-root')!.hidden).toBe(true);
  });

  it('сбой Steam — состояние ошибки с текстом', async () => {
    const state = await open('?steamAppId=620', {
      '/api/wishlist/app/620': { status: 502, body: { error: 'Steam не ответил', code: 'upstream' } },
    });
    await page.waitFor(() => state.className === 'state-error', 'состояние не выставлено');

    expect(state.textContent).toContain('Не удалось загрузить игру из Steam');
    expect(state.textContent).toContain('Steam не ответил');
  });

  it('некорректный appId — сообщение без запроса к API', async () => {
    const state = await open('?steamAppId=abc', {});
    await page.waitFor(() => state.className === 'state-empty', 'состояние не выставлено');

    expect(state.textContent).toContain('Некорректный идентификатор');
    expect(page.calls('/api/wishlist/app/abc')).toBe(0);
  });
});

describe('страница игры в режиме slug', () => {
  it('игра не найдена — сообщение про базу', async () => {
    const state = await open('?slug=nope', {
      '/api/games/slug/nope': { status: 404, body: { error: 'Игра не найдена' } },
    });
    await page.waitFor(() => state.className === 'state-empty', 'состояние не выставлено');

    expect(state.textContent).toContain('Такой игры нет в базе');
  });

  it('показывает игру из базы вместе с метаданными', async () => {
    await open('?slug=portal-2', { '/api/games/slug/portal-2': dbGame });
    const root = page.document.getElementById('game-root')!;
    await page.waitFor(() => !root.hidden, 'игра не показана');

    expect(root.querySelector('.card-meta')!.textContent).toContain('ID: 7');
  });
});
