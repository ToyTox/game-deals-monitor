import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const read = (name: string) => readFileSync(path.join(publicDir, name), 'utf8');

export interface StubResponse {
  status?: number;
  body: unknown;
}

// Ответ на запрос: готовое тело или функция от URL запроса
export type Route = unknown | ((url: URL) => StubResponse | unknown);

export interface PageOptions {
  // Страница и её скрипт после common.js: по умолчанию главная
  entry?: { html: string; script: string };
  routes?: Record<string, Route>;
  // Значения localStorage на момент загрузки страницы
  storage?: Record<string, string>;
}

export interface Page {
  window: JSDOM['window'];
  document: JSDOM['window']['document'];
  errors: unknown[];
  // Число вызовов fetch по пути запроса (без query)
  calls: (pathname: string) => number;
  // Ждёт, пока условие выполнится: init-блок app.js не возвращает промис
  waitFor: (condition: () => boolean, message?: string) => Promise<void>;
  close: () => void;
}

const isStubResponse = (v: unknown): v is StubResponse =>
  typeof v === 'object' && v !== null && 'body' in v;

// Поднимает настоящий public/index.html (или admin.html) и выполняет common.js и app.js (или admin.js)
// как классические скрипты: функции и let/const остаются общими глобалами.
export async function loadPage(options: PageOptions = {}): Promise<Page> {
  const errors: unknown[] = [];
  const callCounts = new Map<string, number>();

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e));

  const dom = new JSDOM(read(options.entry?.html ?? 'index.html'), {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      // В jsdom нет matchMedia
      Object.defineProperty(window, 'matchMedia', {
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      });
      for (const [k, v] of Object.entries(options.storage ?? {})) window.localStorage.setItem(k, v);

      window.addEventListener('error', (e) => errors.push(e.error ?? e.message));
      window.addEventListener('unhandledrejection', (e) => errors.push((e as unknown as { reason: unknown }).reason));

      Object.defineProperty(window, 'fetch', {
        value: async (input: string) => {
          const url = new URL(input, 'http://localhost/');
          callCounts.set(url.pathname, (callCounts.get(url.pathname) ?? 0) + 1);
          const route = options.routes?.[url.pathname];
          let res: StubResponse = { status: 404, body: { error: `not stubbed: ${url.pathname}` } };
          if (route !== undefined) {
            const out = typeof route === 'function' ? (route as (u: URL) => unknown)(url) : route;
            res = isStubResponse(out) ? out : { body: out };
          }
          const status = res.status ?? 200;
          return { ok: status >= 200 && status < 300, status, json: async () => res.body };
        },
      });
    },
  });

  // Промис, отклонённый в скрипте страницы, доходит до процесса, а не до window
  const onRejection = (reason: unknown) => errors.push(reason);
  process.on('unhandledRejection', onRejection);

  const { document } = dom.window;
  for (const name of ['common.js', options.entry?.script ?? 'app.js']) {
    const script = document.createElement('script');
    script.textContent = read(name);
    document.body.appendChild(script);
  }

  const waitFor = async (condition: () => boolean, message = 'условие не выполнилось') => {
    for (let i = 0; i < 200; i++) {
      if (errors.length > 0) break;
      if (condition()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    if (errors.length === 0) throw new Error(`waitFor: ${message}`);
  };

  return {
    window: dom.window,
    document,
    errors,
    calls: (pathname) => callCounts.get(pathname) ?? 0,
    waitFor,
    close: () => {
      process.off('unhandledRejection', onRejection);
      dom.window.close();
    },
  };
}
