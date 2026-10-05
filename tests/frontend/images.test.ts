import { afterEach, describe, expect, it } from 'vitest';
import { loadPage, type Page } from './page.js';

const COVER = 'https://cdn.test/cover.jpg';

const game = {
  id: 1,
  slug: 'test-game',
  title: 'Test Game',
  platform: 'gog',
  gameUrl: 'https://www.gog.com/ru/game/test_game',
  currentPrice: 500,
  originalPrice: 1000,
  discountPercent: 50,
  currency: 'RUB',
  isFree: false,
  imageUrl: COVER,
};

let page: Page;
afterEach(() => page?.close());

async function openCard() {
  page = await loadPage({
    routes: {
      '/api/price-dynamics/status': { enabled: false },
      '/api/games': (url: URL) =>
        url.searchParams.get('free') === 'true' ? { games: [], total: 0 } : { games: [game], total: 1 },
      '/api/wishlist': { games: [], total: 0 },
    },
  });
  const grid = page.document.getElementById('deals-grid')!;
  await page.waitFor(() => grid.querySelector('.card') !== null, 'карточка не отрисована');
  // Паузу между повторами сокращаем: настоящие секунды тесту ни к чему
  page.window.eval('imgRetryDelay = 2');
  return grid;
}

const fail = (page: Page, el: Element) => el.dispatchEvent(new page.window.Event('error'));
const cardEl = (grid: Element) => grid.querySelector('.card-img')!;

// Ошибка загрузки → пауза → новый src; так до исчерпания попыток
async function exhaust(grid: Element) {
  for (let i = 0; i < 3; i++) {
    const img = cardEl(grid) as HTMLImageElement;
    const before = img.getAttribute('src');
    fail(page, img);
    await page.waitFor(() => img.getAttribute('src') !== before, 'повтор не запущен');
  }
  fail(page, cardEl(grid));
}

describe('загрузка обложек', () => {
  it('битая картинка перезагружается с обходом кэша', async () => {
    const grid = await openCard();
    const img = cardEl(grid) as HTMLImageElement;

    fail(page, img);
    await page.waitFor(() => img.getAttribute('src') !== COVER, 'повтор не запущен');

    const url = new URL(img.getAttribute('src')!);
    expect(url.origin + url.pathname).toBe(COVER);
    expect(url.searchParams.get('_retry')).toMatch(/^1-/);
    expect(img.tagName).toBe('IMG');
  });

  it('заглушка ставится только после исчерпания попыток и хранит исходный URL', async () => {
    const grid = await openCard();
    await exhaust(grid);

    const stub = cardEl(grid);
    expect(stub.tagName).toBe('DIV');
    expect(stub.classList.contains('placeholder')).toBe(true);
    expect(stub.classList.contains('card-img')).toBe(true);
    expect((stub as HTMLElement).dataset.imgSrc).toBe(COVER);
    expect(page.errors).toEqual([]);
  });

  it('заглушка оживает по событию online', async () => {
    const grid = await openCard();
    await exhaust(grid);

    page.window.dispatchEvent(new page.window.Event('online'));

    const img = cardEl(grid) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.classList.contains('placeholder')).toBe(false);
    expect(img.getAttribute('src')).toContain(COVER);
    expect(grid.querySelector('.placeholder')).toBeNull();

    // Восстановленная картинка снова под присмотром
    const before = img.getAttribute('src');
    fail(page, img);
    await page.waitFor(() => img.getAttribute('src') !== before, 'повтор после восстановления не запущен');
  });

  it('карточка без обложки получает заглушку без URL и не оживает', async () => {
    const grid = await openCard();
    grid.innerHTML = '<div class="card-img placeholder"></div>';

    page.window.dispatchEvent(new page.window.Event('online'));

    expect(grid.querySelector('div.placeholder')).not.toBeNull();
    expect(grid.querySelector('img')).toBeNull();
  });

  it('аватар профиля прячется после исчерпания попыток и возвращается по online', async () => {
    const grid = await openCard();
    void grid;
    const avatar = page.document.getElementById('wishlist-avatar') as HTMLImageElement;
    avatar.hidden = false;
    avatar.src = 'https://avatars.test/me.jpg';

    for (let i = 0; i < 3; i++) {
      const before = avatar.getAttribute('src');
      fail(page, avatar);
      await page.waitFor(() => avatar.getAttribute('src') !== before, 'повтор не запущен');
    }
    fail(page, avatar);
    expect(avatar.hidden).toBe(true);

    page.window.dispatchEvent(new page.window.Event('online'));
    expect(avatar.hidden).toBe(false);
    expect(avatar.getAttribute('src')).toContain('https://avatars.test/me.jpg');
  });
});
