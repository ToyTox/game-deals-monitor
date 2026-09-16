import prisma from '../../src/database.js';
import { normalizeTitle, slugify } from '../../src/lib/titleNormalizer.js';

export { prisma };

/**
 * Чистка между тестами.
 *
 * Удаляем детей явно, а не полагаемся на ON DELETE CASCADE: включает ли
 * адаптер better-sqlite3 PRAGMA foreign_keys — не проверено, а четыре запроса
 * стоят около миллисекунды. Store не чистим: это справочник, парсеры и
 * seedOffer заводят магазины через upsert.
 *
 * Автоинкрементные id при этом продолжают расти (deleteMany не трогает
 * sqlite_sequence), поэтому в тестах нельзя проверять литеральный id.
 */
export async function resetDb() {
  await prisma.priceHistory.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.updateLog.deleteMany();
}

export type OfferSeed = {
  title: string;
  /** id магазина */
  platform?: string;
  kind?: string;
  /** null — оффер без цены (так бывает у предзаказов и снятых с продажи) */
  currentPrice?: number | null;
  originalPrice?: number;
  currency?: string;
  discountPercent?: number;
  isFree?: boolean;
  /** Задавать явно там, где проверяется порядок: иначе две записи, созданные
   *  в одну миллисекунду, получают одинаковый createdAt и сортировка плавает. */
  createdAt?: Date;
  saleEndDate?: Date;
};

/**
 * Оффер магазина вместе с канонической игрой. Одно название в разных магазинах
 * даёт одну игру и несколько офферов — как у BaseParser.saveGames.
 * Рублёвая цена равна исходной: сеть к ЦБ в тестах не нужна.
 */
export async function seedOffer(seed: OfferSeed) {
  const storeId = seed.platform ?? 'steam';
  await prisma.store.upsert({
    where: { id: storeId },
    create: { id: storeId, name: storeId, kind: 'official' },
    update: {},
  });

  const normalizedTitle = normalizeTitle(seed.title);
  const game = await prisma.game.upsert({
    where: { normalizedTitle },
    create: {
      title: seed.title,
      normalizedTitle,
      slug: slugify(seed.title),
      kind: seed.kind ?? 'game',
    },
    update: {},
  });

  const currentPrice = seed.currentPrice === undefined ? 500 : seed.currentPrice;
  const originalPrice = seed.originalPrice ?? 1000;

  return prisma.offer.create({
    data: {
      gameId: game.id,
      storeId,
      gameUrl: `https://example.test/${encodeURIComponent(seed.title)}`,
      originalPrice,
      currentPrice,
      currency: seed.currency ?? 'RUB',
      originalPriceRub: originalPrice,
      currentPriceRub: currentPrice,
      discountPercent: seed.discountPercent ?? 50,
      isFree: seed.isFree ?? false,
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
      ...(seed.saleEndDate ? { saleEndDate: seed.saleEndDate } : {}),
    },
  });
}
