# Разработка

## Как добавить новую платформу

1. Добавьте платформу в union `Platform` в `src/types.ts`, если её там ещё нет (сейчас объявлены `steam`, `epic`, `gog`, `vkplay`, `ubisoft`, `origin`, `xbox`).
2. Создайте `src/parsers/<name>Parsers.ts`, унаследуйтесь от `BaseParser` и реализуйте единственный обязательный метод `parse(): Promise<ParsedGame[]>`. Сохранение в БД, история цен и логирование уже есть в базовом классе.

   ```ts
   import { BaseParser } from './BaseParsers.js';
   import { ParsedGame } from '../types.js';

   export class UbisoftParser extends BaseParser {
     constructor() {
       super('ubisoft', 'Ubisoft Store');
     }

     async parse(): Promise<ParsedGame[]> {
       // сходить в API площадки и собрать ParsedGame[]
       return [];
     }
   }

   export default UbisoftParser;
   ```

3. Зарегистрируйте парсер в конструкторе `ParserService` (`src/services/parserService.ts`):

   ```ts
   this.parsers = [
     new SteamParser(),
     new EpicParser(),
     new GOGParser(),
     new VkPlayParser(),
     new UbisoftParser(),
   ];
   ```

Имя класса должно содержать имя платформы — по нему работают и `parsePlatform()`, и `GET /api/admin/platforms`. Импорты внутри `src/` пишутся с расширением `.js` — это требование ESM.

## Структура проекта

```
game-deals-monitor/
├── .github/workflows/
│   └── test.yml             # CI: build + typecheck + test
├── prisma/
│   ├── migrations/          # миграции Prisma
│   └── schema.prisma        # модели Game, PriceHistory, UpdateLog
├── public/                  # веб-интерфейс (index.html, app.js, styles.css)
├── src/
│   ├── index.ts             # запуск: listen, cron, graceful shutdown
│   ├── app.ts               # createApp(): сборка Express без побочных эффектов
│   ├── database.ts          # singleton PrismaClient (с логами вне production)
│   ├── generated/prisma/    # сгенерированный Prisma-клиент (в .gitignore)
│   ├── types.ts             # Platform, ParsedGame, UpdateResult, StatsResponse
│   ├── parsers/
│   │   ├── BaseParsers.ts   # абстрактный парсер: saveGames(), run()
│   │   ├── helpers.ts       # общие утилиты парсеров
│   │   ├── steamParsers.ts
│   │   ├── epicParsers.ts
│   │   ├── gogParsers.ts
│   │   └── vkPlayParsers.ts
│   ├── routes/
│   │   ├── games.ts         # /api/games/*
│   │   └── admin.ts         # /api/admin/*
│   └── services/
│       ├── parserService.ts # оркестрация парсеров
│       └── gameService.ts   # выборки, статистика, поиск
├── tests/
│   ├── unit/                # парсеры на фикстурах
│   ├── db/                  # saveGames и GameService на реальной SQLite
│   ├── http/                # роуты через supertest
│   ├── helpers/             # resetDb(), фикстуры, подмена env
│   ├── fixtures/            # сохранённые ответы площадок
│   ├── globalSetup.ts       # поднятие и снос тестовой БД
│   └── setup.ts             # глушение console.log
├── scripts/
│   └── setup.mjs            # postinstall: .env + prisma generate + migrate deploy
├── prisma.config.ts         # конфиг Prisma CLI (схема, миграции, DATABASE_URL)
├── vitest.config.ts
├── docker-compose.yml
├── Dockerfile
├── tsconfig.json
├── tsconfig.test.json
└── package.json
```

## Тесты

Тестовый фреймворк — **Vitest**, файлы в `tests/**/*.test.ts`. Сюита разделена на три слоя:

- **unit/** — юнит-тесты парсеров на сохранённых фикстурах (файлы в `tests/fixtures/`);
- **db/** — интеграционные тесты `BaseParser.saveGames()` и `GameService` на реальной SQLite;
- **http/** — функциональные тесты роутов через `supertest` поверх `createApp()`.

`tests/globalSetup.ts` поднимает отдельную тестовую БД в `.tmp/test.db` перед прогоном сюиты: удаляет старый файл, при отсутствии сгенерированного клиента вызывает `prisma generate`, затем накатывает схему через `prisma migrate deploy` — именно миграциями, а не `db push`, чтобы тесты видели тот же DDL, что и продакшен. После завершения сюиты файл БД удаляется.

Конфигурация в `vitest.config.ts`:
- `pool: 'forks'` + `singleFork` — вся сюита исполняется в одном рабочем процессе с общей БД. Поэтому в тестах **нельзя** вызывать `prisma.$disconnect()` — это отключит клиента для всех последующих файлов.
- Переменные окружения фиксируются в конфиге: `NODE_ENV=test`, собственный `DATABASE_URL` (`.tmp/test.db`), `STEAM_SEARCH_PAGES=0`, все `VKPLAY_*`, `RUN_ON_STARTUP=false`. Парсеры читают `process.env` при загрузке модуля, поэтому тесты не зависят от локального `.env`.

Вспомогательная функция `resetDb()` из `tests/helpers/db.ts` очищает таблицы между тестами. Автоинкрементные ID при этом не сбрасываются, поэтому в ассертах проверять литеральный `id` нельзя — его значение недетерминировано.

CI (`.github/workflows/test.yml`): `npm ci` с флагом `SKIP_DB_MIGRATE=1`, затем `npm run build`, `npm run typecheck`, `npm test`.

