# Разработка

## Как добавить новую платформу

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

## Структура проекта

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
├── scripts/
│   └── setup.mjs            # postinstall: .env + prisma generate + migrate deploy
├── prisma.config.ts         # конфиг Prisma CLI (схема, миграции, DATABASE_URL)
├── docker-compose.yml
├── Dockerfile
├── tsconfig.json
└── package.json
```

