import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BaseParser } from '../../src/parsers/BaseParsers.js';
import { ParsedGame, Platform } from '../../src/types.js';
import { prisma, resetDb } from '../helpers/db.js';

/**
 * parse() абстрактен, а saveGames() принимает игры параметром — значит,
 * записывающую логику можно тестировать без сети через тестовый подкласс.
 */
class TestParser extends BaseParser {
  constructor(platform: Platform = 'steam') {
    super(platform, 'Test');
  }

  async parse(): Promise<ParsedGame[]> {
    return [];
  }
}

function game(overrides: Partial<ParsedGame> = {}): ParsedGame {
  return {
    title: 'Half-Life',
    platform: 'steam',
    originalPrice: 1000,
    currentPrice: 500,
    discountPercent: 50,
    isFree: false,
    gameUrl: 'https://store.steampowered.com/app/70',
    ...overrides,
  };
}

describe('BaseParser.saveGames', () => {
  beforeEach(resetDb);

  describe('создание', () => {
    it('создаёт новую игру и переносит все поля', async () => {
      const saleEnd = new Date('2030-01-01T00:00:00.000Z');

      const result = await new TestParser().saveGames([
        game({
          currency: 'RUB',
          imageUrl: 'https://example.test/cover.jpg',
          description: 'Описание',
          saleEndDate: saleEnd,
        }),
      ]);

      expect(result).toEqual({ platform: 'steam', total: 1, new: 1, updated: 0, freed: 0 });

      const saved = await prisma.game.findFirstOrThrow();
      expect(saved).toMatchObject({
        title: 'Half-Life',
        platform: 'steam',
        originalPrice: 1000,
        currentPrice: 500,
        currency: 'RUB',
        discountPercent: 50,
        isFree: false,
        gameUrl: 'https://store.steampowered.com/app/70',
        imageUrl: 'https://example.test/cover.jpg',
        description: 'Описание',
      });
      expect(saved.saleEndDate?.toISOString()).toBe(saleEnd.toISOString());
    });

    it('платформу берёт из парсера, а не из ParsedGame', async () => {
      // В ParsedGame платформа есть, но saveGames подставляет this.platform.
      await new TestParser('gog').saveGames([game({ platform: 'steam' })]);

      const saved = await prisma.game.findFirstOrThrow();
      expect(saved.platform).toBe('gog');
    });

    it('бесплатная игра при создании считается и новой, и освобождённой', async () => {
      const result = await new TestParser().saveGames([
        game({ currentPrice: 0, discountPercent: 100, isFree: true }),
      ]);

      expect(result).toMatchObject({ new: 1, freed: 1, updated: 0 });
    });

    it('не пишет историю цен для новой игры', async () => {
      await new TestParser().saveGames([game()]);

      expect(await prisma.priceHistory.count()).toBe(0);
    });
  });

  describe('обновление по составному ключу', () => {
    it('вторая запись с той же парой (title, platform) обновляет строку', async () => {
      const parser = new TestParser();

      await parser.saveGames([game()]);
      const result = await parser.saveGames([game({ currentPrice: 400, discountPercent: 60 })]);

      expect(result).toMatchObject({ total: 1, new: 0, updated: 1 });
      expect(await prisma.game.count()).toBe(1);

      const saved = await prisma.game.findFirstOrThrow();
      expect(saved.currentPrice).toBe(400);
      expect(saved.discountPercent).toBe(60);
    });

    // Регрессия на миграцию, снявшую глобальный Game_title_key:
    // одно и то же название на разных площадках обязано сосуществовать.
    it('то же название на другой платформе создаёт отдельную строку', async () => {
      await new TestParser('steam').saveGames([game()]);
      await new TestParser('gog').saveGames([game()]);

      const saved = await prisma.game.findMany({ orderBy: { platform: 'asc' } });
      expect(saved).toHaveLength(2);
      expect(saved.map((g) => g.platform)).toEqual(['gog', 'steam']);
    });
  });

  describe('условие записи истории цен', () => {
    const seed = () => new TestParser().saveGames([game()]);

    it('не пишет историю, если цена и скидка не изменились', async () => {
      await seed();
      await new TestParser().saveGames([game()]);

      expect(await prisma.priceHistory.count()).toBe(0);
    });

    it('пишет одну запись при изменении только цены', async () => {
      await seed();
      await new TestParser().saveGames([game({ currentPrice: 400 })]);

      const history = await prisma.priceHistory.findMany();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        oldPrice: 500,
        newPrice: 400,
        oldDiscount: 50,
        newDiscount: 50,
      });
    });

    it('пишет одну запись при изменении только скидки', async () => {
      await seed();
      await new TestParser().saveGames([game({ discountPercent: 75 })]);

      const history = await prisma.priceHistory.findMany();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ oldDiscount: 50, newDiscount: 75 });
    });

    it('при изменении и цены, и скидки пишет одну запись, а не две', async () => {
      await seed();
      await new TestParser().saveGames([game({ currentPrice: 400, discountPercent: 60 })]);

      expect(await prisma.priceHistory.count()).toBe(1);
    });

    // Осознанное упущение текущей реализации: сравниваются только currentPrice
    // и discountPercent, изменение оригинальной цены историю не порождает.
    it('изменение только originalPrice историю не порождает', async () => {
      await seed();
      await new TestParser().saveGames([game({ originalPrice: 2000 })]);

      expect(await prisma.priceHistory.count()).toBe(0);
      expect((await prisma.game.findFirstOrThrow()).originalPrice).toBe(2000);
    });

    it('переход цены из null в 0 считается изменением', async () => {
      await new TestParser().saveGames([game({ currentPrice: undefined, discountPercent: 0 })]);
      await new TestParser().saveGames([game({ currentPrice: 0, discountPercent: 0 })]);

      const history = await prisma.priceHistory.findMany();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ oldPrice: null, newPrice: 0 });
    });
  });

  describe('счётчик freed', () => {
    it('считает только переход из платной в бесплатную', async () => {
      await new TestParser().saveGames([game()]);

      const result = await new TestParser().saveGames([
        game({ currentPrice: 0, discountPercent: 100, isFree: true }),
      ]);

      expect(result).toMatchObject({ updated: 1, freed: 1 });
    });

    it('не считает игру, которая и так была бесплатной', async () => {
      const free = game({ currentPrice: 0, discountPercent: 100, isFree: true });

      await new TestParser().saveGames([free]);
      const result = await new TestParser().saveGames([free]);

      expect(result).toMatchObject({ updated: 1, freed: 0 });
    });
  });

  describe('журнал обновлений', () => {
    it('пишет успешный лог со счётчиками, совпадающими с результатом', async () => {
      const result = await new TestParser().saveGames([
        game(),
        game({ title: 'Portal', currentPrice: 0, isFree: true }),
      ]);

      const log = await prisma.updateLog.findFirstOrThrow();
      expect(log).toMatchObject({
        platform: 'steam',
        status: 'success',
        gamesCount: 2,
        newGames: result.new,
        updatedGames: result.updated,
        freedGames: result.freed,
        error: null,
      });
      expect(log.duration).toBeGreaterThanOrEqual(0);
      expect(log.endTime.getTime()).toBeGreaterThanOrEqual(log.startTime.getTime());
    });

    // На пустом списке опирается POST /api/admin/parse: он должен отвечать,
    // даже когда парсер ничего не нашёл.
    it('на пустом списке возвращает нули, но лог всё равно пишет', async () => {
      const result = await new TestParser().saveGames([]);

      expect(result).toEqual({ platform: 'steam', total: 0, new: 0, updated: 0, freed: 0 });
      expect(await prisma.updateLog.findFirstOrThrow()).toMatchObject({
        status: 'success',
        gamesCount: 0,
      });
    });
  });

  describe('путь ошибки', () => {
    // Метод делегата подменяем и возвращаем вручную: авто-restore у Vitest
    // ломает прокси Prisma — после него prisma.game.findUnique исчезает совсем.
    let original: typeof prisma.game.findUnique;

    beforeEach(() => {
      original = prisma.game.findUnique;
    });

    afterEach(() => {
      prisma.game.findUnique = original;
    });

    const failFindUnique = (reason: unknown) => {
      prisma.game.findUnique = (() =>
        Promise.reject(reason)) as unknown as typeof prisma.game.findUnique;
    };

    it('пробрасывает исключение и пишет лог со статусом error', async () => {
      failFindUnique(new Error('boom'));

      // Проброс важен для Promise.allSettled в parserService,
      // а строка лога — для GET /api/admin/updates.
      await expect(new TestParser().saveGames([game()])).rejects.toThrow('boom');

      expect(await prisma.updateLog.findFirstOrThrow()).toMatchObject({
        platform: 'steam',
        status: 'error',
        error: 'boom',
        gamesCount: 0,
        newGames: 0,
        updatedGames: 0,
        freedGames: 0,
      });
    });

    it('не-Error причину приводит к строке', async () => {
      failFindUnique('строковая причина');

      await expect(new TestParser().saveGames([game()])).rejects.toBeTruthy();

      expect((await prisma.updateLog.findFirstOrThrow()).error).toBe('строковая причина');
    });

    it.todo('если падает сама запись лога, исходная ошибка теряется');
  });

  // Прямые последствия бага Steam со скидкой 100%: ни NaN, ни Infinity не
  // роняют запись — оба молча доезжают до базы, но по-разному. Это и делает
  // баг незаметным: парсер отчитывается об успехе, а данные испорчены.
  describe('нечисловые цены доходят до базы', () => {
    it('NaN в originalPrice молча превращается в null', async () => {
      await new TestParser().saveGames([game({ originalPrice: NaN })]);

      expect((await prisma.game.findFirstOrThrow()).originalPrice).toBeNull();
    });

    it('Infinity в originalPrice сохраняется как есть', async () => {
      await new TestParser().saveGames([game({ originalPrice: Infinity })]);

      // В JSON-ответе API это станет null (JSON.stringify не умеет Infinity),
      // то есть наружу баг протекает так же тихо, как и в случае с NaN.
      expect((await prisma.game.findFirstOrThrow()).originalPrice).toBe(Infinity);
    });
  });
});
