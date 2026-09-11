import { describe, it, expect, beforeEach } from 'vitest';
import gameService from '../../src/services/gameService.js';
import { prisma, resetDb } from '../helpers/db.js';

type GameSeed = {
  title: string;
  platform?: string;
  currentPrice?: number;
  originalPrice?: number;
  currency?: string;
  discountPercent?: number;
  isFree?: boolean;
  /** Задавать явно там, где проверяется порядок: иначе две записи, созданные
   *  в одну миллисекунду, получают одинаковый createdAt и сортировка плавает. */
  createdAt?: Date;
};

async function seedGame(seed: GameSeed) {
  return prisma.game.create({
    data: {
      title: seed.title,
      platform: seed.platform ?? 'steam',
      gameUrl: `https://example.test/${encodeURIComponent(seed.title)}`,
      originalPrice: seed.originalPrice ?? 1000,
      currentPrice: seed.currentPrice ?? 500,
      currency: seed.currency ?? 'RUB',
      discountPercent: seed.discountPercent ?? 50,
      isFree: seed.isFree ?? false,
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    },
  });
}

describe('GameService', () => {
  beforeEach(resetDb);

  describe('getGames', () => {
    it('без фильтров отдаёт все игры со значениями по умолчанию', async () => {
      await seedGame({ title: 'A' });
      await seedGame({ title: 'B' });

      const result = await gameService.getGames();

      expect(result.games).toHaveLength(2);
      expect(result).toMatchObject({ total: 2, limit: 100, offset: 0 });
    });

    it('сортирует по убыванию скидки', async () => {
      await seedGame({ title: 'Маленькая скидка', discountPercent: 10 });
      await seedGame({ title: 'Большая скидка', discountPercent: 90 });

      const { games } = await gameService.getGames();

      expect(games.map((g) => g.title)).toEqual(['Большая скидка', 'Маленькая скидка']);
    });

    it('фильтрует по платформе', async () => {
      await seedGame({ title: 'A', platform: 'steam' });
      await seedGame({ title: 'B', platform: 'gog' });

      const result = await gameService.getGames({ platform: 'gog' });

      expect(result.games.map((g) => g.title)).toEqual(['B']);
      // total — количество отфильтрованных записей, а не размер страницы.
      expect(result.total).toBe(1);
    });

    it('фильтрует по минимальной скидке и по признаку бесплатной', async () => {
      await seedGame({ title: 'Дешёвая', discountPercent: 20 });
      await seedGame({ title: 'Щедрая', discountPercent: 80 });
      await seedGame({ title: 'Бесплатная', discountPercent: 100, isFree: true });

      expect((await gameService.getGames({ minDiscount: 80 })).games.map((g) => g.title)).toEqual([
        'Бесплатная',
        'Щедрая',
      ]);
      expect((await gameService.getGames({ freeOnly: true })).games.map((g) => g.title)).toEqual([
        'Бесплатная',
      ]);
    });

    it('листает страницы через limit и offset', async () => {
      await seedGame({ title: 'Первая', discountPercent: 90 });
      await seedGame({ title: 'Вторая', discountPercent: 50 });
      await seedGame({ title: 'Третья', discountPercent: 10 });

      const page = await gameService.getGames({ limit: 1, offset: 1 });

      expect(page.games.map((g) => g.title)).toEqual(['Вторая']);
      // total остаётся общим количеством подходящих записей.
      expect(page.total).toBe(3);
    });

    it('подмешивает последние пять записей истории цен', async () => {
      const game = await seedGame({ title: 'С историей' });
      for (let i = 0; i < 7; i++) {
        await prisma.priceHistory.create({
          data: { gameId: game.id, oldPrice: 100 + i, newPrice: 90 + i },
        });
      }

      const { games } = await gameService.getGames();

      expect(games[0].priceHistory).toHaveLength(5);
    });

    /**
     * Зафиксировано текущее поведение: проверка `filter?.minDiscount && > 0`
     * отбрасывает ноль вместе с undefined, поэтому minDiscount=0 означает
     * «фильтра нет». Для нуля это осмысленно, а вот NaN (он приходит из роута
     * при ?minDiscount=abc) так же молча игнорируется.
     */
    it('minDiscount=0 и NaN трактуются как отсутствие фильтра', async () => {
      await seedGame({ title: 'Без скидки', discountPercent: 0 });

      expect((await gameService.getGames({ minDiscount: 0 })).total).toBe(1);
      expect((await gameService.getGames({ minDiscount: NaN })).total).toBe(1);
    });

    // Зафиксировано текущее поведение: `filter?.limit || 100` превращает ноль
    // в сотню. Ответ при этом самосогласован — поле limit тоже сообщает 100.
    it('limit=0 подменяется на 100', async () => {
      await seedGame({ title: 'A' });

      const result = await gameService.getGames({ limit: 0 });

      expect(result.games).toHaveLength(1);
      expect(result.limit).toBe(100);
    });
  });

  describe('getFreeGames и getTopDiscounts', () => {
    it('бесплатные сортируются по дате добавления, а не по скидке', async () => {
      // Скидка у первой больше — если бы сортировка шла по ней, порядок был бы обратным.
      await seedGame({
        title: 'Первая бесплатная',
        isFree: true,
        discountPercent: 100,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      await seedGame({
        title: 'Вторая бесплатная',
        isFree: true,
        discountPercent: 10,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      const games = await gameService.getFreeGames();

      // createdAt по убыванию: последняя добавленная идёт первой.
      expect(games.map((g) => g.title)).toEqual(['Вторая бесплатная', 'Первая бесплатная']);
    });

    it('топ скидок исключает игры без скидки и сортируется по её размеру', async () => {
      await seedGame({ title: 'Без скидки', discountPercent: 0 });
      await seedGame({ title: 'Средняя', discountPercent: 40 });
      await seedGame({ title: 'Крупная', discountPercent: 85 });

      expect((await gameService.getTopDiscounts()).map((g) => g.title)).toEqual([
        'Крупная',
        'Средняя',
      ]);
    });

    it('уважают переданный лимит', async () => {
      await seedGame({ title: 'A', isFree: true });
      await seedGame({ title: 'B', isFree: true });

      expect(await gameService.getFreeGames(1)).toHaveLength(1);
      expect(await gameService.getTopDiscounts(1)).toHaveLength(1);
    });
  });

  describe('getByPlatform', () => {
    it('отдаёт игры одной площадки по убыванию скидки', async () => {
      await seedGame({ title: 'GOG слабая', platform: 'gog', discountPercent: 15 });
      await seedGame({ title: 'GOG сильная', platform: 'gog', discountPercent: 65 });
      await seedGame({ title: 'Steam', platform: 'steam' });

      expect((await gameService.getByPlatform('gog')).map((g) => g.title)).toEqual([
        'GOG сильная',
        'GOG слабая',
      ]);
    });
  });

  describe('getByTitle', () => {
    it('отдаёт игру вместе со всей историей цен', async () => {
      const game = await seedGame({ title: 'Half-Life' });
      await prisma.priceHistory.create({
        data: { gameId: game.id, oldPrice: 1000, newPrice: 500 },
      });

      const found = await gameService.getByTitle('Half-Life');

      expect(found?.title).toBe('Half-Life');
      expect(found?.priceHistory).toHaveLength(1);
    });

    it('на отсутствующем названии возвращает null', async () => {
      expect(await gameService.getByTitle('Нет такой игры')).toBeNull();
    });

    /**
     * Прямое следствие смены уникального ключа на пару (title, platform):
     * одно название может существовать на нескольких площадках, а findFirst
     * возвращает только одну запись — какую именно, метод не оговаривает.
     */
    it('при одном названии на двух площадках отдаёт одну из записей', async () => {
      await seedGame({ title: 'Cyberpunk 2077', platform: 'steam' });
      await seedGame({ title: 'Cyberpunk 2077', platform: 'gog' });

      const found = await gameService.getByTitle('Cyberpunk 2077');

      expect(found).not.toBeNull();
      expect(['steam', 'gog']).toContain(found?.platform);
    });
  });

  describe('getStats', () => {
    it('на пустой базе отдаёт нули, а не NaN', async () => {
      const stats = await gameService.getStats();

      expect(stats).toMatchObject({
        totalGames: 0,
        freeGames: 0,
        discountedGames: 0,
        averageDiscount: 0,
        byPlatform: {},
        topDiscounts: [],
        lastUpdate: null,
      });
    });

    it('считает среднюю скидку только по играм со скидкой и округляет до сотых', async () => {
      await seedGame({ title: 'A', discountPercent: 10 });
      await seedGame({ title: 'B', discountPercent: 25 });
      await seedGame({ title: 'C', discountPercent: 0 });

      // Ноль в среднее не входит: (10 + 25) / 2 = 17.5
      expect((await gameService.getStats()).averageDiscount).toBe(17.5);
    });

    it('разбивает по площадкам с подсчётом бесплатных и со скидкой', async () => {
      await seedGame({ title: 'S1', platform: 'steam', discountPercent: 50 });
      await seedGame({ title: 'S2', platform: 'steam', discountPercent: 0, isFree: true });
      await seedGame({ title: 'G1', platform: 'gog', discountPercent: 30 });

      const { byPlatform } = await gameService.getStats();

      expect(byPlatform).toEqual({
        steam: { total: 2, free: 1, discounted: 1 },
        gog: { total: 1, free: 0, discounted: 1 },
      });
    });

    it('отдаёт топ скидок и дату последнего обновления', async () => {
      await seedGame({ title: 'Крупная', discountPercent: 90 });
      await prisma.updateLog.create({
        data: {
          platform: 'steam',
          gamesCount: 1,
          newGames: 1,
          updatedGames: 0,
          freedGames: 0,
          startTime: new Date(),
          endTime: new Date(),
          duration: 5,
          status: 'success',
        },
      });

      const stats = await gameService.getStats();

      expect(stats.topDiscounts[0]).toEqual({
        title: 'Крупная',
        platform: 'steam',
        discount: 90,
      });
      expect(stats.lastUpdate).toBeInstanceOf(Date);
    });
  });

  describe('getPriceHistory', () => {
    it('отдаёт историю и валюту игры', async () => {
      const game = await seedGame({ title: 'Half-Life', currency: 'RUB' });
      await prisma.priceHistory.create({
        data: { gameId: game.id, oldPrice: 1000, newPrice: 500, oldDiscount: 0, newDiscount: 50 },
      });

      const { currency, history } = await gameService.getPriceHistory('Half-Life');

      expect(currency).toBe('RUB');
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ oldPrice: 1000, newPrice: 500 });
    });

    it('на отсутствующей игре бросает ошибку с названием', async () => {
      await expect(gameService.getPriceHistory('Нет такой')).rejects.toThrow(
        'Игра "Нет такой" не найдена'
      );
    });
  });

  describe('getUpdateLogs', () => {
    it('отдаёт логи от свежих к старым с учётом лимита', async () => {
      // Даты задаём явно: записи, созданные в одну миллисекунду,
      // получили бы одинаковый createdAt и порядок стал бы случайным.
      const platforms = ['steam', 'gog', 'vkplay'];
      for (const [index, platform] of platforms.entries()) {
        await prisma.updateLog.create({
          data: {
            platform,
            gamesCount: 1,
            newGames: 0,
            updatedGames: 0,
            freedGames: 0,
            startTime: new Date(),
            endTime: new Date(),
            duration: 1,
            status: 'success',
            createdAt: new Date(Date.UTC(2026, 0, index + 1)),
          },
        });
      }

      const logs = await gameService.getUpdateLogs(2);

      expect(logs).toHaveLength(2);
      expect(logs[0].platform).toBe('vkplay');
    });
  });

  describe('search', () => {
    it('находит по части названия', async () => {
      await seedGame({ title: 'The Witcher 3' });
      await seedGame({ title: 'Portal 2' });

      expect((await gameService.search('Witcher')).map((g) => g.title)).toEqual(['The Witcher 3']);
    });

    // LIKE в SQLite нечувствителен к регистру для ASCII, поэтому латиница
    // ищется в любом регистре несмотря на принудительный toLowerCase.
    it('латиницу находит независимо от регистра', async () => {
      await seedGame({ title: 'The Witcher 3' });

      expect(await gameService.search('WITCHER')).toHaveLength(1);
      expect(await gameService.search('witcher')).toHaveLength(1);
    });

    it('на отсутствующем совпадении возвращает пустой список', async () => {
      await seedGame({ title: 'Portal 2' });

      expect(await gameService.search('Doom')).toEqual([]);
    });

    /**
     * БУДУЩИЙ БАГФИКС. Запрос принудительно приводится к нижнему регистру,
     * а встроенный LIKE в SQLite не умеет сворачивать регистр для не-ASCII.
     * Поэтому «ВЕДЬМАК» превращается в «ведьмак» и не находит запись
     * «Ведьмак» — в русскоязычном магазине это заметный пользовательский баг.
     * Тест написан на корректное поведение и падает намеренно.
     */
    it('кириллицу находит независимо от регистра', async () => {
      await seedGame({ title: 'Ведьмак 3' });

      expect(await gameService.search('ведьмак')).toHaveLength(1);
      expect(await gameService.search('ВЕДЬМАК')).toHaveLength(1);
    });
  });
});
