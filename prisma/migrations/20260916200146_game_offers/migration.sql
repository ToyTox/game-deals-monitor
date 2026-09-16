-- Переезд на канонические игры и офферы магазинов.
--
-- Старые строки Game (одна на пару title+platform) и их PriceHistory НЕ переносятся:
-- каноническую игру ищут по normalizeTitle() из src/lib/titleNormalizer.ts, а
-- повторить её на SQL нельзя. Каталог целиком восстанавливается следующим
-- прогоном парсеров; теряется только накопленная история цен.
-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" INTEGER NOT NULL,
    "storeId" TEXT NOT NULL,
    "originalPrice" REAL,
    "currentPrice" REAL,
    "currency" TEXT,
    "originalPriceRub" REAL,
    "currentPriceRub" REAL,
    "discountPercent" REAL NOT NULL DEFAULT 0,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "gameUrl" TEXT NOT NULL,
    "saleEndDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Offer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Offer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "rate" REAL NOT NULL,
    "fetchedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Game" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'game',
    "imageUrl" TEXT,
    "description" TEXT,
    "itadId" TEXT,
    "offersRefreshedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
DROP TABLE "Game";
ALTER TABLE "new_Game" RENAME TO "Game";
CREATE UNIQUE INDEX "Game_slug_key" ON "Game"("slug");
CREATE UNIQUE INDEX "Game_normalizedTitle_key" ON "Game"("normalizedTitle");
CREATE UNIQUE INDEX "Game_itadId_key" ON "Game"("itadId");
CREATE INDEX "Game_kind_idx" ON "Game"("kind");
CREATE INDEX "Game_createdAt_idx" ON "Game"("createdAt");
CREATE TABLE "new_PriceHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offerId" INTEGER NOT NULL,
    "oldPrice" REAL,
    "newPrice" REAL,
    "oldDiscount" REAL NOT NULL DEFAULT 0,
    "newDiscount" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceHistory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
DROP TABLE "PriceHistory";
ALTER TABLE "new_PriceHistory" RENAME TO "PriceHistory";
CREATE INDEX "PriceHistory_offerId_idx" ON "PriceHistory"("offerId");
CREATE INDEX "PriceHistory_createdAt_idx" ON "PriceHistory"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Offer_gameId_idx" ON "Offer"("gameId");

-- CreateIndex
CREATE INDEX "Offer_storeId_idx" ON "Offer"("storeId");

-- CreateIndex
CREATE INDEX "Offer_currentPriceRub_idx" ON "Offer"("currentPriceRub");

-- CreateIndex
CREATE INDEX "Offer_discountPercent_idx" ON "Offer"("discountPercent");

-- CreateIndex
CREATE INDEX "Offer_isFree_idx" ON "Offer"("isFree");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_gameId_storeId_key" ON "Offer"("gameId", "storeId");
