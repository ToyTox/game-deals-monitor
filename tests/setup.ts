import { beforeEach, vi } from 'vitest';

// BaseParser и parserService крайне многословны — иначе вывод сюиты не читается.
// Именно beforeEach, а не beforeAll: restoreMocks снимает заглушку после
// каждого теста, и установленная один раз она пережила бы только первый.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
