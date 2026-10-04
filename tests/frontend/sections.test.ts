import { afterEach, describe, expect, it } from 'vitest';
import { loadPage, type Page } from './page.js';

let page: Page;
afterEach(() => page?.close());

const routes = {
  '/api/price-dynamics/status': { enabled: false },
  '/api/games': { games: [], total: 0 },
};

// Init-блок app.js не возвращает промис: даём ему дойти до конца, пока страница жива
const settle = () => new Promise((r) => setTimeout(r, 50));

const toggle = (key: string) =>
  page.document.querySelector<HTMLButtonElement>(`#section-${key} .section-toggle`)!;

describe('сворачиваемые разделы', () => {
  it('по умолчанию все развёрнуты', async () => {
    page = await loadPage({ routes });
    await settle();
    for (const key of ['wishlist', 'free', 'deals']) {
      expect(toggle(key).getAttribute('aria-expanded')).toBe('true');
      expect(page.document.getElementById(`section-${key}`)!.classList.contains('is-collapsed')).toBe(false);
    }
  });

  it('сворачивается по клику и состояние переживает перезагрузку', async () => {
    page = await loadPage({ routes });
    await settle();
    toggle('free').click();
    expect(toggle('free').getAttribute('aria-expanded')).toBe('false');
    expect(page.document.getElementById('section-free')!.classList.contains('is-collapsed')).toBe(true);
    expect(toggle('deals').getAttribute('aria-expanded')).toBe('true');

    const saved = page.window.localStorage.getItem('collapsedSections')!;
    page.close();

    page = await loadPage({ routes, storage: { collapsedSections: saved } });
    await settle();
    expect(toggle('free').getAttribute('aria-expanded')).toBe('false');
    expect(page.document.getElementById('section-free')!.classList.contains('is-collapsed')).toBe(true);
    expect(toggle('deals').getAttribute('aria-expanded')).toBe('true');

    toggle('free').click();
    expect(toggle('free').getAttribute('aria-expanded')).toBe('true');
    expect(JSON.parse(page.window.localStorage.getItem('collapsedSections')!)).toEqual({});
  });
});

describe('статистика', () => {
  const stats = {
    totalGames: 10,
    freeGames: 2,
    discountedGames: 3,
    averageDiscount: 40,
    lastUpdate: '2024-01-01T00:00:00Z',
    byStore: { steam: { total: 10, free: 2, discounted: 3 } },
    topDiscounts: [{ title: 'Top Game', storeId: 'steam', discount: 90 }],
  };

  it('главная не запрашивает /api/admin/stats', async () => {
    page = await loadPage({ routes: { ...routes, '/api/admin/health': { uptime: 5 } } });
    await page.waitFor(() => page.calls('/api/admin/health') > 0, 'health не запрошен');
    await settle();
    expect(page.calls('/api/admin/stats')).toBe(0);
    expect(page.document.getElementById('stats-tiles')).toBeNull();
    expect(page.errors).toEqual([]);
  });

  it('админка отрисовывает статистику', async () => {
    page = await loadPage({
      entry: { html: 'admin.html', script: 'admin.js' },
      routes: { '/api/admin/stats': stats, '/api/admin/platforms': { platforms: ['steam'] } },
    });
    const tiles = page.document.getElementById('stats-tiles')!;
    await page.waitFor(() => tiles.querySelectorAll('.stat-tile').length === 5, 'плитки не отрисованы');
    expect(tiles.textContent).toContain('10');
    expect(page.document.getElementById('stats-platforms')!.textContent).toContain('steam');
    expect(page.document.getElementById('stats-top')!.textContent).toContain('Top Game');
    expect(page.errors).toEqual([]);
  });
});
