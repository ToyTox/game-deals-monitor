-- CreateTable
CREATE TABLE "Game" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "originalPrice" REAL,
    "currentPrice" REAL,
    "discountPercent" REAL NOT NULL DEFAULT 0,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "gameUrl" TEXT NOT NULL,
    "imageUrl" TEXT,
    "description" TEXT,
    "saleEndDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" INTEGER NOT NULL,
    "oldPrice" REAL,
    "newPrice" REAL,
    "oldDiscount" REAL NOT NULL DEFAULT 0,
    "newDiscount" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceHistory_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UpdateLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "platform" TEXT NOT NULL,
    "gamesCount" INTEGER NOT NULL,
    "newGames" INTEGER NOT NULL,
    "updatedGames" INTEGER NOT NULL,
    "freedGames" INTEGER NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "duration" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Game_title_key" ON "Game"("title");

-- CreateIndex
CREATE INDEX "Game_platform_idx" ON "Game"("platform");

-- CreateIndex
CREATE INDEX "Game_discountPercent_idx" ON "Game"("discountPercent");

-- CreateIndex
CREATE INDEX "Game_isFree_idx" ON "Game"("isFree");

-- CreateIndex
CREATE INDEX "Game_createdAt_idx" ON "Game"("createdAt");

-- CreateIndex
CREATE INDEX "PriceHistory_gameId_idx" ON "PriceHistory"("gameId");

-- CreateIndex
CREATE INDEX "PriceHistory_createdAt_idx" ON "PriceHistory"("createdAt");

-- CreateIndex
CREATE INDEX "UpdateLog_platform_idx" ON "UpdateLog"("platform");

-- CreateIndex
CREATE INDEX "UpdateLog_createdAt_idx" ON "UpdateLog"("createdAt");
