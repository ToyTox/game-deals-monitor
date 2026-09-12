# 🎮 Game Deals Monitor API

REST API для мониторинга скидок и бесплатных игр на игровых площадках: **Steam**, **Epic Games Store**, **GOG** и **VK Play**.

Сервис по расписанию обходит площадки, складывает игры в БД, ведёт историю изменения цен и отдаёт всё это через HTTP: фильтры по платформе и размеру скидки, топ скидок, бесплатные игры, поиск по названию и статистика. В комплекте — простой веб-интерфейс на `/`.

## Стек

Node.js 20 (ESM) · TypeScript 5 · Express 4 · Prisma 7 + SQLite (driver adapter `better-sqlite3`) · node-cron · axios · cheerio

## Запуск

```bash
git clone https://github.com/ToyTox/game-deals-monitor.git
cd game-deals-monitor

npm install   # postinstall сам создаст .env, сгенерирует Prisma-клиент и накатит миграции
npm run dev
```

Сервер поднимется на `http://localhost:3000` — там веб-интерфейс, карта эндпоинтов на `/api`.

> Парсеры стартуют вместе с сервером, но в фоне: API отвечает сразу, игры подтягиваются по мере обхода площадок. Отключить разовый прогон — `RUN_ON_STARTUP=false npm run dev`.

Альтернатива — `docker compose up -d` ([что нужно доделать для PostgreSQL](docs/docker.md)).

## Документация

Подробности — в [`docs/`](docs/):

| Раздел | О чём |
|---|---|
| [Установка и запуск](docs/getting-started.md) | Требования, быстрый старт, переменные окружения, конфигурация Prisma 7, npm-скрипты |
| [HTTP API](docs/api.md) | Все эндпоинты, параметры, примеры запросов и ответов |
| [Схема БД](docs/database.md) | Модели `Game`, `PriceHistory`, `UpdateLog` |
| [Парсинг и расписание](docs/parsing.md) | Как устроен обход площадок, источники данных, cron |
| [Docker](docs/docker.md) | Состав сервисов, переезд на PostgreSQL |
| [Разработка](docs/development.md) | Как добавить новую площадку, структура проекта |

Известные проблемы и планы — [TODO.md](TODO.md).

## Лицензия

MIT
