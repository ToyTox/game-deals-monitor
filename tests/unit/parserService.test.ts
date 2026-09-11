import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParserService } from '../../src/services/parserService.js';
import { UpdateResult } from '../../src/types.js';

// Имя класса важно: parsePlatform ищет парсер по constructor.name.
const { runs } = vi.hoisted(() => ({
  runs: {
    steam: vi.fn(),
    epic: vi.fn(),
    gog: vi.fn(),
    vkplay: vi.fn(),
  },
}));

vi.mock('../../src/parsers/steamParsers.js', () => {
  class SteamParser {
    run = runs.steam;
  }
  return { default: SteamParser, SteamParser };
});

vi.mock('../../src/parsers/epicParsers.js', () => {
  class EpicParser {
    run = runs.epic;
  }
  return { default: EpicParser, EpicParser };
});

vi.mock('../../src/parsers/gogParsers.js', () => {
  class GOGParser {
    run = runs.gog;
  }
  return { default: GOGParser, GOGParser };
});

vi.mock('../../src/parsers/vkPlayParsers.js', () => {
  class VkPlayParser {
    run = runs.vkplay;
  }
  return { default: VkPlayParser, VkPlayParser };
});

function result(platform: string): UpdateResult {
  return { platform, total: 1, new: 1, updated: 0, freed: 0 } as UpdateResult;
}

describe('ParserService', () => {
  beforeEach(() => {
    for (const [platform, run] of Object.entries(runs)) {
      run.mockReset().mockResolvedValue(result(platform));
    }
  });

  describe('getAvailablePlatforms', () => {
    it('выводит названия площадок из имён классов', () => {
      expect(new ParserService().getAvailablePlatforms()).toEqual([
        'steam',
        'epic',
        'gog',
        'vkplay',
      ]);
    });
  });

  describe('parsePlatform', () => {
    it('запускает парсер нужной площадки и только его', async () => {
      await new ParserService().parsePlatform('gog');

      expect(runs.gog).toHaveBeenCalledOnce();
      expect(runs.steam).not.toHaveBeenCalled();
    });

    it('ищет площадку без учёта регистра', async () => {
      await new ParserService().parsePlatform('VKPLAY');

      expect(runs.vkplay).toHaveBeenCalledOnce();
    });

    it('на неизвестной площадке бросает понятную ошибку', async () => {
      await expect(new ParserService().parsePlatform('nope')).rejects.toThrow(
        'Парсер для платформы nope не найден'
      );
    });

    /**
     * Зафиксировано текущее поведение: поиск идёт подстрокой по имени класса,
     * поэтому любой мусор, входящий в 'steamparser', запускает парсер Steam.
     * Для реальных вызывающих ничего не сломано ({platform:'steam'} работает),
     * но случайный вызов с мусором молча спарсит не то, что просили.
     */
    it('БУДУЩИЙ БАГФИКС: подстрочный поиск ловит мусор вроде "p" или "ar"', async () => {
      const service = new ParserService();

      await service.parsePlatform('p');
      await service.parsePlatform('ar');

      expect(runs.steam).toHaveBeenCalledTimes(2);
    });

    it.todo('сопоставлять площадку точно, по getAvailablePlatforms()');
  });

  describe('parseAll', () => {
    it('возвращает результаты всех парсеров', async () => {
      const results = await new ParserService().parseAll();

      expect(results.map((r) => r.platform)).toEqual(['steam', 'epic', 'gog', 'vkplay']);
    });

    // На этом держится устойчивость крона: падение одной площадки
    // не должно отменять сохранение остальных.
    it('падение одного парсера не отменяет остальные', async () => {
      runs.epic.mockRejectedValue(new Error('epic упал'));

      const results = await new ParserService().parseAll();

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.platform)).toEqual(['steam', 'gog', 'vkplay']);
    });

    it('не бросает исключение, даже если упали все', async () => {
      for (const run of Object.values(runs)) {
        run.mockRejectedValue(new Error('всё плохо'));
      }

      await expect(new ParserService().parseAll()).resolves.toEqual([]);
    });

    /**
     * Зафиксировано текущее поведение: сборка списка ошибок читает
     * result.reason.message без проверки, поэтому отказ без причины
     * (Promise.reject() без аргумента) роняет parseAll целиком —
     * вместе с уже успешно отработавшими площадками.
     */
    it('БУДУЩИЙ БАГФИКС: отказ без причины роняет parseAll целиком', async () => {
      runs.epic.mockRejectedValue(undefined);

      await expect(new ParserService().parseAll()).rejects.toThrow();
    });
  });
});
