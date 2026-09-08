# 🎮 Game Deals Monitor API

REST API для мониторинга скидок и бесплатных игр на игровых площадках: **Steam**, **Epic Games Store** и **GOG**.

Сервис по расписанию обходит площадки, складывает игры в БД, ведёт историю изменения цен и отдаёт всё это через HTTP: фильтры по платформе и размеру скидки, топ скидок, бесплатные игры, поиск по названию и статистика.

## ✨ Возможности

- 🔍 Автоматический обход площадок по cron-расписанию (по умолчанию — раз в сутки)
- 🔄 Все площадки парсятся параллельно (`Promise.allSettled`) — падение одной не ломает остальные
- 💾 История цен: новая запись пишется только когда цена или скидка реально изменились
- 🎯 Фильтрация и поиск по платформе, минимальной скидке, бесплатным играм, названию
- 📊 Статистика по площадкам и лог каждого запуска парсеров
- 🛠 Ручной запуск парсинга через `POST /api/admin/parse`
- 🗄️ SQLite «из коробки», PostgreSQL — при запуске в Docker

## 🧱 Стек

| Что | Чем |
|---|---|
| Рантайм | Node.js 20, ESM (`"type": "module"`) |
| Язык | TypeScript 5 |
| HTTP | Express 4, cors, morgan |
| БД | Prisma 7 + driver adapter `@prisma/adapter-better-sqlite3` (SQLite) |
| Сеть | axios |
| Расписание | node-cron |
| Разное | cheerio, dotenv |

## 📋 Требования

- **Node.js >= 18** (Docker-образ собирается на `node:20-alpine`)
- npm

## 🚀 Быстрый старт

```bash
git clone https://github.com/ToyTox/game-deals-monitor.git
cd game-deals-monitor

npm install
cp .env.example .env

npm run prisma:generate
npm run prisma:migrate     # первый раз спросит имя миграции, например init

npm run dev
```

> `src/generated/` лежит в `.gitignore`, поэтому `npm run prisma:generate` после клона обязателен: без него не разрешится импорт `./generated/prisma/client.js` в `src/database.ts`. В `npm run build` генерация уже встроена (`prisma generate && tsc`).

Сервер поднимется на `http://localhost:3000`. По этому адресу открывается веб-интерфейс: статистика, ручки всех API-методов и карточки найденных игр. JSON-карта эндпоинтов переехала на `/api`.

```bash
curl http://localhost:3000/api
curl http://localhost:3000/api/admin/health
```

> ⚠️ По умолчанию `RUN_ON_STARTUP` включён, и парсеры стартуют сразу при запуске — первый старт займёт время на сетевые запросы. Чтобы поднять сервер мгновенно, запускайте с `RUN_ON_STARTUP=false npm run dev`.

## ⚙️ Переменные окружения

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

Важные нюансы:

- `RUN_ON_STARTUP` проверяется как `process.env.RUN_ON_STARTUP !== 'false'` (`src/index.ts`). То есть парсеры при старте включены **по умолчанию**, и выключить их можно только точным значением `false` — пустое значение или отсутствие переменной их не отключат.
- `import 'dotenv/config'` стоит **первым импортом** в `src/index.ts`: модули парсеров читают `process.env` на этапе загрузки, а импорты в ESM выполняются до тела модуля. Если перенести его ниже, настройки региона Steam из `.env` подхватываться не будут.
- Строка подключения нигде не дублируется в схеме: рантайм передаёт её в адаптер (`PrismaBetterSqlite3({ url: process.env.DATABASE_URL })` в `src/database.ts`), а Prisma CLI берёт её из `prisma.config.ts`. Относительный путь SQLite адаптер резолвит **от рабочего каталога процесса**, то есть от корня проекта: `file:./prisma/dev.db` кладёт базу в `prisma/dev.db` (он же в `.gitignore`), а `file:./dev.db` — в корень репозитория.

## 🧬 Конфигурация Prisma 7

- `prisma.config.ts` в корне — конфиг Prisma CLI: путь к схеме (`prisma/schema.prisma`), каталог миграций (`prisma/migrations`) и `datasource.url` из `env("DATABASE_URL")`. `.env` подхватывается прямо в конфиге через `import "dotenv/config"`.
- У `datasource db` в `prisma/schema.prisma` больше нет поля `url` — оно задаётся снаружи: конфигом для CLI и адаптером для рантайма.
- Генератор — новый `prisma-client` (не legacy `prisma-client-js`): `output = "../src/generated/prisma"`, `runtime = "nodejs"`, `moduleFormat = "esm"`. Поэтому клиент импортируется из `./generated/prisma/client.js`, а не из `@prisma/client`.
- Подключение к SQLite идёт через driver adapter `@prisma/adapter-better-sqlite3` — это нативный модуль, ему нужна сборка при установке.

