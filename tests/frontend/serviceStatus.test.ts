import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPage, type Page } from './page.js';

let page: Page;
afterEach(() => page?.close());

const settle = () => new Promise((r) => setTimeout(r, 50));

const routes = {
  '/api/price-dynamics/status': { enabled: false },
  '/api/games': { games: [], total: 0 },
};

describe('шапка главной', () => {
  it('без health-статуса и строки обновления, health не запрашивается', async () => {
    page = await loadPage({ routes });
    await settle();
    for (const id of ['health-dot', 'health-text', 'refresh-status']) {
      expect(page.document.getElementById(id)).toBeNull();
    }
    expect(page.calls('/api/admin/health')).toBe(0);
    expect(page.errors).toEqual([]);
  });

  it('«Админка» — ссылка на /admin.html', async () => {
    page = await loadPage({ routes });
    const link = page.document.querySelector<HTMLAnchorElement>('header a.header-link[href="/admin.html"]')!;
    expect(link.textContent).toContain('Админка');
  });
});

describe('спиннер «Обновить всё»', () => {
  const spinner = () => page.document.querySelector<HTMLElement>('#refresh-all .spinner')!;

  it('скрыт, пока парсинг не идёт, и показан во время парсинга', async () => {
    let finish!: () => void;
    const parse = new Promise<void>((r) => (finish = r));
    page = await loadPage({
      routes: {
        ...routes,
        '/api/admin/parse': () => parse.then(() => ({ results: [] })),
      },
    });
    await settle();
    expect(spinner().hidden).toBe(true);

    page.document.getElementById('refresh-all')!.click();
    expect(spinner().hidden).toBe(false);

    finish();
    await page.waitFor(() => spinner().hidden, 'спиннер не скрылся');
    await settle();
  });

  it('в CSS скрытый спиннер не отображается, несмотря на display у .spinner', () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'styles.css'),
      'utf8',
    );
    expect(css).toMatch(/\.spinner\[hidden\]\s*{\s*display:\s*none;/);
  });
});

describe('админка: состояние сервиса', () => {
  const entry = { html: 'admin.html', script: 'admin.js' };
  const base = {
    '/api/admin/stats': {
      totalGames: 1, freeGames: 0, discountedGames: 0, averageDiscount: 0,
      lastUpdate: '2024-01-01T12:00:00Z', byStore: {}, topDiscounts: [],
    },
    '/api/admin/platforms': { platforms: ['steam'] },
  };
  const text = (id: string) => page.document.getElementById(id)!.textContent;

  it('показывает ok, uptime, время обновления и оценку парсинга', async () => {
    page = await loadPage({
      entry,
      routes: {
        ...base,
        '/api/admin/health': { status: 'ok', uptime: 3725.4 },
        '/api/admin/parse-estimate': {
          total: 218000,
          platforms: [
            { platform: 'steam', duration: 16000, measuredAt: '2024-01-01T00:00:00Z' },
            { platform: 'vkplay', duration: 218000, measuredAt: '2024-01-01T00:00:00Z' },
          ],
        },
      },
    });
    await page.waitFor(() => !!page.document.getElementById('service-health'), 'блок не отрисован');
    await settle();
    expect(text('service-health')).toBe('ok · uptime 1 ч 2 мин 5 с');
    expect(text('service-last-update')).not.toBe('—');
    expect(text('service-parse-total')).toBe('~4 мин');
    const breakdown = text('service-estimate')!;
    expect(breakdown).toContain('steam');
    expect(breakdown).toContain('~16 с');
    expect(breakdown).toContain('vkplay');
    expect(page.errors).toEqual([]);
  });

  it('«недоступен» при ошибке health и нет оценки — блок не ломается', async () => {
    page = await loadPage({
      entry,
      routes: { ...base, '/api/admin/health': { status: 500, body: { error: 'down' } } },
    });
    await page.waitFor(() => !!page.document.getElementById('service-health'), 'блок не отрисован');
    await settle();
    expect(text('service-health')).toBe('недоступен');
    expect(text('service-parse-total')).toBe('—');
    expect(text('service-estimate')).toBe('');
    expect(page.errors).toEqual([]);
  });
});
