import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { PriceDynamicsError, type PriceDynamics } from '../../src/services/itadService.js';

vi.mock('../../src/services/itadService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/itadService.js')>();
  return {
    ...actual,
    default: {
      isFunctionEnabled: vi.fn(() => true),
      getSupportedStores: vi.fn(() => ['steam', 'gog', 'epic']),
      getPriceDynamics: vi.fn(),
      resetCache: vi.fn(),
    },
  };
});

const { default: itadService } = await import('../../src/services/itadService.js');
const mockedGetPriceDynamics = itadService.getPriceDynamics as unknown as Mock;
const mockedIsFunctionEnabled = itadService.isFunctionEnabled as unknown as Mock;

const app = createApp();

function mockDynamics(overrides: Partial<PriceDynamics> = {}): PriceDynamics {
  return {
    shop: 'steam',
    country: 'RU',
    currency: 'RUB',
    currentPrice: 999,
    graphPoints: [
      { timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), price: 1000 },
      { timestamp: new Date(Date.now()).toISOString(), price: 999 },
    ],
    periods: {
      day: { price: 999, change: 0, lowest: 999 },
      week: { price: 1000, change: -1, lowest: 999 },
      month: { price: 1000, change: -1, lowest: 999 },
      half_year: { price: 1000, change: -1, lowest: 999 },
    },
    allTimeLowest: { price: 500, timestamp: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString() },
    ...overrides,
  };
}

describe('GET /api/price-dynamics/status', () => {
  it('отвечает 200 с enabled: true если функция включена', async () => {
    mockedIsFunctionEnabled.mockReturnValue(true);

    const res = await request(app).get('/api/price-dynamics/status').expect(200);

    expect(res.body).toMatchObject({
      enabled: true,
      country: 'RU',
      supportedStores: expect.arrayContaining(['steam', 'gog', 'epic']),
      registerUrl: expect.stringContaining('isthereanydeal.com'),
    });
    expect(res.body.reminder).toBeUndefined();
  });

  it('отвечает 200 с enabled: false и текстом напоминания если ключа нет', async () => {
    mockedIsFunctionEnabled.mockReturnValue(false);

    const res = await request(app).get('/api/price-dynamics/status').expect(200);

    expect(res.body).toMatchObject({
      enabled: false,
      country: 'RU',
      supportedStores: expect.arrayContaining(['steam', 'gog', 'epic']),
      registerUrl: expect.stringContaining('isthereanydeal.com'),
      reminder: expect.stringContaining('ITAD_API_KEY'),
    });
  });
});