## 📜 npm-скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | Запуск в режиме разработки с автоперезапуском (`tsx watch src/index.ts`) |
| `npm run build` | Компиляция TypeScript в `dist/` |
| `npm start` | Запуск собранной версии (`node dist/index.js`) |
| `npm run prisma:generate` | Генерация Prisma-клиента |
| `npm run prisma:migrate` | Создание и применение миграции (`prisma migrate dev`) |
| `npm run prisma:studio` | Веб-интерфейс Prisma Studio для просмотра БД |
| `npm test` | Заглушка — тестов в проекте нет |

## 🌐 API

Базовый URL: `http://localhost:3000`.

### `GET /`

Веб-интерфейс (`public/index.html`): статистика, панель ручек для всех методов API и карточки игр.

### `GET /api`

Карта эндпоинтов и метаданные сервиса.

```json
{
  "name": "Game Deals Monitor API",
  "version": "1.0.0",
  "description": "API для мониторинга скидок и бесплатных игр",
  "endpoints": {
    "ui": "/",
    "games": "/api/games",
    "freeGames": "/api/games/free",
    "topDiscounts": "/api/games/top-discounts",
    "platformGames": "/api/games/platform/:name",
    "search": "/api/games/search?q=query",
    "singleGame": "/api/games/:title",
    "stats": "/api/admin/stats",
    "updates": "/api/admin/updates",
    "manualParse": "/api/admin/parse (POST)",
    "platforms": "/api/admin/platforms",
    "health": "/api/admin/health"
  }
}
```

---

### Игры

#### `GET /api/games`

Список игр с фильтрами. Сортировка — по убыванию скидки. К каждой игре подмешиваются **последние 5 записей** истории цен.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `platform` | string | — | Точное совпадение платформы: `steam`, `epic`, `gog` |
| `minDiscount` | number | — | Минимальная скидка в процентах (учитывается только если > 0) |
| `free` | `true` | — | `free=true` — только бесплатные игры |
| `limit` | number | `100` | Сколько записей вернуть |
| `offset` | number | `0` | Смещение для пагинации |

```bash
curl 'http://localhost:3000/api/games?platform=steam&minDiscount=50&limit=2'
```

```json
{
  "games": [
    {
      "id": 1,
      "title": "Cyberpunk 2077",
      "platform": "steam",
      "originalPrice": 59.99,
      "currentPrice": 29.99,
      "discountPercent": 50,
      "isFree": false,
      "gameUrl": "https://store.steampowered.com/app/1091500",
      "imageUrl": "https://.../header.jpg",
      "description": null,
      "saleEndDate": null,
      "createdAt": "2026-09-07T21:08:35.781Z",
      "updatedAt": "2026-09-07T21:08:35.781Z",
      "priceHistory": [
        {
          "id": 12,
          "gameId": 1,
          "oldPrice": 39.99,
          "newPrice": 29.99,
          "oldDiscount": 33,
          "newDiscount": 50,
          "createdAt": "2026-09-07T21:08:35.781Z"
        }
      ]
    }
  ],
  "total": 137,
  "limit": 2,
  "offset": 0
}
```

`total` — общее число записей под фильтром (без учёта `limit`/`offset`).

#### `GET /api/games/free`

Только бесплатные игры, сортировка — по дате добавления (сначала новые).

| Параметр | По умолчанию |
|---|---|
| `limit` | `50` |

```json
{ "games": [ /* ... */ ], "total": 4 }
```

Здесь и далее в списочных ответах `total` — длина возвращённого массива.

#### `GET /api/games/top-discounts`

Игры со скидкой > 0, отсортированные по убыванию скидки.

| Параметр | По умолчанию |
|---|---|
| `limit` | `20` |

#### `GET /api/games/platform/:name`

Игры конкретной площадки. `:name` приводится к нижнему регистру.

| Параметр | По умолчанию |
|---|---|
| `limit` | `50` |

```bash
curl http://localhost:3000/api/games/platform/gog
```

