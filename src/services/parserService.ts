import { BaseParser } from '../parsers/BaseParsers.js';
import SteamParser from '../parsers/steamParser.js';
import EpicParser from '../parsers/epicParser.js';
import GOGParser from '../parsers/gogParser.js';
import { UpdateResult } from '../types.js';

export class ParserService {
  private parsers: BaseParser[] = [];

  constructor() {
    this.parsers = [
      new SteamParser(),
      new EpicParser(),
      new GOGParser(),
    ];
  }

  async parseAll(): Promise<UpdateResult[]> {
    console.log('🚀 Запуск всех парсеров...');
    const startTime = Date.now();

    try {
      const results = await Promise.allSettled(
        this.parsers.map((parser) => parser.run())
      );

      const successResults: UpdateResult[] = [];
      const errors: string[] = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successResults.push(result.value);
        } else {
          errors.push(
            ${this.parsers[index].constructor.name}: ${result.reason.message}
          );
        }
      });

      const duration = Date.now() - startTime;

      console.log('━'.repeat(50));
      console.log('📊 ИТОГИ ОБНОВЛЕНИЯ:');
      console.log('━'.repeat(50));

      let totalGames = 0;
      let totalNew = 0;
      let totalUpdated = 0;
      let totalFreed = 0;

      for (const result of successResults) {
        console.log(  ${result.platform.toUpperCase()}: ${result.total} игр);
        console.log(    ├─ Новых: ${result.new});
        console.log(    ├─ Обновлено: ${result.updated});
        console.log(    └─ В бесплатные: ${result.freed});

        totalGames += result.total;
        totalNew += result.new;
        totalUpdated += result.updated;
        totalFreed += result.freed;
      }

      console.log('━'.repeat(50));
      console.log(✅ Всего обработано: ${totalGames} игр);
      console.log(   Новых: ${totalNew}, Обновлено: ${totalUpdated}, Освобождено: ${totalFreed});
      console.log(⏱️  Время выполнения: ${duration}ms);

      if (errors.length > 0) {
        console.log('\n⚠️  Ошибки:');
        errors.forEach((error) => console.log(  - ${error}));
      }

      console.log('━'.repeat(50));

      return successResults;
    } catch (error) {
      console.error('❌ Критическая ошибка при запуске парсеров:', error);
      throw error;
    }
  }

  async parsePlatform(platform: string): Promise<UpdateResult> {
    const parser = this.parsers.find(
      (p) => p.constructor.name.toLowerCase().includes(platform.toLowerCase())
    );

    if (!parser) {
      throw new Error(Парсер для платформы ${platform} не найден);
    }

    return parser.run();
  }

  getAvailablePlatforms(): string[] {
    return this.parsers.map((p) => {
      const name = p.constructor.name;
      return name.replace('Parser', '').toLowerCase();
    });
  }
}

export default new ParserService();
