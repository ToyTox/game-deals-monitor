# HTTP API

Базовый URL: `http://localhost:3000`.

## Служебное

### `GET /`

Веб-интерфейс (`public/index.html`): статистика и карточки игр. В разделах «Бесплатные игры» и «Скидки» есть фильтр по платформам (можно выбрать несколько), переключатель «Демо, DLC и kit'ы» (по умолчанию они скрыты) и сортировка; выбор хранится в `localStorage` отдельно для каждого раздела.

### `GET /admin.html`

Админка (`public/admin.html`): панель ручек для всех методов API и сырой JSON ответа. Ссылка на неё — в шапке главной страницы.

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
    "wishlist": "/api/wishlist?user=<SteamID|ссылка|ник>",
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

## Список желаемого

### `GET /api/wishlist`

Список желаемого Steam с текущими ценами и скидками. Читается **анонимно**: ни ключа Steam Web API, ни логина не нужно — достаточно, чтобы владелец не закрыл вишлист настройками приватности.

Данные берутся не из базы, а напрямую из Steam: `IWishlistService/GetWishlist` отдаёт список appid, `IStoreBrowseService/GetItems` — названия, обложки, цены и скидки пачками по 100 appid за запрос. Разобранный вишлист кэшируется в памяти процесса на 15 минут, поэтому листание страниц и переключение фильтра в сеть не ходят.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `user` | string | — | **Обязателен.** SteamID64 (`76561198006409530`), ссылка на профиль (`steamcommunity.com/profiles/<id>` или `steamcommunity.com/id/<ник>`) либо просто ник. Ник резолвится через XML профиля сообщества |
| `onlyDiscounted` | `true` \| `false` | `true` | Оставить только позиции со скидкой. Передайте `onlyDiscounted=false`, чтобы получить весь вишлист |
| `sort` | string | `discount` | Порядок выдачи, см. таблицу ниже. Неизвестное значение молча заменяется на `discount` |
| `limit` | number | `12` | Сколько записей вернуть |
| `offset` | number | `0` | Смещение для пагинации |

| `sort` | Порядок |
|---|---|
| `discount` | По убыванию скидки |
| `price_asc` | По возрастанию цены, позиции без цены в конце |
| `price_desc` | По убыванию цены, позиции без цены в конце |
| `title` | По названию (`localeCompare` с локалью `ru`, в отличие от побайтового сравнения в `/api/games`) |
| `ending` | Сначала акции, которые закончатся раньше; позиции без `saleEndDate` в конце |
| `added` | Сначала недавно добавленные в вишлист |
| `priority` | По приоритету, выставленному владельцем в Steam; позиции без приоритета в конце |

При равных значениях порядок добивается по `appId`, так что страницы при листании не пересекаются. Сортировка и пагинация делаются в памяти по уже загруженному вишлисту.

```bash
curl 'http://localhost:3000/api/wishlist?user=76561198028121353&sort=discount&limit=2'
```

```json
{
  "games": [
    {
      "appId": 1282100,
      "title": "REMNANT II®",
      "platform": "steam",
      "kind": "game",
      "imageUrl": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1282100/header.jpg",
      "gameUrl": "https://store.steampowered.com/app/1282100/REMNANT_II",
      "originalPrice": 2869,
      "currentPrice": 573,
      "currency": "RUB",
      "currentPriceRub": 573,
      "discountPercent": 80,
      "isFree": false,
      "unavailable": false,
      "saleEndDate": "2026-09-28T17:00:00.000Z",
      "addedAt": "2024-02-23T22:56:12.000Z",
      "priority": 2
    }
  ],
  "total": 197,
  "limit": 2,
  "offset": 0,
  "sort": "discount",
  "steamId": "76561198028121353",
  "wishlistTotal": 37264,
  "discountedTotal": 197,
  "unavailableTotal": 1332,
  "truncated": true
}
```

Поля ответа помимо списка:

| Поле | Описание |
|---|---|
| `total` | Число записей под фильтром (без учёта `limit`/`offset`) |
| `steamId` | SteamID64, в который разрешился `user` |
| `wishlistTotal` | Сколько позиций в вишлисте всего, **до** применения потолка и фильтра |
| `discountedTotal` | Сколько позиций со скидкой |
| `unavailableTotal` | Сколько позиций без цены |
| `truncated` | Вишлист больше потолка и был усечён |

Позиция с `unavailable: true` — это товар, которого нет в продаже в регионе, снятый с продажи или ещё не вышедший. У неё `currentPrice: null` и `currency: null`. **Это не бесплатная игра:** `isFree` ставится только при настоящей нулевой цене.

`currency` всегда берётся из региона (`STEAM_COUNTRY_CODE`) — Steam в этом ответе отдаёт цену отформатированной строкой, кода валюты в нём нет.

> **Потолок.** Разбирается не больше 2000 позиций (`MAX_WISHLIST_ITEMS` в `src/services/steamWishlistService.ts`). Встречаются вишлисты на десятки тысяч игр, а это сотни запросов к Steam и ограничение по частоте. Отсечка применяется **после** сортировки по приоритету владельца, так что отбрасывается наименее желанное, а `truncated` сообщает об этом клиенту.

Коды ошибок:

| Код | Когда | `code` в теле |
|---|---|---|
| `400` | `user` не передан или пуст | — |
| `404` | Профиль не найден либо ввод не похож ни на SteamID, ни на ссылку, ни на ник | `not_found` |
| `404` | Вишлист пуст **либо** закрыт настройками приватности | `empty_or_private` |
| `502` | Steam не ответил | `upstream` |

> Пустой и закрытый вишлист **неразличимы**: Steam в обоих случаях отвечает `{"response":{}}`. Поэтому один код на два случая и текст с оговоркой (см. [TODO.md](../TODO.md), раздел «Ограничения by design»).

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

Упавший парсер не отменяет остальные и не пропадает из ответа: площадка приходит с нулевыми счётчиками и полем `error`. Ответ по-прежнему `200`, а `message` меняется:

- все успешны — `Все парсеры успешно завершены`;
- часть упала — `Парсинг завершён с ошибками: epic, gog`;
- упали все — `Все парсеры завершились с ошибкой`.

```json
{
  "message": "Парсинг завершён с ошибками: epic",
  "results": [
    { "platform": "steam", "total": 60, "new": 0, "updated": 12, "freed": 0 },
    { "platform": "epic", "total": 0, "new": 0, "updated": 0, "freed": 0, "error": "Request failed with status code 503" }
  ]
}
```

В UI кнопка «Обновить всё» вызывает эту ручку без тела и показывает итог во всплывающем уведомлении.

Неизвестная платформа — `500` с сообщением `Парсер для платформы <name> не найден`.

### `GET /api/admin/parse-estimate`

Примерная длительность парсинга: для каждой площадки берётся `duration` последнего успешного прогона из `UpdateLog`. Площадки парсятся параллельно, поэтому `total` — самая долгая из них (`null`, если логов ещё нет). UI показывает эту оценку рядом с кнопкой «Обновить всё» и в прогрессе парсинга.

```json
{
  "total": 218000,
  "platforms": [
    { "platform": "steam", "duration": 16000, "measuredAt": "2026-09-13T16:52:01.813Z" },
    { "platform": "vkplay", "duration": 218000, "measuredAt": "2026-09-13T16:55:23.003Z" }
  ]
}
```

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