```json
{ "platform": "gog", "games": [ /* ... */ ], "total": 50 }
```

#### `GET /api/games/search?q=<строка>`

Поиск по подстроке в названии. Минимум **2 символа**, иначе `400`. Возвращает максимум **20** результатов, сортировка — по убыванию скидки.

```bash
curl 'http://localhost:3000/api/games/search?q=witcher'
```

```json
{ "query": "witcher", "games": [ /* ... */ ], "total": 3 }
```

Ошибка при слишком коротком запросе (`400`):

```json
{ "error": "Укажите поисковый запрос (минимум 2 символа)" }
```

#### `GET /api/games/:title`

Одна игра по точному названию + **вся** история цен (новые записи первыми). Название нужно URL-кодировать.

```bash
curl 'http://localhost:3000/api/games/Cyberpunk%202077'
```

Если игры нет — `404`:

```json
{ "error": "Игра не найдена" }
```

#### `GET /api/games/:title/price-history`

История цен по названию, до **50** записей, новые первыми.

```json
{
  "game": "Cyberpunk 2077",
  "history": [
    { "id": 12, "gameId": 1, "oldPrice": 39.99, "newPrice": 29.99, "oldDiscount": 33, "newDiscount": 50, "createdAt": "2026-09-07T21:08:35.781Z" }
  ],
  "total": 1
}
```

Если игры нет — `404` с текстом ошибки из сервиса.

> **Порядок роутов важен.** `/free`, `/top-discounts`, `/search` и `/platform/:name` объявлены в `src/routes/games.ts` **до** `/:title`, поэтому они не перехватываются как названия игр. Новые статические пути добавляйте туда же — выше `/:title`.

---

### Админка

> 🔓 Раздел `/api/admin/*` **ничем не защищён** — аутентификации и авторизации в коде нет. Не выставляйте его в публичный интернет как есть.

#### `GET /api/admin/stats`

Сводная статистика (тип `StatsResponse` из `src/types.ts`).

```json
{
  "totalGames": 137,
  "freeGames": 4,
  "discountedGames": 120,
  "averageDiscount": 42.71,
  "byPlatform": {
    "steam": { "total": 60, "free": 1, "discounted": 55 },
    "gog":   { "total": 77, "free": 3, "discounted": 65 }
  },
  "topDiscounts": [
    { "title": "Some Game", "platform": "gog", "discount": 90 }
  ],
  "lastUpdate": "2026-09-07T21:08:35.781Z"
}
```

`averageDiscount` считается только по играм со скидкой > 0 и округляется до двух знаков. `topDiscounts` — топ-10. `lastUpdate` — время последней записи в `UpdateLog` или `null`.

#### `GET /api/admin/updates`

Логи запусков парсеров (`UpdateLog`), новые первыми.

| Параметр | По умолчанию |
|---|---|
| `limit` | `50` |

```json
{
  "logs": [
    {
      "id": 1,
      "platform": "steam",
      "gamesCount": 60,
      "newGames": 60,
      "updatedGames": 0,
      "freedGames": 1,
      "startTime": "2026-09-07T21:08:35.780Z",
      "endTime": "2026-09-07T21:08:37.412Z",
      "duration": 1632,
      "status": "success",
      "error": null,
      "createdAt": "2026-09-07T21:08:37.413Z"
    }
  ],
  "total": 1
}
```

#### `POST /api/admin/parse`

Ручной запуск парсинга. Запрос синхронный: ответ придёт после завершения работы парсеров.

Одна площадка:

```bash
curl -X POST http://localhost:3000/api/admin/parse \
  -H 'Content-Type: application/json' \
  -d '{"platform": "steam"}'
```

```json
{
  "message": "Парсер steam успешно завершен",
  "result": { "platform": "steam", "total": 60, "new": 60, "updated": 0, "freed": 1 }
}
```

Все площадки (пустое тело или тело без `platform`):

```bash
curl -X POST http://localhost:3000/api/admin/parse \
  -H 'Content-Type: application/json' -d '{}'
```

```json
{
  "message": "Все парсеры успешно завершены",
  "results": [ { "platform": "steam", "total": 60, "new": 60, "updated": 0, "freed": 1 } ]
}
```

Неизвестная платформа — `500` с сообщением `Парсер для платформы <name> не найден`.

#### `GET /api/admin/platforms`

Список платформ, для которых зарегистрированы парсеры (имена берутся из имён классов).

