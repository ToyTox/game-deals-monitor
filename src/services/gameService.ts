import prisma from '../database.js';
import type { Prisma } from '../generated/prisma/client.js';
import { GAME_KINDS, GameKind, StatsResponse } from '../types.js';

/**
 * Допустимые сортировки списка игр. Последним ключом везде идёт id: без него
 * записи с одинаковым значением (скидка 50%, одна дата) меняются местами между
 * запросами, и при листании страниц карточки дублируются или пропадают.
 *
 * Цены у магазинов в разных валютах, поэтому по цене сортируем рублёвый эквивалент.
 */
export const GAME_SORTS = {
  discount: [{ discountPercent: 'desc' }, { id: 'asc' }],
  price_asc: [{ currentPriceRub: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  price_desc: [{ currentPriceRub: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  title: [{ game: { title: 'asc' } }, { id: 'asc' }],
  ending: [{ saleEndDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
} satisfies Record<string, Prisma.OfferOrderByWithRelationInput[]>;

export type GameSort = keyof typeof GAME_SORTS;

export const DEFAULT_GAME_SORT: GameSort = 'discount';

function isGameSort(value: unknown): value is GameSort {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GAME_SORTS, value);
}

type OfferWithGame = Prisma.OfferGetPayload<{ include: { game: true } }> & {
  priceHistory?: Prisma.PriceHistoryGetPayload<object>[];
};

/**
 * Элемент списка в API — оффер магазина с полями канонической игры, в том же
 * плоском виде, что и до разделения на Game и Offer. platform — id магазина.
 */
function toListItem({ game, storeId, ...offer }: OfferWithGame) {
  return {
    ...offer,
    platform: storeId,
    slug: game.slug,
    title: game.title,
    kind: game.kind,
    imageUrl: game.imageUrl,
    description: game.description,
  };
}

export class GameService {
  async getGames(filter?: {
    platform?: string | string[];
    minDiscount?: number;
    freeOnly?: boolean;
    excludeFree?: boolean;
    /** Типы из GAME_KINDS; неизвестные отбрасываются, пустой список фильтр не включает */
    kinds?: string[];
    /** Ключ из GAME_SORTS; неизвестное значение молча заменяется сортировкой по скидке */
    sort?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Prisma.OfferWhereInput = {};

    if (Array.isArray(filter?.platform)) {
      if (filter.platform.length === 1) {
        where.storeId = filter.platform[0];
      } else if (filter.platform.length > 1) {
        where.storeId = { in: filter.platform };
      }
    } else if (filter?.platform) {
      where.storeId = filter.platform;
    }

    if (filter?.minDiscount && filter.minDiscount > 0) {
      where.discountPercent = { gte: filter.minDiscount };
    }

    if (filter?.freeOnly) {
      where.isFree = true;
    } else if (filter?.excludeFree) {
      where.isFree = false;
    }

    const kinds = (filter?.kinds ?? []).filter((k): k is GameKind =>
      (GAME_KINDS as readonly string[]).includes(k)
    );
    if (kinds.length > 0) {
      where.game = { kind: { in: kinds } };
    }

    const sort = isGameSort(filter?.sort) ? filter.sort : DEFAULT_GAME_SORT;

    const offers = await prisma.offer.findMany({
      where,
      orderBy: GAME_SORTS[sort],
      take: filter?.limit || 100,
      skip: filter?.offset || 0,
      include: {
        game: true,
        priceHistory: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const total = await prisma.offer.count({ where });

    return {
      games: offers.map(toListItem),
      total,
      limit: filter?.limit || 100,
      offset: filter?.offset || 0,
    };
  }

  async getFreeGames(limit: number = 50) {
    const offers = await prisma.offer.findMany({
      where: { isFree: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { game: true },
    });
    return offers.map(toListItem);
  }

  async getTopDiscounts(limit: number = 20) {
    const offers = await prisma.offer.findMany({
      where: { discountPercent: { gt: 0 } },
      orderBy: { discountPercent: 'desc' },
      take: limit,
      include: { game: true },
    });
    return offers.map(toListItem);
  }

  async getByPlatform(platform: string, limit: number = 50) {
    const offers = await prisma.offer.findMany({
      where: { storeId: platform },
      orderBy: { discountPercent: 'desc' },
      take: limit,
      include: { game: true },
    });
    return offers.map(toListItem);
  }

  async getByTitle(title: string) {
    // Одна игра может продаваться в нескольких магазинах, поэтому берём
    // первый подходящий оффер независимо от магазина.
    const offer = await prisma.offer.findFirst({
      where: { game: { title } },
      include: {
        game: true,
        priceHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return offer ? toListItem(offer) : null;
  }

  async getStats(): Promise<StatsResponse> {
    const totalGames = await prisma.offer.count();
    const freeGames = await prisma.offer.count({ where: { isFree: true } });
    const discountedGames = await prisma.offer.count({
      where: { discountPercent: { gt: 0 } },
    });

    const discounted = await prisma.offer.findMany({
      select: { discountPercent: true },
      where: { discountPercent: { gt: 0 } },
    });

    const averageDiscount =
      discounted.length > 0
        ? discounted.reduce((acc, o) => acc + o.discountPercent, 0) / discounted.length
        : 0;

    const stores = await prisma.offer.groupBy({
      by: ['storeId'],
      _count: true,
    });

    const byStore: StatsResponse['byStore'] = {};

    for (const store of stores) {
      const free = await prisma.offer.count({
        where: {
          storeId: store.storeId,
          isFree: true,
        },
      });

      const discountedCount = await prisma.offer.count({
        where: {
          storeId: store.storeId,
          discountPercent: { gt: 0 },
        },
      });

      byStore[store.storeId] = {
        total: store._count,
        free,
        discounted: discountedCount,
      };
    }

    const topDiscounts = await prisma.offer.findMany({
      select: {
        storeId: true,
        discountPercent: true,
        game: { select: { title: true, slug: true } },
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
      byStore,
      topDiscounts: topDiscounts.map((o) => ({
        title: o.game.title,
        slug: o.game.slug,
        storeId: o.storeId,
        discount: o.discountPercent,
      })),
      lastUpdate: lastUpdate?.createdAt || null,
    };
  }

  async getPriceHistory(gameTitle: string) {
    const offer = await prisma.offer.findFirst({
      where: { game: { title: gameTitle } },
    });

    if (!offer) {
      throw new Error(`Игра "${gameTitle}" не найдена`);
    }

    const history = await prisma.priceHistory.findMany({
      where: { offerId: offer.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return { currency: offer.currency, history };
  }

  async getUpdateLogs(limit: number = 50) {
    return prisma.updateLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Примерная длительность парсинга по последнему успешному прогону каждой площадки.
   * Площадки парсятся параллельно, поэтому общее ожидание — самая долгая из них.
   */
  async getParseEstimate(platforms: string[]) {
    const logs = await Promise.all(
      platforms.map((platform) =>
        prisma.updateLog.findFirst({
          where: { platform, status: 'success' },
          orderBy: { createdAt: 'desc' },
          select: { platform: true, duration: true, createdAt: true },
        })
      )
    );

    const known = logs
      .filter((log): log is NonNullable<typeof log> => log !== null)
      .map((log) => ({ platform: log.platform, duration: log.duration, measuredAt: log.createdAt }));

    return {
      total: known.length > 0 ? Math.max(...known.map((p) => p.duration)) : null,
      platforms: known,
    };
  }

  async search(query: string) {
    const lowerQuery = query.toLowerCase();

    // Встроенный в SQLite LIKE сворачивает регистр только для ASCII, поэтому
    // кириллицу фильтруем в JS — иначе «ВЕДЬМАК» не находит «Ведьмак».
    const offers = await prisma.offer.findMany({
      orderBy: { discountPercent: 'desc' },
      include: { game: true },
    });

    return offers
      .filter((offer) => offer.game.title.toLowerCase().includes(lowerQuery))
      .slice(0, 20)
      .map(toListItem);
  }
}

export default new GameService();
