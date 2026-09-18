import { KNOWN_STORES, ParsedGame, StoreId, UpdateResult } from '../types.js';
import prisma from '../database.js';
import currencyService from '../services/currencyService.js';
import { normalizeTitle, slugify } from '../lib/titleNormalizer.js';
import { detectGameKind } from './helpers.js';

export abstract class BaseParser {
  protected storeId: StoreId;
  protected name: string;

  constructor(storeId: StoreId, name: string) {
    this.storeId = storeId;
    this.name = name;
  }

  abstract parse(): Promise<ParsedGame[]>;

  /**
   * @param startedAt начало прогона. run() передаёт момент до parse(), чтобы
   * duration в UpdateLog включал сетевую часть, а не только запись в базу:
   * по нему UI оценивает, сколько ждать парсинга.
   */
  async saveGames(games: ParsedGame[], startedAt: number = Date.now()): Promise<UpdateResult> {
    const startTime = startedAt;
    let newCount = 0;
    let updatedCount = 0;
    let freedCount = 0;

    try {
      await this.ensureStore();

      for (const game of games) {
        const gameId = await this.upsertGame(game);

        const originalPriceRub = await currencyService.toRub(game.originalPrice, game.currency);
        const currentPriceRub = await currencyService.toRub(game.currentPrice, game.currency);

        const offerData = {
          originalPrice: game.originalPrice,
          currentPrice: game.currentPrice,
          currency: game.currency,
          originalPriceRub,
          currentPriceRub,
          discountPercent: game.discountPercent,
          isFree: game.isFree,
          gameUrl: game.gameUrl,
          saleEndDate: game.saleEndDate,
        };

        const existing = await prisma.offer.findUnique({
          where: { gameId_storeId: { gameId, storeId: this.storeId } },
        });

        if (!existing) {
          await prisma.offer.create({
            data: { gameId, storeId: this.storeId, ...offerData },
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
                offerId: existing.id,
                oldPrice: oldPrice,
                newPrice: game.currentPrice,
                oldDiscount: oldDiscount,
                newDiscount: game.discountPercent,
              },
            });
          }

          await prisma.offer.update({
            where: { id: existing.id },
            data: offerData,
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
          platform: this.storeId,
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
        storeId: this.storeId,
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
          platform: this.storeId,
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
    const startedAt = Date.now();
    const games = await this.parse();
    return this.saveGames(games, startedAt);
  }

  /** Offer ссылается на Store внешним ключом, поэтому магазин заводим до первой записи. */
  private async ensureStore(): Promise<void> {
    const known = KNOWN_STORES.find((s) => s.id === this.storeId);

    await prisma.store.upsert({
      where: { id: this.storeId },
      create: { id: this.storeId, name: known?.name ?? this.name, kind: known?.kind ?? 'official' },
      update: {},
    });
  }

  /**
   * Каноническая игра по нормализованному названию: одна на все магазины.
   * Название, картинку и описание задаёт первый магазин, остальные только
   * заполняют пустые поля. kind пересчитывается при каждом прогоне — так до
   * старых записей доезжают поправки в правилах detectGameKind.
   */
  private async upsertGame(game: ParsedGame): Promise<number> {
    const normalizedTitle = normalizeTitle(game.title);
    const kind = detectGameKind(game.title);

    const existing = await prisma.game.findUnique({ where: { normalizedTitle } });

    if (existing) {
      await prisma.game.update({
        where: { id: existing.id },
        data: {
          kind,
          imageUrl: existing.imageUrl ?? game.imageUrl,
          description: existing.description ?? game.description,
        },
      });
      return existing.id;
    }

    const created = await prisma.game.create({
      data: {
        slug: await this.uniqueSlug(game.title),
        title: game.title,
        normalizedTitle,
        kind,
        imageUrl: game.imageUrl,
        description: game.description,
      },
    });
    return created.id;
  }

  /**
   * slugify теряет часть различий (пунктуацию, транслитерация сводит «е» и «ё»),
   * поэтому разные нормализованные названия могут дать один слаг — добавляем суффикс.
   */
  private async uniqueSlug(title: string): Promise<string> {
    const base = slugify(title);
    let slug = base;

    for (let n = 2; await prisma.game.findUnique({ where: { slug }, select: { id: true } }); n++) {
      slug = `${base}-${n}`;
    }

    return slug;
  }
}
