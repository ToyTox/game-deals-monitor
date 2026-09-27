import prisma from '../database.js';
import type { Prisma } from '../generated/prisma/client.js';
import { GAME_KINDS, GameDetail, GameKind, StatsResponse, StoreKind } from '../types.js';

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

type OfferWithGame = Prisma.OfferGetPayload<{ include: { game: { include: { tags: true } } } }> & {
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
    tags: game.tags.map((tag) => ({ slug: tag.slug, name: tag.name })),
  };
}

/** Сколько последних записей истории цен подмешивать в карточку списка */
const LIST_PRICE_HISTORY_DEPTH = 5;

/**
 * Сколько офферов запрашивать историей за раз. SQLite принимает не больше 999
 * параметров в запросе (SQLITE_MAX_VARIABLE_NUMBER), а связь с take Prisma
 * грузит одним запросом `WHERE offerId IN (?, …)` и, в отличие от связей без
 * take, на чанки не разбивает. Поэтому страница от 998 записей падала с
 * «The query parameter limit supported by your database is exceeded»: 997 id
 * плюс два служебных параметра — ровно предел.
 */
const PRICE_HISTORY_CHUNK = 500;

/**
 * Последние записи истории цен по каждому офферу, id → история.
 * Отдельный запрос чанками вместо вложенного include: так размер страницы
 * списка ничем не ограничен, см. PRICE_HISTORY_CHUNK.
 */
async function loadPriceHistory(offerIds: number[]) {
  const byOffer = new Map<number, Prisma.PriceHistoryGetPayload<object>[]>();

  for (let from = 0; from < offerIds.length; from += PRICE_HISTORY_CHUNK) {
    const chunk = offerIds.slice(from, from + PRICE_HISTORY_CHUNK);
    const rows = await prisma.offer.findMany({
      where: { id: { in: chunk } },
      select: {
        id: true,
        priceHistory: {
          take: LIST_PRICE_HISTORY_DEPTH,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    for (const row of rows) {
      byOffer.set(row.id, row.priceHistory);
    }
  }

  return byOffer;
}

type GameWithOffers = Prisma.GameGetPayload<{
  include: {
    tags: true;
    offers: { include: { store: true; priceHistory: true } };
  };
}>;

/**
 * Игра со всеми предложениями магазинов — ответ страницы одной игры.
 * Порядок офферов задаёт запрос, здесь его не меняем.
 */
function toGameDetail(game: GameWithOffers): GameDetail {
  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    kind: game.kind,
    imageUrl: game.imageUrl,
    description: game.description,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    tags: game.tags.map((tag) => ({ slug: tag.slug, name: tag.name })),
    offers: game.offers.map(({ store, gameId, storeId, priceHistory, ...offer }) => ({
      ...offer,
      platform: storeId,
      storeId,
      storeName: store.name,
      storeKind: store.kind as StoreKind,
      priceHistory,
    })),
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
      include: { game: { include: { tags: true } } },
    });

    const total = await prisma.offer.count({ where });
    const priceHistory = await loadPriceHistory(offers.map((offer) => offer.id));

    return {
      games: offers.map((offer) =>
        toListItem({ ...offer, priceHistory: priceHistory.get(offer.id) ?? [] })
      ),
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
      include: { game: { include: { tags: true } } },
    });
    return offers.map(toListItem);
  }

  async getTopDiscounts(limit: number = 20) {
    const offers = await prisma.offer.findMany({
      where: { discountPercent: { gt: 0 } },
      orderBy: { discountPercent: 'desc' },
      take: limit,
      include: { game: { include: { tags: true } } },
    });
    return offers.map(toListItem);
  }

  async getByPlatform(platform: string, limit: number = 50) {
    const offers = await prisma.offer.findMany({
      where: { storeId: platform },
      orderBy: { discountPercent: 'desc' },
      take: limit,
      include: { game: { include: { tags: true } } },
    });
    return offers.map(toListItem);
  }

  async getByTitle(title: string) {
    // Одна игра может продаваться в нескольких магазинах, поэтому берём
    // первый подходящий оффер независимо от магазина.
    const offer = await prisma.offer.findFirst({
      where: { game: { title } },
      include: {
        game: { include: { tags: true } },
        priceHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return offer ? toListItem(offer) : null;
  }

  /**
   * Игра целиком: все предложения магазинов и полная история цен по каждому.
   * Запрос идёт от Game, а не от Offer, — иначе одна игра в трёх магазинах
   * выглядела бы как три разные записи, как в списочных методах.
   */
  async getBySlug(slug: string): Promise<GameDetail | null> {
    const game = await prisma.game.findUnique({
      where: { slug },
      include: {
        tags: true,
        offers: {
          include: { store: true, priceHistory: { orderBy: { createdAt: 'desc' } } },
          // Сначала самое дешёвое предложение, офферы без цены — в конец.
          // Второй ключ обязателен: при равных ценах порядок иначе плавает.
          orderBy: [{ currentPriceRub: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        },
      },
    });

    return game ? toGameDetail(game) : null;
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
      include: { game: { include: { tags: true } } },
    });

    return offers
      .filter((offer) => offer.game.title.toLowerCase().includes(lowerQuery))
      .slice(0, 20)
      .map(toListItem);
  }
}

export default new GameService();
