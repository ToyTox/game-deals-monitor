# Docker

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

Сборка образа ничего не спрашивает и не требует живой БД: `npm ci` через `postinstall` генерирует Prisma-клиент, а миграции применяются уже при старте контейнера — `CMD npm start` разворачивается в `prisma migrate deploy && node dist/index.js`. На этапе `docker build` шаг с миграциями отключён через `ENV SKIP_DB_MIGRATE=1`.

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

