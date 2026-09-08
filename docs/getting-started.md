# Установка и запуск

## Требования

- **Node.js >= 18** (Docker-образ собирается на `node:20-alpine`)
- npm

## Быстрый старт

```bash
git clone https://github.com/ToyTox/game-deals-monitor.git
cd game-deals-monitor

npm install
npm run dev
```

`npm install` через хук `postinstall` сам вызывает `npm run setup` (`scripts/setup.mjs`), который делает три вещи:

1. создаёт `.env` из `.env.example`, если файла ещё нет (существующий не трогает);
2. генерирует Prisma-клиент в `src/generated/` — каталог в `.gitignore`, без генерации не разрешится импорт `./generated/prisma/client.js` в `src/database.ts`;
3. применяет миграции через `prisma migrate deploy` — неинтерактивно, имя миграции спрашивать не будет и базу создаст с нуля.

Если нужно прогнать подготовку повторно (например, после `git pull` с новыми миграциями) — `npm run setup`. Переменная `SKIP_DB_MIGRATE=1` отключает третий шаг: так собирается Docker-образ, где БД на этапе сборки ещё недоступна.

Сервер поднимется на `http://localhost:3000`. По этому адресу открывается веб-интерфейс: статистика, ручки всех API-методов и карточки найденных игр. JSON-карта эндпоинтов переехала на `/api`.

```bash
curl http://localhost:3000/api
curl http://localhost:3000/api/admin/health
```

> ⚠️ По умолчанию `RUN_ON_STARTUP` включён, и парсеры стартуют сразу при запуске — первый старт займёт время на сетевые запросы. Чтобы поднять сервер мгновенно, запускайте с `RUN_ON_STARTUP=false npm run dev`.

## Переменные окружения

Файл `.env` (образец — `.env.example`):

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `3000` | Порт HTTP-сервера |
| `NODE_ENV` | `development` | В `production` Prisma-клиент создаётся без отладочных логов; в остальных режимах логируются `query`, `error`, `warn` |
| `DATABASE_URL` | `file:./prisma/dev.db` | Строка подключения к БД |
| `CRON_SCHEDULE` | `0 6 * * *` | Cron-выражение для планового парсинга |
| `RUN_ON_STARTUP` | `true` | Запускать ли парсеры при старте сервера |
| `LOG_LEVEL` | `info` | Объявлена в `.env.example`, **но в коде не используется** |
| `STEAM_COUNTRY_CODE` | `ru` | Регион магазина Steam (`cc`): определяет валюту цен |
| `STEAM_LANGUAGE` | `russian` | Язык Steam (`l`): определяет язык названий и описаний |
| `STEAM_SEARCH_PAGES` | `3` | Сколько страниц по 100 игр обойти в поиске по акциям; `0` — только витрина |
| `VKPLAY_MAX_PAGES` | `0` | Сколько страниц каталога VK Play обойти (24 игры на страницу); `0` — весь каталог |
| `VKPLAY_ONLY_DISCOUNTED` | `true` | Сохранять только игры со скидкой; `false` — все продаваемые |
| `VKPLAY_REQUEST_DELAY` | `300` | Пауза между страницами каталога VK Play, мс |

Важные нюансы:

- `RUN_ON_STARTUP` проверяется как `process.env.RUN_ON_STARTUP !== 'false'` (`src/index.ts`). То есть парсеры при старте включены **по умолчанию**, и выключить их можно только точным значением `false` — пустое значение или отсутствие переменной их не отключат.
- `import 'dotenv/config'` стоит **первым импортом** в `src/index.ts`: модули парсеров читают `process.env` на этапе загрузки, а импорты в ESM выполняются до тела модуля. Если перенести его ниже, настройки региона Steam из `.env` подхватываться не будут.
- Строка подключения нигде не дублируется в схеме: рантайм передаёт её в адаптер (`PrismaBetterSqlite3({ url: process.env.DATABASE_URL })` в `src/database.ts`), а Prisma CLI берёт её из `prisma.config.ts`. Относительный путь SQLite адаптер резолвит **от рабочего каталога процесса**, то есть от корня проекта: `file:./prisma/dev.db` кладёт базу в `prisma/dev.db` (он же в `.gitignore`), а `file:./dev.db` — в корень репозитория.

## Конфигурация Prisma 7

- `prisma.config.ts` в корне — конфиг Prisma CLI: путь к схеме (`prisma/schema.prisma`), каталог миграций (`prisma/migrations`) и `datasource.url` из `env("DATABASE_URL")`. `.env` подхватывается прямо в конфиге через `import "dotenv/config"`.
- У `datasource db` в `prisma/schema.prisma` больше нет поля `url` — оно задаётся снаружи: конфигом для CLI и адаптером для рантайма.
- Генератор — новый `prisma-client` (не legacy `prisma-client-js`): `output = "../src/generated/prisma"`, `runtime = "nodejs"`, `moduleFormat = "esm"`. Поэтому клиент импортируется из `./generated/prisma/client.js`, а не из `@prisma/client`.
- Подключение к SQLite идёт через driver adapter `@prisma/adapter-better-sqlite3` — это нативный модуль, ему нужна сборка при установке.

## npm-скрипты

| Команда | Что делает |
|---|---|
| `npm run setup` | Подготовка проекта: `.env` + генерация клиента + `prisma migrate deploy`. Запускается сам на `npm install` |
| `npm run dev` | Запуск в режиме разработки с автоперезапуском (`tsx watch src/index.ts`) |
| `npm run build` | Генерация Prisma-клиента и компиляция TypeScript в `dist/` |
| `npm start` | Применить миграции и запустить собранную версию (`prisma migrate deploy && node dist/index.js`) |
| `npm run db:migrate` | Создать новую миграцию после правки схемы (`prisma migrate dev`, спросит имя) |
| `npm run db:reset` | Снести БД и накатить миграции заново (`prisma migrate reset`) |
| `npm run db:studio` | Веб-интерфейс Prisma Studio для просмотра БД |
| `npm test` | Прогон тестов (`vitest run`) |
| `npm run test:watch` | Тесты в watch-режиме |
| `npm run test:coverage` | Тесты с отчётом покрытия (v8, `text` + `html`) |
| `npm run typecheck` | Проверка типов по `tsconfig.test.json` без эмита |

