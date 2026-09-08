import axios from 'axios';
import prisma from '../database.js';

const CBR_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
const TTL_MS = 24 * 60 * 60 * 1000;

// Курсы получить не удалось — пробуем снова через 10 минут, а не на каждый вызов:
// иначе один прогон парсера (тысячи игр) превращается в тысячи запросов к ЦБ.
const FAILURE_TTL_MS = 10 * 60 * 1000;

/**
 * Сервис для конвертации иностранных валют в рубли.
 * Кэширует курсы ЦБ в памяти с fallback на БД при недоступности сервиса.
 */
export class CurrencyService {
  // Кэш в памяти процесса
  private memo: Map<string, number> | null = null;
  private memoAt = 0;

  // Дедупликация параллельных запросов к сервису
  private inflight: Promise<void> | null = null;

  // Текущий срок годности кэша: укорачивается, если курсы получить не удалось
  private ttl = TTL_MS;

  /**
   * Конвертирует сумму в иностранной валюте в рубли.
   * Возвращает null, если конвертация невозможна.
   */
  async toRub(
    amount: number | null | undefined,
    currency: string | null | undefined
  ): Promise<number | null> {
    // Если сумма не конечное число, возвращаем null
    if (!Number.isFinite(amount)) {
      return null;
    }

    // Нулевая сумма остаётся нулевой в любой валюте
    if (amount === 0) {
      return 0;
    }

    // Пустая валюта — невозможно конвертировать
    if (!currency) {
      return null;
    }

    const code = currency.toUpperCase();

    // Если валюта уже рубли, просто округляем до 2 знаков
    if (code === 'RUB') {
      return Math.round(amount * 100) / 100;
    }

    // Получаем курс валюты к рублю
    const rate = await this.getRate(code);
    if (rate === null) {
      return null;
    }

    // Конвертируем и округляем до 2 знаков
    return Math.round(amount * rate * 100) / 100;
  }

  /**
   * Получает курс конкретной валюты к рублю.
   * Гарантирует свежесть кэша перед возвращением.
   */
  async getRate(code: string): Promise<number | null> {
    // Обеспечиваем свежесть кэша
    await this.ensureRates();
    return this.memo?.get(code) ?? null;
  }

  /**
   * Гарантирует, что кэш курсов актуален.
   * При необходимости загружает свежие курсы с дедупликацией параллельных вызовов.
   */
  private async ensureRates(): Promise<void> {
    // Если кэш свежий, не трогаем сеть
    if (this.memo && Date.now() - this.memoAt < this.ttl) {
      return;
    }

    // Если загрузка уже идёт, дождаться её результата
    if (this.inflight) {
      await this.inflight;
      return;
    }

    // Иначе инициируем загрузку и дождаться её
    this.inflight = this.load();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /**
   * Загружает курсы ЦБ с HTTP или fallback на БД.
   * Не бросает исключений при ошибке — парсинг не должен падать из-за курсов.
   */
  private async load(): Promise<void> {
    // Пробуем прочитать кэшированные курсы из БД. Своя обёртка try/catch: до
    // первой миграции таблицы может не быть, и упасть здесь нельзя — падение
    // load() поднимется до toRub() и уронит весь прогон парсера.
    let cachedRates: { code: string; rate: number; fetchedAt: Date }[] = [];

    try {
      cachedRates = await prisma.exchangeRate.findMany();
    } catch (dbError) {
      console.warn('⚠️ Не удалось прочитать курсы из БД:', dbError);
    }

    if (cachedRates.length > 0) {
      // Проверяем, как давно были обновлены кэшированные курсы
      const mostRecentFetch = new Date(
        Math.max(...cachedRates.map((r) => r.fetchedAt.getTime()))
      );

      // Если записи в БД ещё свежие, используем их из кэша
      if (Date.now() - mostRecentFetch.getTime() < TTL_MS) {
        this.memo = new Map(cachedRates.map((r) => [r.code, r.rate]));
        this.memoAt = Date.now();
        this.ttl = TTL_MS;
        return;
      }
    }

    // Пробуем получить свежие курсы с сервиса ЦБ
    try {
      const response = await axios.get(CBR_URL, { timeout: 10000 });

      // Парсим ответ: { Valute: { USD: { CharCode: 'USD', Nominal: 1, Value: 95.12 }, ... } }
      const valute = response.data.Valute || {};
      const rates = new Map<string, number>();

      // Обрабатываем каждую валюту
      for (const [key, data] of Object.entries(valute)) {
        const valData = data as any;
        if (valData.CharCode && valData.Nominal && valData.Value) {
          // Курс = Value / Nominal (рублей за 1 единицу валюты)
          const rate = valData.Value / valData.Nominal;
          rates.set(valData.CharCode, rate);
        }
      }

      // Добавляем рубль (1 РУБ = 1 РУБ)
      rates.set('RUB', 1);

      // Сохраняем в БД (дедупликация по коду валюты)
      try {
        for (const [code, rate] of rates.entries()) {
          await prisma.exchangeRate.upsert({
            where: { code },
            update: { rate, fetchedAt: new Date() },
            create: { code, rate, fetchedAt: new Date() },
          });
        }
      } catch (dbError) {
        // Ошибка записи в БД — логируем, но продолжаем работать с памятью
        console.warn('⚠️ Не удалось сохранить курсы в БД:', dbError);
      }

      // Устанавливаем кэш в памяти
      this.memo = rates;
      this.memoAt = Date.now();
      this.ttl = TTL_MS;
    } catch (networkError) {
      // Ошибка при получении курсов с сервиса
      console.warn('⚠️ Не удалось получить курсы ЦБ:', networkError);

      // Fallback: просроченные записи из БД лучше, чем ничего. Если и их нет —
      // остаётся только рубль: цены в других валютах получат priceRub = null и
      // не попадут в сравнение по цене (но останутся в сравнении по скидке).
      this.memo =
        cachedRates.length > 0
          ? new Map(cachedRates.map((r) => [r.code, r.rate]))
          : new Map([['RUB', 1]]);

      // Кэш заведомо неполноценный — держим его недолго и пробуем сеть снова
      this.memoAt = Date.now();
      this.ttl = FAILURE_TTL_MS;
    }
  }

  /**
   * Обнуляет кэш. Нужен для тестов.
   */
  reset(): void {
    this.memo = null;
    this.memoAt = 0;
    this.inflight = null;
    this.ttl = TTL_MS;
  }
}

export default new CurrencyService();
