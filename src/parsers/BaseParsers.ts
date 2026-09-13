import { ParsedGame, Platform, UpdateResult } from '../types.js';
import prisma from '../database.js';
import { detectGameKind } from './helpers.js';

export abstract class BaseParser {
  protected platform: Platform;
  protected name: string;

  constructor(platform: Platform, name: string) {
    this.platform = platform;
    this.name = name;
  }

  abstract parse(): Promise<ParsedGame[]>;

  async saveGames(games: ParsedGame[]): Promise<UpdateResult> {
    const startTime = Date.now();
    let newCount = 0;
    let updatedCount = 0;
    let freedCount = 0;

    try {
      for (const game of games) {
        const existing = await prisma.game.findUnique({
          where: { title_platform: { title: game.title, platform: this.platform } },
        });

        if (!existing) {
          await prisma.game.create({
            data: {
              title: game.title,
              platform: this.platform,
              originalPrice: game.originalPrice,
              currentPrice: game.currentPrice,
              currency: game.currency,
              discountPercent: game.discountPercent,
              isFree: game.isFree,
              kind: detectGameKind(game.title),
              gameUrl: game.gameUrl,
              imageUrl: game.imageUrl,
              description: game.description,
              saleEndDate: game.saleEndDate,
            },
          });
          newCount++;

          if (game.isFree) {
            freedCount++;
          }
        } else {
          const oldPrice = existing.currentPrice;
          const oldDiscount = existing.discountPercent;

          if (oldPrice !== game.currentPrice || oldDiscount !== game.discountPercent) {
            await prisma.priceHistory.create({
              data: {
                gameId: existing.id,
                oldPrice: oldPrice,
                newPrice: game.currentPrice,
                oldDiscount: oldDiscount,
                newDiscount: game.discountPercent,
              },
            });
          }

          await prisma.game.update({
            where: { id: existing.id },
            data: {
              originalPrice: game.originalPrice,
              currentPrice: game.currentPrice,
              currency: game.currency,
              discountPercent: game.discountPercent,
              isFree: game.isFree,
              // Пересчитываем и у старых записей: так до них доезжают поправки в правилах
              kind: detectGameKind(game.title),
              gameUrl: game.gameUrl,
              imageUrl: game.imageUrl,
              description: game.description,
              saleEndDate: game.saleEndDate,
            },
          });
          updatedCount++;

          if (game.isFree && !existing.isFree) {
            freedCount++;
          }
        }
      }

      const duration = Date.now() - startTime;

      await prisma.updateLog.create({
        data: {
          platform: this.platform,
          gamesCount: games.length,
          newGames: newCount,
          updatedGames: updatedCount,
          freedGames: freedCount,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: duration,
          status: 'success',
        },
      });

      console.log(
        `✅ ${this.name}: ${games.length} игр (новых: ${newCount}, обновлено: ${updatedCount}, в бесплатные: ${freedCount}) за ${duration}ms`
      );

      return {
        platform: this.platform,
        total: games.length,
        new: newCount,
        updated: updatedCount,
        freed: freedCount,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await prisma.updateLog.create({
        data: {
          platform: this.platform,
          gamesCount: 0,
          newGames: 0,
          updatedGames: 0,
          freedGames: 0,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: duration,
          status: 'error',
          error: errorMessage,
        },
      });

      console.error(`❌ ${this.name} ошибка:`, error);
      throw error;
    }
  }

  async run(): Promise<UpdateResult> {
    console.log(`🔄 Запуск ${this.name}...`);
    const games = await this.parse();
    return this.saveGames(games);
  }
}