```json
{ "platforms": ["steam", "epic", "gog"], "total": 3 }
```

#### `GET /api/admin/health`

```json
{ "status": "ok", "timestamp": "2026-09-07T21:08:25.359Z", "uptime": 5.08 }
```

`uptime` — аптайм процесса Node в секундах.

## 🗄️ Схема БД

`prisma/schema.prisma`, три модели. `datasource db` объявляет только `provider = "sqlite"` — url приходит извне (см. [🧬 Конфигурация Prisma 7](#-конфигурация-prisma-7)).

### `Game`

| Поле | Тип | Примечание |
|---|---|---|
| `id` | `Int` | PK, автоинкремент |
| `title` | `String` | **уникальное** — ключ, по которому игры матчатся между запусками |
| `platform` | `String` | `steam` / `epic` / `gog` |
| `originalPrice` | `Float?` | Цена без скидки |
| `currentPrice` | `Float?` | Текущая цена |
| `currency` | `String?` | Валюта цен, ISO 4217 (для российского Steam — `RUB`) |
| `discountPercent` | `Float` | По умолчанию `0` |
| `isFree` | `Boolean` | По умолчанию `false` |
| `gameUrl` | `String` | Ссылка на страницу игры |
| `imageUrl` | `String?` | Обложка |
| `description` | `String?` | Описание |
| `saleEndDate` | `DateTime?` | Когда заканчивается акция |
| `createdAt` / `updatedAt` | `DateTime` | Служебные |
| `priceHistory` | `PriceHistory[]` | Связь один-ко-многим |

Индексы: `platform`, `discountPercent`, `isFree`, `createdAt`.

### `PriceHistory`

| Поле | Тип |
|---|---|
| `id` | `Int` (PK) |
| `gameId` | `Int` → `Game.id`, `onDelete: Cascade` |
| `oldPrice` / `newPrice` | `Float?` |
| `oldDiscount` / `newDiscount` | `Float` (по умолчанию `0`) |
| `createdAt` | `DateTime` |

Индексы: `gameId`, `createdAt`.

**Запись создаётся не на каждом проходе парсера.** В `src/parsers/BaseParsers.ts` новая строка в `PriceHistory` появляется только если у уже существующей игры изменились `currentPrice` **или** `discountPercent`. Если цена не двигалась, история не растёт.

### `UpdateLog`

| Поле | Тип | Примечание |
|---|---|---|
| `id` | `Int` | PK |
| `platform` | `String` | Площадка |
| `gamesCount` | `Int` | Сколько игр вернул парсер |
| `newGames` / `updatedGames` / `freedGames` | `Int` | Созданы / обновлены / стали бесплатными |
| `startTime` / `endTime` | `DateTime` | Границы прогона |
| `duration` | `Int` | Длительность в мс |
| `status` | `String` | `success` или `error` |
| `error` | `String?` | Текст ошибки при `status = error` |
| `createdAt` | `DateTime` | Служебное |

Индексы: `platform`, `createdAt`.

## 🔄 Как работает парсинг

1. `ParserService` в конструкторе поднимает список парсеров: `SteamParser`, `EpicParser`, `GOGParser`.
2. `parseAll()` запускает `parser.run()` для всех через `Promise.allSettled` — упавший парсер попадает в список ошибок, но остальные доезжают до конца.
3. `BaseParser.run()` вызывает `parse()` конкретной площадки, затем `saveGames()`.
4. `saveGames()` для каждой игры ищет существующую запись **по уникальному `title`**:
   - не нашлась → `create`, `newCount++` (и `freedCount++`, если игра бесплатная);
   - нашлась → при изменившейся цене или скидке пишется `PriceHistory`, затем `update`, `updatedCount++` (и `freedCount++`, если игра стала бесплатной, а раньше не была).
5. В конце пишется запись в `UpdateLog` — со `status: 'success'` либо, в `catch`, со `status: 'error'` и текстом ошибки (ошибка после этого пробрасывается дальше).
6. `parseAll()` печатает в консоль сводку: по каждой площадке — всего / новых / обновлено / в бесплатные, затем суммарные цифры, время выполнения и список ошибок.

Отдельная площадка запускается через `parsePlatform(platform)`. Парсер ищется **по подстроке в имени класса**: `p.constructor.name.toLowerCase().includes(platform.toLowerCase())`. Поэтому `steam` находит `SteamParser`, а `gog` — `GOGParser`. Если совпадений нет, бросается `Парсер для платформы <name> не найден`.

Источники данных:

| Площадка | Источник |
|---|---|
| Steam | `GET https://store.steampowered.com/api/featuredcategories/?cc=ru&l=russian` (витрина: `specials`, `top_sellers`, `new_releases`) + `GET https://store.steampowered.com/search/results/?specials=1&infinite=1&json=1&cc=ru&l=russian` — до `STEAM_SEARCH_PAGES` страниц по 100 игр |
| Epic Games | `POST https://www.epicgames.com/graphql` (запрос `Catalog.searchStore`, первые 100 позиций) |
| GOG | `GET https://api.gog.com/v2/games/products` — до 5 страниц по 50 записей с сортировкой по скидке, плюс отдельный проход по бесплатным (`priceRange: '0,0'`) |

### 🇷🇺 Steam: российский регион

`SteamParser` ходит в магазин с параметрами региона `cc` и `l` (по умолчанию `ru` / `russian`), поэтому приходят рублёвые цены и русские названия. Валюта складывается в `Game.currency` — из поля `currency` ответа витрины, а для HTML-выдачи поиска берётся по коду страны (`ru → RUB`, `kz → KZT`, `by → BYN`, `ua → UAH`, `us → USD`).

Что делает парсер:

1. Тянет витрину `/api/featuredcategories/` — разделы `specials`, `top_sellers`, `new_releases`. Раздел `coming_soon` намеренно пропущен: у неанонсированных игр нет цены, и они попадали бы в базу как бесплатные.
2. Постранично обходит специальные предложения через `/search/results/` (`STEAM_SEARCH_PAGES` страниц по 100 игр, пауза 700 мс между запросами), разбирая HTML-карточки через cheerio.
3. Схлопывает дубли: сначала по `appid`, затем по названию — из одинаковых заголовков остаётся вариант с большей скидкой (`Game.title` в базе уникален).

Цены Steam отдаёт в копейках, парсер делит на 100. `discount_expiration` витрины пишется в `saleEndDate`, так что видно, когда акция заканчивается. Данные витрины приоритетнее: если игра есть и там, и в поиске, берутся точные цены из API.

Сменить регион — через `.env`, код менять не нужно:

```bash
STEAM_COUNTRY_CODE=kz
STEAM_LANGUAGE=russian
```

## ⏰ Расписание

Плановый запуск настраивается переменной `CRON_SCHEDULE` (cron-синтаксис `node-cron`). По умолчанию — `0 6 * * *`, то есть ежедневно в 06:00 **по времени сервера**.

```
0 6 * * *     ежедневно в 06:00
0 */6 * * *   каждые 6 часов
*/30 * * * *  каждые 30 минут
```

Расписание регистрируется при старте, независимо от `RUN_ON_STARTUP` — последняя отвечает только за разовый прогон в момент запуска.

## 🐳 Docker

```bash
docker compose up -d
```

Поднимаются три сервиса:

| Сервис | Образ | Порт | Назначение |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `5432` | БД (`gameadmin` / `gamepassword` / `game_deals`), с healthcheck; `app` ждёт готовности |
| `app` | сборка из `Dockerfile` | `3000` | Само API, `restart: unless-stopped` |
| `adminer` | `adminer:latest` | `8080` | Веб-клиент БД, сервер по умолчанию — `postgres` |

Данные Postgres лежат в томе `postgres_data`.

> ⚠️ **Перед первым `docker compose up` переезд на PostgreSQL нужно доделать руками.** `docker-compose.yml` передаёт приложению `DATABASE_URL` для PostgreSQL, а проект настроен на SQLite. В таком виде контейнер работать не будет. Нужно:
>
> 1. Поменять провайдер в `prisma/schema.prisma`:
>
>    ```prisma
>    datasource db {
>      provider = "postgresql"
>    }
>    ```
>
> 2. Заменить зависимость `@prisma/adapter-better-sqlite3` на `@prisma/adapter-pg` (плюс `pg`).
> 3. Переписать создание адаптера в `src/database.ts` — сейчас там жёстко зашит `PrismaBetterSqlite3`.
> 4. Заново сгенерировать миграции: SQLite-миграции из `prisma/migrations/` и `migration_lock.toml` с `provider = "sqlite"` для PostgreSQL не подойдут.
>
> После переезда из `Dockerfile` можно убрать `apk add --no-cache python3 make g++` — эти пакеты стоят там только ради нативной сборки `better-sqlite3`.

## ➕ Как добавить новую платформу

1. Добавьте платформу в union `Platform` в `src/types.ts`, если её там ещё нет (сейчас объявлены `steam`, `epic`, `gog`, `ubisoft`, `origin`, `xbox`).
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
     new UbisoftParser(),
   ];
   ```

Имя класса должно содержать имя платформы — по нему работают и `parsePlatform()`, и `GET /api/admin/platforms`. Импорты внутри `src/` пишутся с расширением `.js` — это требование ESM.

## 📁 Структура проекта

```
game-deals-monitor/
├── prisma/
│   ├── migrations/          # миграции Prisma
│   └── schema.prisma        # модели Game, PriceHistory, UpdateLog
├── public/                  # веб-интерфейс (index.html, app.js, styles.css)
├── src/
│   ├── index.ts             # точка входа: Express, cron, graceful shutdown
│   ├── database.ts          # singleton PrismaClient (с логами вне production)
│   ├── generated/prisma/    # сгенерированный Prisma-клиент (в .gitignore)
│   ├── types.ts             # Platform, ParsedGame, UpdateResult, StatsResponse
│   ├── parsers/
│   │   ├── BaseParsers.ts   # абстрактный парсер: saveGames(), run()
│   │   ├── steamParsers.ts
│   │   ├── epicParsers.ts
│   │   └── gogParsers.ts
│   ├── routes/
│   │   ├── games.ts         # /api/games/*
│   │   └── admin.ts         # /api/admin/*
│   └── services/
│       ├── parserService.ts # оркестрация парсеров
│       └── gameService.ts   # выборки, статистика, поиск
├── prisma.config.ts         # конфиг Prisma CLI (схема, миграции, DATABASE_URL)
├── docker-compose.yml
├── Dockerfile
├── tsconfig.json
└── package.json
```

## ⚠️ Известные ограничения и TODO

- **Цены разных площадок лежат в разных валютах.** Steam заполняет `Game.currency` по коду региона (по умолчанию RUB), Epic и GOG — USD. Валюта видна в карточках и API-ответах. Сравнивать абсолютные цены между площадками по-прежнему нельзя из-за разных валют; сравнивать можно только скидки в процентах: `topDiscounts` и `averageDiscount` остаются корректны.
- **Второй источник Steam — HTML.** Список акций из `/search/results/` разбирается через cheerio по классам вёрстки (`.search_result_row`, `.discount_block[data-price-final]`). Если Valve поменяет разметку, этот источник тихо вернёт 0 игр — витрина при этом продолжит работать. Отключается через `STEAM_SEARCH_PAGES=0`.
- **Free-to-play игры считаются бесплатными.** `isFree` выставляется по `currentPrice === 0`, поэтому в `/api/games/free` вместе с раздачами попадут и F2P-тайтлы витрины.
- **`EpicParser.parseFreeGames()` — пустая заглушка.** Метод объявлен, содержит только комментарий и всегда возвращает пустой массив, так что еженедельные раздачи Epic не собираются.
- **Epic-парсер разбирает ответ не по той форме.** GraphQL-запрос просит `searchStore { elements { ... } }`, а код в `src/parsers/epicParsers.ts` итерирует сам `searchStore`; `for...of` по объекту бросает ошибку, она гасится в `catch`, и парсер отдаёт 0 игр.
- **Поиск регистрозависим на некоторых БД.** `GameService.search()` приводит запрос к нижнему регистру и использует `contains` без `mode: 'insensitive'` (Prisma не поддерживает его для SQLite). Фактическое поведение зависит от коллации БД: в SQLite сравнение по умолчанию регистрозависимо для не-ASCII, в PostgreSQL — регистрозависимо всегда.
- **N+1 в статистике.** `getStats()` в цикле по платформам делает по два `count`-запроса на каждую. На нынешних объёмах не критично, но масштабируется линейно по числу площадок.
- **Нет аутентификации.** Любой, кто дотянется до `/api/admin/*`, может запустить парсинг и прочитать статистику.
- **Нет тестов.** `npm test` — заглушка, возвращающая ненулевой код.
- **`POST /api/admin/parse` синхронный.** Ответ ждёт завершения всех сетевых запросов; для полного прогона это может быть десятки секунд.

## 📄 Лицензия

MIT
