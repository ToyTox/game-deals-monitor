import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import parserService from '../../src/services/parserService.js';
import { prisma, resetDb } from '../helpers/db.js';

// Мокаем только parserService: он ходит в сеть. Статистика и логи читаются
// из настоящей базы. Форма с default обязательна — роутер импортирует экземпляр.
vi.mock('../../src/services/parserService.js', () => ({
  default: {
    parseAll: vi.fn(),
    parsePlatform: vi.fn(),
    getAvailablePlatforms: vi.fn(() => ['steam', 'epic', 'gog', 'vkplay']),
  },
}));

const mockedParserService = vi.mocked(parserService);
const app = createApp();

/**
 * createdAt задаётся явно там, где проверяется порядок: записи, созданные
 * в одну миллисекунду, получили бы одинаковую метку и сортировка стала бы случайной.
 */
function updateLog(platform: string, createdAt?: Date) {
  return {
    platform,
    gamesCount: 1,
    newGames: 1,
    updatedGames: 0,
    freedGames: 0,
    startTime: new Date(),
    endTime: new Date(),
    duration: 10,
    status: 'success',
    ...(createdAt ? { createdAt } : {}),
  };
}

describe('GET /api/admin/health', () => {
  it('отвечает, что сервис жив', async () => {
    const res = await request(app).get('/api/admin/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.timestamp).toBeTruthy();
  });
});

describe('GET /api/admin/stats', () => {
  beforeEach(resetDb);

  it('на пустой базе отдаёт нули', async () => {
    const res = await request(app).get('/api/admin/stats').expect(200);

    expect(res.body).toMatchObject({
      totalGames: 0,
      freeGames: 0,
      discountedGames: 0,
      averageDiscount: 0,
      lastUpdate: null,
    });
  });

  it('отдаёт разбивку по площадкам', async () => {
    await prisma.game.create({
      data: {
        title: 'Half-Life',
        platform: 'steam',
        gameUrl: 'https://example.test/hl',
        currentPrice: 500,
        originalPrice: 1000,
        discountPercent: 50,
      },
    });

    const res = await request(app).get('/api/admin/stats').expect(200);

    expect(res.body.totalGames).toBe(1);
    expect(res.body.byPlatform.steam).toEqual({ total: 1, free: 0, discounted: 1 });
  });
});

describe('GET /api/admin/updates', () => {
  beforeEach(resetDb);

  it('отдаёт логи от свежих к старым с учётом лимита', async () => {
    const platforms = ['steam', 'gog', 'vkplay'];
    for (const [index, platform] of platforms.entries()) {
      await prisma.updateLog.create({
        data: updateLog(platform, new Date(Date.UTC(2026, 0, index + 1))),
      });
    }

    const res = await request(app).get('/api/admin/updates?limit=2').expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.logs[0].platform).toBe('vkplay');
  });
});

describe('GET /api/admin/platforms', () => {
  it('отдаёт список доступных площадок', async () => {
    const res = await request(app).get('/api/admin/platforms').expect(200);

    expect(res.body).toEqual({
      platforms: ['steam', 'epic', 'gog', 'vkplay'],
      total: 4,
    });
  });
});

describe('POST /api/admin/parse', () => {
  beforeEach(() => {
    mockedParserService.parseAll.mockReset().mockResolvedValue([]);
    mockedParserService.parsePlatform
      .mockReset()
      .mockResolvedValue({ platform: 'steam', total: 0, new: 0, updated: 0, freed: 0 });
  });

  it('с указанной площадкой запускает только её парсер', async () => {
    const res = await request(app).post('/api/admin/parse').send({ platform: 'steam' }).expect(200);

    expect(mockedParserService.parsePlatform).toHaveBeenCalledWith('steam');
    expect(mockedParserService.parseAll).not.toHaveBeenCalled();
    expect(res.body.message).toContain('steam');
  });

  it('с пустым телом запускает все парсеры', async () => {
    await request(app).post('/api/admin/parse').send({}).expect(200);

    expect(mockedParserService.parseAll).toHaveBeenCalledOnce();
  });

  /**
   * Запрос вообще без Content-Type — самый вероятный способ вызова руками
   * (curl -X POST). Проверено: express.json() оставляет req.body пустым
   * объектом, а не undefined, поэтому req.body.platform не падает.
   * Тест закрепляет это: обращение к req.body без ?. остаётся безопасным
   * ровно до тех пор, пока express.json() подключён в createApp().
   */
  it('запрос вообще без тела запускает все парсеры', async () => {
    const res = await request(app).post('/api/admin/parse');

    expect(res.status).toBe(200);
    expect(mockedParserService.parseAll).toHaveBeenCalledOnce();
  });

  // Неизвестная площадка отвечает 500, хотя по смыслу это ошибка клиента (400).
  // Фиксируем как есть: менять коды ответов — отдельное решение.
  it('на неизвестной площадке отвечает 500 с текстом ошибки', async () => {
    mockedParserService.parsePlatform.mockRejectedValue(
      new Error('Парсер для платформы nope не найден')
    );

    const res = await request(app).post('/api/admin/parse').send({ platform: 'nope' }).expect(500);

    expect(res.body.message).toContain('не найден');
  });
});
