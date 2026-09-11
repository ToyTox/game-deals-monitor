import { vi } from 'vitest';

/**
 * Загрузить модуль с подменённым окружением.
 *
 * Парсеры читают process.env в константы на этапе загрузки модуля, поэтому
 * менять process.env после обычного статического импорта бесполезно — значение
 * уже зафиксировано. Здесь окружение подменяется ДО импорта, а реестр модулей
 * сбрасывается, чтобы модуль выполнился заново.
 *
 * Импорт обязан передаваться литералом — иначе Vite не сможет его проанализировать:
 *   const mod = await withEnv({ X: '1' }, () => import('../../src/parsers/x.js'));
 */
export async function withEnv<T>(
  env: Record<string, string>,
  load: () => Promise<T>
): Promise<T> {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  vi.resetModules();

  try {
    return await load();
  } finally {
    process.env = prev;
    vi.resetModules();
  }
}
