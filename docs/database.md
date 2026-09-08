# Схема БД

`prisma/schema.prisma`, три модели. `datasource db` объявляет только `provider = "sqlite"` — url приходит извне (см. [Конфигурация Prisma 7](getting-started.md#конфигурация-prisma-7)).

## `Game`

| Поле | Тип | Примечание |
|---|---|---|
| `id` | `Int` | PK, автоинкремент |
| `title` | `String` | Название игры; вместе с `platform` — ключ, по которому игры матчатся между запусками |
| `platform` | `String` | `steam` / `epic` / `gog` / `vkplay` |
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

Уникальность теперь составная: `@@unique([title, platform])` вместо глобально уникального `title`. Одна и та же игра может присутствовать на нескольких площадках под одним названием.

Индексы: `platform`, `discountPercent`, `isFree`, `createdAt`.

## `PriceHistory`

| Поле | Тип |
|---|---|
| `id` | `Int` (PK) |
| `gameId` | `Int` → `Game.id`, `onDelete: Cascade` |
| `oldPrice` / `newPrice` | `Float?` |
| `oldDiscount` / `newDiscount` | `Float` (по умолчанию `0`) |
| `createdAt` | `DateTime` |

Индексы: `gameId`, `createdAt`.

**Запись создаётся не на каждом проходе парсера.** В `src/parsers/BaseParsers.ts` новая строка в `PriceHistory` появляется только если у уже существующей игры изменились `currentPrice` **или** `discountPercent`. Если цена не двигалась, история не растёт.

## `UpdateLog`

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

