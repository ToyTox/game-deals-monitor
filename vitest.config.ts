import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setup.ts'],

    // Один форк на всю сюиту: файлы идут последовательно, БД одна, конкуренции
    // за запись в SQLite нет. Как следствие — ни в одном тесте нельзя звать
    // prisma.$disconnect(): это убьёт клиента для всех последующих файлов.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

    // Парсеры читают process.env на этапе загрузки модуля, поэтому все
    // константы фиксируем здесь — иначе тесты зависят от .env разработчика.
    // Путь к базе обязан быть абсолютным: адаптер резолвит file:-URL от cwd,
    // а Prisma CLI — иначе, и в репозитории уже лежат две разные dev.db.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: `file:${path.join(root, '.tmp', 'test.db')}`,
      STEAM_COUNTRY_CODE: 'ru',
      STEAM_LANGUAGE: 'russian',
      STEAM_SEARCH_PAGES: '0',
      VKPLAY_MAX_PAGES: '2',
      VKPLAY_ONLY_DISCOUNTED: 'true',
      VKPLAY_REQUEST_DELAY: '0',
      RUN_ON_STARTUP: 'false',
    },

    restoreMocks: true,
    testTimeout: 15000,
    hookTimeout: 30000,

    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/index.ts', 'src/types.ts'],
      reporter: ['text', 'html'],
      // Часть тестов красная намеренно (они фиксируют незакрытые баги),
      // поэтому отчёт нужен и при неуспешном прогоне.
      reportOnFailure: true,
    },
  },
});
