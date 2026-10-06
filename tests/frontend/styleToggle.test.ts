import { afterEach, describe, expect, it } from 'vitest';
import { loadPage, type Page, type PageOptions } from './page.js';

let page: Page;
afterEach(() => page?.close());

// Скрипты страницы ходят в API асинхронно: даём им отработать, прежде чем закрывать окно
async function open(options: PageOptions = {}) {
  page = await loadPage(options);
  await new Promise((r) => setTimeout(r, 50));
}

const pages: Record<string, PageOptions['entry']> = {
  'главная': { html: 'index.html', script: 'app.js' },
  'страница игры': { html: 'game.html', script: 'game.js' },
  'админка': { html: 'admin.html', script: 'admin.js' },
};

const mode = () => page.document.documentElement.dataset.style;
const theme = () => page.document.documentElement.dataset.theme;
const toggle = () => page.document.getElementById('style-toggle') as HTMLButtonElement;
const stored = () => page.window.localStorage.getItem('style');

describe('переключатель оформления', () => {
  it.each(Object.entries(pages))('кнопка режима и кнопка темы есть: %s', async (_name, entry) => {
    await open({ entry });
    expect(toggle()).not.toBeNull();
    expect(toggle().getAttribute('aria-label')).toBeTruthy();
    expect(toggle().title).toBeTruthy();
    expect(page.document.getElementById('theme-toggle')).not.toBeNull();
  });

  it('по умолчанию пиксельный режим, в хранилище ничего не пишется', async () => {
    await open();
    expect(mode()).toBe('pixel');
    expect(stored()).toBeNull();
  });

  it('восстанавливает сохранённый обычный режим', async () => {
    await open({ storage: { style: 'plain' } });
    expect(mode()).toBe('plain');
  });

  it('мусор в хранилище даёт пиксельный режим', async () => {
    await open({ storage: { style: 'fancy' } });
    expect(mode()).toBe('pixel');
  });

  it('клик переключает режим туда и обратно и сохраняет выбор', async () => {
    await open();
    const pixelLabel = toggle().getAttribute('aria-label');

    toggle().click();
    expect(mode()).toBe('plain');
    expect(stored()).toBe('plain');
    expect(toggle().getAttribute('aria-label')).not.toBe(pixelLabel);
    expect(toggle().title).toBe(toggle().getAttribute('aria-label'));

    toggle().click();
    expect(mode()).toBe('pixel');
    expect(stored()).toBe('pixel');
    expect(toggle().getAttribute('aria-label')).toBe(pixelLabel);
  });

  it('режим и тема переключаются независимо', async () => {
    await open({ storage: { theme: 'dark' } });
    const themeBtn = page.document.getElementById('theme-toggle') as HTMLButtonElement;

    toggle().click();
    expect(mode()).toBe('plain');
    expect(theme()).toBe('dark');

    themeBtn.click();
    expect(theme()).toBe('light');
    expect(mode()).toBe('plain');
    expect(page.window.localStorage.getItem('theme')).toBe('light');
    expect(stored()).toBe('plain');
  });

  it('недоступный localStorage не ломает переключение', async () => {
    await open();
    Object.defineProperty(page.window, 'localStorage', {
      get() { throw new Error('denied'); },
    });
    toggle().click();
    expect(mode()).toBe('plain');
  });
});
