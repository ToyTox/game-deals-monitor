import prisma from '../database.js';
import { StatsResponse } from '../types.js';

export class GameService {
  async getGames(filter?: {
    platform?: string;
    minDiscount?: number;
    freeOnly?: boolean;
    excludeFree?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (filter?.platform) {
      where.platform = filter.platform;
    }

    if (filter?.minDiscount && filter.minDiscount > 0) {
      where.discountPercent = { gte: filter.minDiscount };
    }

    if (filter?.freeOnly) {
      where.isFree = true;
    } else if (filter?.excludeFree) {
      where.isFree = false;
    }

    const games = await prisma.game.findMany({
      where,
      orderBy: { discountPercent: 'desc' },
      take: filter?.limit || 100,
      skip: filter?.offset || 0,
      include: {
        priceHistory: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const total = await prisma.game.count({ where });

    return {
      games,
      total,
      limit: filter?.limit || 100,
      offset: filter?.offset || 0,
    };
  }

  async getFreeGames(limit: number = 50) {
    return prisma.game.findMany({
      where: { isFree: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getTopDiscounts(limit: number = 20) {
    return prisma.game.findMany({
      where: { discountPercent: { gt: 0 } },
      orderBy: { discountPercent: 'desc' },
      take: limit,
    });
  }

  async getByPlatform(platform: string, limit: number = 50) {
    return prisma.game.findMany({
      where: { platform },
      orderBy: { discountPercent: 'desc' },
      take: limit,
    });
  }

  async getByTitle(title: string) {
    // Название больше не уникально глобально (ключ — пара title+platform),
    // поэтому берём первую подходящую запись независимо от площадки.
    return prisma.game.findFirst({
      where: { title },
      include: {
        priceHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async getStats(): Promise<StatsResponse> {
    const totalGames = await prisma.game.count();
    const freeGames = await prisma.game.count({ where: { isFree: true } });
    const discountedGames = await prisma.game.count({
      where: { discountPercent: { gt: 0 } },
    });

    const games = await prisma.game.findMany({
      select: { discountPercent: true },
      where: { discountPercent: { gt: 0 } },
    });

    const averageDiscount =
      games.length > 0
        ? games.reduce((acc, g) => acc + g.discountPercent, 0) / games.length
        : 0;

    const platforms = await prisma.game.groupBy({
      by: ['platform'],
      _count: true,
    });

    const byPlatform: any = {};

    for (const platform of platforms) {
      const free = await prisma.game.count({
        where: {
          platform: platform.platform,
          isFree: true,
        },
      });

      const discounted = await prisma.game.count({
        where: {
          platform: platform.platform,
          discountPercent: { gt: 0 },
        },
      });

      byPlatform[platform.platform] = {
        total: platform._count,
        free,
        discounted,
      };
    }

    const topDiscounts = await prisma.game.findMany({
      select: {
        title: true,
        platform: true,
        discountPercent: true,
      },
      where: { discountPercent: { gt: 0 } },
      orderBy: { discountPercent: 'desc' },
      take: 10,
    });

    const lastUpdate = await prisma.updateLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return {
      totalGames,
      freeGames,
      discountedGames,
      averageDiscount: Math.round(averageDiscount * 100) / 100,
      byPlatform,
      topDiscounts: topDiscounts.map((g) => ({
        title: g.title,
        platform: g.platform,
        discount: g.discountPercent,
      })),
      lastUpdate: lastUpdate?.createdAt || null,
    };
  }

  async getPriceHistory(gameTitle: string) {
    const game = await prisma.game.findFirst({
      where: { title: gameTitle },
    });

    if (!game) {
      throw new Error(`Игра "${gameTitle}" не найдена`);
    }

    const history = await prisma.priceHistory.findMany({
      where: { gameId: game.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return { currency: game.currency, history };
  }

  async getUpdateLogs(limit: number = 50) {
    return prisma.updateLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async search(query: string) {
    const lowerQuery = query.toLowerCase();

    return prisma.game.findMany({
      where: {
        title: {
          contains: lowerQuery,
        },
      },
      orderBy: { discountPercent: 'desc' },
      take: 20,
    });
  }
}

export default new GameService();
