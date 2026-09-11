import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma, resetDb } from '../helpers/db.js';

// Роуты игр ходят в реальную базу; мокаем только parserService — он лезет в сеть.
// Форма мока с default обязательна: роутеры импортируют готовый экземпляр.
vi.mock('../../src/services/parserService.js', () => ({
  default: {
    parseAll: vi.fn(),
    parsePlatform: vi.fn(),
    getAvailablePlatforms: vi.fn(() => ['steam', 'epic', 'gog', 'vkplay']),
  },
}));

const app = createApp();

async function seedGame(title: string, overrides: Record<string, unknown> = {}) {
  return prisma.game.create({
    data: {
      title,
      platform: 'steam',
      gameUrl: `https://example.test/${encodeURIComponent(title)}`,
      originalPrice: 1000,
      currentPrice: 500,
      currency: 'RUB',
      discountPercent: 50,
      isFree: false,
      ...overrides,
    },
  });
}

describe('GET /api/games', () => {
  beforeEach(resetDb);

  it('отдаёт список со значениями по умолчанию', async () => {
    await seedGame('Half-Life');

    const res = await request(app).get('/api/games').expect(200);

    expect(res.body).toMatchObject({ total: 1, limit: 100, offset: 0 });
    expect(res.body.games).toHaveLength(1);
  });

  it('прокидывает фильтры платформы и минимальной скидки', async () => {
    await seedGame('Steam слабая', { discountPercent: 10 });
    await seedGame('Steam сильная', { discountPercent: 80 });
    await seedGame('GOG', { platform: 'gog', discountPercent: 80 });

    const res = await request(app).get('/api/games?platform=steam&minDiscount=50').expect(200);

    expect(res.body.games.map((g: { title: string }) => g.title)).toEqual(['Steam сильная']);
  });

  // Строгое сравнение free === "true": другие написания фильтр не включают.
  it('признак free включается только точным значением "true"', async () => {
    await seedGame('Платная');
    await seedGame('Бесплатная', { isFree: true, currentPrice: 0 });

    expect((await request(app).get('/api/games?free=true')).body.total).toBe(1);
    expect((await request(app).get('/api/games?free=1')).body.total).toBe(2);
    expect((await request(app).get('/api/games?free=TRUE')).body.total).toBe(2);
  });

  it('нечисловой limit безвреден: подставляется сотня', async () => {
    await seedGame('Half-Life');

    const res = await request(app).get('/api/games?limit=abc').expect(200);

    expect(res.body.limit).toBe(100);
  });

  // parseInt('abc') даёт NaN, и он доходит до Prisma как skip. Проверено:
  // запрос не падает, NaN трактуется как нулевое смещение. Отдельная защита
  // от NaN в роуте не нужна — фиксируем это, чтобы её не добавили «на всякий случай».
  it('нечисловой offset не ломает запрос', async () => {
    await seedGame('Half-Life');

    const res = await request(app).get('/api/games?offset=abc').expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.games).toHaveLength(1);
  });
});

describe('порядок объявления роутов', () => {
  beforeEach(resetDb);

  /**
   * Роуты /free, /top-discounts и /search обязаны быть объявлены до /:title,
   * иначе Express отдаст их как запрос игры с таким названием. Эти три теста
   * ловят перестановку строк в файле роутера.
   */
  it('/free отдаёт список бесплатных, даже если есть игра с названием "free"', async () => {
    await seedGame('free');

    const res = await request(app).get('/api/games/free').expect(200);

    expect(res.body).toHaveProperty('games');
    expect(res.body).toHaveProperty('total');
    expect(res.body).not.toHaveProperty('title');
  });

  it('/top-discounts не перехватывается роутом одной игры', async () => {
    await seedGame('top-discounts');

    const res = await request(app).get('/api/games/top-discounts').expect(200);

    expect(res.body).toHaveProperty('games');
    expect(res.body).not.toHaveProperty('title');
  });

  it('/search не перехватывается роутом одной игры', async () => {
    await seedGame('search');

    // Без параметра q поиск отвечает 400 — значит, отработал именно он.
    await request(app).get('/api/games/search').expect(400);
  });
});

