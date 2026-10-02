import { afterEach, describe, expect, it } from 'vitest';
import { loadPage, type Page, type Route } from './page.js';

const DYNAMICS = {
  country: 'RU',
  currency: 'RUB',
  graphPoints: [
    { timestamp: '2025-01-01T00:00:00Z', price: 1000 },
    { timestamp: '2025-02-01T00:00:00Z', price: 500 },
    { timestamp: '2025-03-01T00:00:00Z', price: 700 },
  ],
  periods: {
    day: { price: 700, change: 0, lowest: 700 },
    week: { price: 700, change: 10, lowest: 600 },
    month: { price: 700, change: -5, lowest: 500 },
    half_year: { price: 700, change: null, lowest: 500 },
  },
  allTimeLowest: { price: 500, timestamp: '2025-02-01T00:00:00Z' },
};

let page: Page;
afterEach(() => page?.close());

async function open(dynamics: Route, status: Route = { enabled: true }) {
  page = await loadPage({
    routes: {
      '/api/price-dynamics/status': status,
      '/api/price-dynamics': dynamics,
      '/api/games': (url: URL) =>
        url.searchParams.get('free') === 'true'
          ? { games: [], total: 0 }
          : { games: [{ id: 1, slug: 'g', title: 'G', platform: 'steam', gameUrl: 'https://store.steampowered.com/app/1/G/', currentPrice: 1, isFree: false }], total: 1 },
    },
  });
  await page.waitFor(() => page.document.querySelector('#deals-grid .card') !== null, 'карточка не отрисована');
  const btn = page.document.querySelector<HTMLButtonElement>('.btn-price-dynamics')!;
  const block = page.document.querySelector<HTMLElement>('.card-dynamics')!;
  const click = async (until: () => boolean) => {
    btn.click();
    await page.waitFor(until, 'клик не обработан');
  };
  return { btn, block, click };
}

describe('кнопка «Динамика цены»', () => {
  it('грузит один раз, затем сворачивает и раскрывает без запросов', async () => {
    const { block, click } = await open(DYNAMICS);
    expect(block.hidden).toBe(true);

    await click(() => block.dataset.loaded === '1');
    expect(page.calls('/api/price-dynamics')).toBe(1);
    expect(block.hidden).toBe(false);
    expect(block.querySelector('.dynamics-content svg')).not.toBeNull();
    expect(block.querySelector('.periods-table')).not.toBeNull();

    await click(() => block.hidden);
    await click(() => !block.hidden);
    expect(page.calls('/api/price-dynamics')).toBe(1);
    expect(page.errors).toEqual([]);
  });

  it('при ошибке показывает текст, следующий клик повторяет запрос', async () => {
    let attempt = 0;
    const { block, click } = await open(() =>
      ++attempt === 1 ? { status: 502, body: { error: 'ITAD недоступен' } } : DYNAMICS,
    );

    await click(() => block.querySelector('.dynamics-error') !== null);
    expect(block.querySelector('.dynamics-state')!.textContent).toContain('ITAD недоступен');
    expect(block.hidden).toBe(false);
    expect(page.calls('/api/price-dynamics')).toBe(1);

    await click(() => block.dataset.loaded === '1');
    expect(page.calls('/api/price-dynamics')).toBe(2);
    expect(block.querySelector('.periods-table')).not.toBeNull();
    expect(page.errors).toEqual([]);
  });
});

describe('баннер ITAD', () => {
  const banner = () => page.document.getElementById('itad-banner')!;

  it('виден при выключенном ключе', async () => {
    page = await loadPage({ routes: { '/api/price-dynamics/status': { enabled: false } } });
    await page.waitFor(() => !banner().hidden, 'баннер не показан');
    expect(page.errors).toEqual([]);
  });

  it('скрыт при включённом', async () => {
    page = await loadPage({ routes: { '/api/price-dynamics/status': { enabled: true } } });
    await page.waitFor(() => page.calls('/api/price-dynamics/status') === 1);
    await page.waitFor(() => page.calls('/api/games') === 2, 'каталог не загружен');
    expect(banner().hidden).toBe(true);
    expect(page.errors).toEqual([]);
  });

  it('виден при ошибке запроса статуса', async () => {
    page = await loadPage({
      routes: { '/api/price-dynamics/status': { status: 500, body: { error: 'boom' } } },
    });
    await page.waitFor(() => !banner().hidden, 'баннер не показан');
    expect(page.errors).toEqual([]);
  });
});
