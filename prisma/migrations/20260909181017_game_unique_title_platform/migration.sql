-- DropIndex
DROP INDEX "Game_title_key";

-- CreateIndex
CREATE UNIQUE INDEX "Game_title_platform_key" ON "Game"("title", "platform");
