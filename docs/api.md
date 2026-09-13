# HTTP API

Базовый URL: `http://localhost:3000`.

## Служебное

### `GET /`

Веб-интерфейс (`public/index.html`): статистика, панель ручек для всех методов API и карточки игр. В разделах «Бесплатные игры» и «Скидки» есть фильтр по платформам (можно выбрать несколько), переключатель «Демо, DLC и kit'ы» (по умолчанию они скрыты) и сортировка; выбор хранится в `localStorage` отдельно для каждого раздела.

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

## Игры

### `GET /api/games`

Список игр с фильтрами и сортировкой. К каждой игре подмешиваются **последние 5 записей** истории цен.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `platform` | string | — | Одна или несколько платформ: `steam`, `epic`, `gog`, `vkplay`. Список через запятую (`platform=steam,gog`) или повторённый параметр (`platform=steam&platform=gog`), регистр не важен |
| `minDiscount` | number | — | Минимальная скидка в процентах (учитывается только если > 0) |
| `free` | `true` \| `false` | — | `free=true` — только бесплатные, `free=false` — только платные |
| `kind` | string | — | Один или несколько типов товара: `game`, `demo`, `dlc`, `kit`. Формат списка как у `platform`; неизвестные значения отбрасываются. Без параметра отдаются все типы. Раздел UI шлёт `kind=game`, пока переключатель выключен |
| `sort` | string | `discount` | Порядок выдачи, см. таблицу ниже. Неизвестное значение молча заменяется на `discount` |
| `limit` | number | `100` | Сколько записей вернуть |
| `offset` | number | `0` | Смещение для пагинации |

| `sort` | Порядок |
|---|---|
| `discount` | По убыванию скидки |
| `price_asc` | По возрастанию текущей цены, игры без цены в конце |
| `price_desc` | По убыванию текущей цены, игры без цены в конце |
| `newest` | Сначала недавно добавленные в базу |
| `title` | По названию (SQLite сравнивает побайтово: латиница раньше кириллицы) |
| `ending` | Сначала акции, которые закончатся раньше; игры без `saleEndDate` в конце |

При равных значениях порядок добивается по `id`, так что страницы при листании не пересекаются.

> Сортировка по цене сравнивает числа без учёта валюты. Epic отдаёт цены в USD, остальные площадки в рублях, поэтому при смешанном списке площадок порядок по цене некорректен (см. [TODO.md](../TODO.md), раздел «Ограничения by design»).

```bash
curl 'http://localhost:3000/api/games?platform=steam,gog&minDiscount=50&sort=price_asc&limit=2'
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

### `GET /api/games/free`

Только бесплатные игры, сортировка — по дате добавления (сначала новые).

| Параметр | По умолчанию |
|---|---|
| `limit` | `50` |

```json
{ "games": [ /* ... */ ], "total": 4 }
```

Здесь и далее в списочных ответах `total` — длина возвращённого массива.

### `GET /api/games/top-discounts`

Игры со скидкой > 0, отсортированные по убыванию скидки.

| Параметр | По умолчанию |
|---|---|
| `limit` | `20` |

### `GET /api/games/platform/:name`

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

### `GET /api/games/search?q=<строка>`

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

### `GET /api/games/:title`

Одна игра по точному названию + **вся** история цен (новые записи первыми). Название нужно URL-кодировать.

```bash
curl 'http://localhost:3000/api/games/Cyberpunk%202077'
```

Если игры нет — `404`:

```json
{ "error": "Игра не найдена" }
```

### `GET /api/games/:title/price-history`

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

## Админка

> 🔓 Раздел `/api/admin/*` **ничем не защищён** — аутентификации и авторизации в коде нет. Не выставляйте его в публичный интернет как есть.

### `GET /api/admin/stats`

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

### `GET /api/admin/updates`

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

### `POST /api/admin/parse`

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

### `GET /api/admin/platforms`

Список платформ, для которых зарегистрированы парсеры (имена берутся из имён классов).

```json
{ "platforms": ["steam", "epic", "gog", "vkplay"], "total": 4 }
```

### `GET /api/admin/health`

```json
{ "status": "ok", "timestamp": "2026-09-07T21:08:25.359Z", "uptime": 5.08 }
```

`uptime` — аптайм процесса Node в секундах.

