-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Game" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "originalPrice" REAL,
    "currentPrice" REAL,
    "currency" TEXT,
    "discountPercent" REAL NOT NULL DEFAULT 0,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'game',
    "gameUrl" TEXT NOT NULL,
    "imageUrl" TEXT,
    "description" TEXT,
    "saleEndDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Game" ("createdAt", "currency", "currentPrice", "description", "discountPercent", "gameUrl", "id", "imageUrl", "isFree", "originalPrice", "platform", "saleEndDate", "title", "updatedAt") SELECT "createdAt", "currency", "currentPrice", "description", "discountPercent", "gameUrl", "id", "imageUrl", "isFree", "originalPrice", "platform", "saleEndDate", "title", "updatedAt" FROM "Game";
DROP TABLE "Game";
ALTER TABLE "new_Game" RENAME TO "Game";
CREATE INDEX "Game_platform_idx" ON "Game"("platform");
CREATE INDEX "Game_discountPercent_idx" ON "Game"("discountPercent");
CREATE INDEX "Game_isFree_idx" ON "Game"("isFree");
CREATE INDEX "Game_kind_idx" ON "Game"("kind");
CREATE INDEX "Game_createdAt_idx" ON "Game"("createdAt");
CREATE UNIQUE INDEX "Game_title_platform_key" ON "Game"("title", "platform");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Разметка уже сохранённых записей. Источник истины — detectGameKind в
-- src/parsers/helpers.ts; регулярок в SQLite нет, поэтому здесь приближение
-- через LIKE по отдельным словам (название обрамлено пробелами). LIKE сворачивает
-- регистр только для ASCII, отсюда варианты написания кириллицы. Неточности
-- исправит следующий прогон парсера: saveGames пересчитывает kind при обновлении.
-- Порядок как в detectGameKind: demo, dlc, kit.
UPDATE "Game" SET "kind" = 'demo'
WHERE "kind" = 'game' AND (
  ' ' || "title" || ' ' LIKE '% demo %'
  OR ' ' || "title" || ' ' LIKE '% демо %'
  OR ' ' || "title" || ' ' LIKE '% Демо %'
  OR ' ' || "title" || ' ' LIKE '% ДЕМО %'
  OR "title" LIKE '%демоверсия%'
  OR "title" LIKE '%Демоверсия%'
);

UPDATE "Game" SET "kind" = 'dlc'
WHERE "kind" = 'game' AND (
  ' ' || "title" || ' ' LIKE '% dlc %'
  OR ' ' || "title" || ' ' LIKE '% season pass %'
  OR ' ' || "title" || ' ' LIKE '% expansion %'
  OR ' ' || "title" || ' ' LIKE '% дополнение %'
  OR ' ' || "title" || ' ' LIKE '% Дополнение %'
  OR "title" LIKE '%сезонный абонемент%'
  OR "title" LIKE '%Сезонный абонемент%'
);

UPDATE "Game" SET "kind" = 'kit'
WHERE "kind" = 'game' AND ' ' || "title" || ' ' LIKE '%kit %';