describe('GET /api/games/platform/:name', () => {
  beforeEach(resetDb);

  it('приводит название площадки к нижнему регистру', async () => {
    await seedGame('GOG игра', { platform: 'gog' });

    const res = await request(app).get('/api/games/platform/GOG').expect(200);

    expect(res.body).toMatchObject({ platform: 'gog', total: 1 });
  });
});

describe('GET /api/games/search', () => {
  beforeEach(resetDb);

  it('отвечает 400 без запроса и на запрос короче двух символов', async () => {
    await request(app).get('/api/games/search').expect(400);

    const res = await request(app).get('/api/games/search?q=a').expect(400);
    expect(res.body.error).toContain('минимум 2 символа');
  });

  it('находит игру по части названия', async () => {
    await seedGame('The Witcher 3');

    const res = await request(app).get('/api/games/search?q=Witcher').expect(200);

    expect(res.body).toMatchObject({ query: 'Witcher', total: 1 });
  });

  /**
   * БУДУЩИЙ БАГФИКС. Повторённый параметр превращает q в массив: его length
   * равен 2 и проходит проверку, а затем toLowerCase падает с TypeError.
   * Ожидаем 400, тест падает намеренно.
   * Починка — проверять, что q именно строка.
   */
  it('повторённый параметр q не должен приводить к ошибке сервера', async () => {
    const res = await request(app).get('/api/games/search?q=ab&q=cd');

    expect(res.status).toBe(400);
  });
});

describe('GET /api/games/:title', () => {
  beforeEach(resetDb);

  it('отдаёт игру с историей цен', async () => {
    const game = await seedGame('Half-Life');
    await prisma.priceHistory.create({
      data: { gameId: game.id, oldPrice: 1000, newPrice: 500 },
    });

    const res = await request(app).get('/api/games/Half-Life').expect(200);

    expect(res.body).toMatchObject({ title: 'Half-Life', platform: 'steam' });
    expect(res.body.priceHistory).toHaveLength(1);
  });

  it('на неизвестном названии отвечает 404', async () => {
    const res = await request(app).get('/api/games/Нет такой игры').expect(404);

    expect(res.body.error).toBe('Игра не найдена');
  });

  it('корректно принимает названия с пробелами и кириллицей', async () => {
    await seedGame('Казино с друзьями');

    const res = await request(app)
      .get(`/api/games/${encodeURIComponent('Казино с друзьями')}`)
      .expect(200);

    expect(res.body.title).toBe('Казино с друзьями');
  });
});

describe('GET /api/games/:title/price-history', () => {
  beforeEach(resetDb);

  it('отдаёт историю вместе с валютой', async () => {
    const game = await seedGame('Half-Life', { currency: 'RUB' });
    await prisma.priceHistory.create({
      data: { gameId: game.id, oldPrice: 1000, newPrice: 500 },
    });

    const res = await request(app).get('/api/games/Half-Life/price-history').expect(200);

    expect(res.body).toMatchObject({ game: 'Half-Life', currency: 'RUB', total: 1 });
  });

  // Роут отображает в 404 ЛЮБУЮ ошибку, включая ошибки базы: отличить
  // «игры нет» от «база недоступна» по ответу невозможно.
  it('на неизвестном названии отвечает 404', async () => {
    const res = await request(app).get('/api/games/Нет такой/price-history').expect(404);

    expect(res.body.message).toContain('не найдена');
  });
});

describe('статика и корневой эндпоинт', () => {
  it('отдаёт index.html по корню', async () => {
    const res = await request(app).get('/').expect(200);

    // Статика должна оставаться подключённой ДО роутеров.
    expect(res.text).toContain('<script src="/app.js"');
  });

  it('отдаёт справочник эндпоинтов по /api', async () => {
    const res = await request(app).get('/api').expect(200);

    expect(res.body).toMatchObject({ name: 'Game Deals Monitor API' });
    expect(res.body.endpoints).toHaveProperty('health', '/api/admin/health');
  });
});