describe('GET /api/price-dynamics', () => {
  beforeEach(() => {
    mockedGetPriceDynamics.mockReset();
  });

  it('требует параметр store', async () => {
    const res = await request(app).get('/api/price-dynamics?appId=12345').expect(400);

    expect(res.body).toMatchObject({
      code: 'invalid_store',
      error: expect.stringContaining('store'),
    });
  });

  it('требует валидный магазин', async () => {
    const res = await request(app).get('/api/price-dynamics?store=vkplay&title=game').expect(400);

    expect(res.body).toMatchObject({
      code: 'invalid_store',
    });
  });

  it('требует title для всех магазинов', async () => {
    const res = await request(app).get('/api/price-dynamics?store=steam').expect(400);

    expect(res.body).toMatchObject({
      code: 'missing_title',
      error: expect.stringContaining('title'),
    });
  });

  it('для Steam без appId ищет по title', async () => {
    mockedGetPriceDynamics.mockResolvedValue(mockDynamics());

    const res = await request(app)
      .get('/api/price-dynamics?store=steam&title=Portal')
      .expect(200);

    expect(mockedGetPriceDynamics).toHaveBeenCalledWith('steam', 'Portal');
  });

  it('appId=12abc игнорируется, поиск идёт по title', async () => {
    mockedGetPriceDynamics.mockResolvedValue(mockDynamics());

    const res = await request(app)
      .get('/api/price-dynamics?store=steam&appId=12abc&title=Portal')
      .expect(200);

    expect(mockedGetPriceDynamics).toHaveBeenCalledWith('steam', 'Portal');
    expect(res.body).toMatchObject({ shop: 'steam' });
  });

  it('appId=0 игнорируется, поиск идёт по title', async () => {
    mockedGetPriceDynamics.mockResolvedValue(mockDynamics());

    const res = await request(app)
      .get('/api/price-dynamics?store=steam&appId=0&title=Portal')
      .expect(200);

    expect(mockedGetPriceDynamics).toHaveBeenCalledWith('steam', 'Portal');
    expect(res.body).toMatchObject({ shop: 'steam' });
  });

  it('получает динамику для Steam по appId', async () => {
    mockedGetPriceDynamics.mockResolvedValue(mockDynamics());

    const res = await request(app)
      .get('/api/price-dynamics?store=steam&appId=12345&title=Portal')
      .expect(200);

    expect(res.body).toMatchObject({
      shop: 'steam',
      currentPrice: 999,
    });

    expect(mockedGetPriceDynamics).toHaveBeenCalledWith('steam', 12345);
  });

  it('получает динамику для GOG по названию', async () => {
    mockedGetPriceDynamics.mockResolvedValue(mockDynamics({ shop: 'gog' }));

    const res = await request(app)
      .get('/api/price-dynamics?store=gog&title=The%20Witcher%203')
      .expect(200);

    expect(res.body).toMatchObject({
      shop: 'gog',
    });

    expect(mockedGetPriceDynamics).toHaveBeenCalledWith('gog', 'The Witcher 3');
  });

  it('получает динамику для Epic по названию', async () => {
    mockedGetPriceDynamics.mockResolvedValue(mockDynamics({ shop: 'epic' }));

    const res = await request(app)
      .get('/api/price-dynamics?store=epic&title=Fortnite')
      .expect(200);

    expect(res.body).toMatchObject({
      shop: 'epic',
    });

    expect(mockedGetPriceDynamics).toHaveBeenCalledWith('epic', 'Fortnite');
  });

  it('обрезает пробелы в названии', async () => {
    mockedGetPriceDynamics.mockResolvedValue(mockDynamics());

    await request(app)
      .get('/api/price-dynamics?store=gog&title=%20%20Game%20%20')
      .expect(200);

    expect(mockedGetPriceDynamics).toHaveBeenCalledWith('gog', 'Game');
  });

  it('регистр magазина не чувствителен', async () => {
    mockedGetPriceDynamics.mockResolvedValue(mockDynamics());

    const res = await request(app)
      .get('/api/price-dynamics?store=STEAM&appId=12345&title=Portal')
      .expect(200);

    expect(res.body).toMatchObject({ shop: 'steam' });
  });

  it('отвечает 404 если игра не найдена', async () => {
    mockedGetPriceDynamics.mockRejectedValue(
      new PriceDynamicsError('not_found', 'Game not found')
    );

    const res = await request(app)
      .get('/api/price-dynamics?store=steam&appId=99999&title=Unknown')
      .expect(404);

    expect(res.body).toMatchObject({
      code: 'not_found',
      error: expect.stringContaining('not found'),
    });
  });

  it('отвечает 503 если нет ключа ITAD', async () => {
    mockedGetPriceDynamics.mockRejectedValue(
      new PriceDynamicsError('no_key', 'ITAD API key is not configured')
    );

    const res = await request(app)
      .get('/api/price-dynamics?store=steam&appId=12345&title=Portal')
      .expect(503);

    expect(res.body).toMatchObject({
      code: 'no_key',
    });
  });

  it('отвечает 400 для неподдерживаемого магазина (в ошибке сервиса)', async () => {
    mockedGetPriceDynamics.mockRejectedValue(
      new PriceDynamicsError('unsupported_shop', 'Store vkplay is not supported')
    );

    const res = await request(app)
      .get('/api/price-dynamics?store=steam&appId=12345&title=Portal')
      .expect(400);

    expect(res.body).toMatchObject({
      code: 'unsupported_shop',
    });
  });

  it('отвечает 502 если ITAD не ответил', async () => {
    mockedGetPriceDynamics.mockRejectedValue(
      new PriceDynamicsError('upstream', 'ITAD lookup failed: Network error')
    );

    const res = await request(app)
      .get('/api/price-dynamics?store=steam&appId=12345&title=Portal')
      .expect(502);

    expect(res.body).toMatchObject({
      code: 'upstream',
    });
  });

  it('отвечает 500 на прочие ошибки', async () => {
    mockedGetPriceDynamics.mockRejectedValue(new Error('Unexpected error'));

    await request(app)
      .get('/api/price-dynamics?store=steam&appId=12345&title=Portal')
      .expect(500);
  });
});
