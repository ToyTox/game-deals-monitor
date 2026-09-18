import { describe, it, expect } from 'vitest';
import { normalizeTitle, slugify } from '../../src/lib/titleNormalizer.js';

describe('normalizeTitle', () => {
  const testCases = [
    ['The Witcher 3: Wild Hunt', 'the witcher 3 wild hunt'],
    ['The Witcher® 3: Wild Hunt', 'the witcher 3 wild hunt'],
    ['The Witcher 3: Wild Hunt - Game of the Year Edition', 'the witcher 3 wild hunt'],
    ['DOOM Eternal (Standard Edition)', 'doom eternal'],
    ['Final Fantasy VII Remake', 'final fantasy 7 remake'],
    ['Final Fantasy II', 'final fantasy 2'],
    ['Final Fantasy III', 'final fantasy 3'],
    ['Final Fantasy IV', 'final fantasy 4'],
    ['Final Fantasy V', 'final fantasy 5'],
    ['Final Fantasy VI', 'final fantasy 6'],
    ['Final Fantasy VII', 'final fantasy 7'],
    ['Final Fantasy VIII', 'final fantasy 8'],
    ['Final Fantasy IX', 'final fantasy 9'],
    ['Final Fantasy X', 'final fantasy 10'],
    ['Final Fantasy XI', 'final fantasy 11'],
    ['Final Fantasy XII', 'final fantasy 12'],
    ['Command & Conquer', 'command and conquer'],
    ['Ведьмак 3: Дикая Охота', 'ведьмак 3 дикая охота'],
    ['  Portal   2  ', 'portal 2'],
    ['Diablo® II: Resurrected™', 'diablo 2 resurrected'],
    ['Dead Space™ Remake', 'dead space remake'],
    ['Max Payne 3 Ultimate Edition', 'max payne 3'],
    ['The Elder Scrolls V: Skyrim', 'the elder scrolls 5 skyrim'],
  ];

  testCases.forEach(([input, expected]) => {
    it(`нормализует "${input}" в "${expected}"`, () => {
      expect(normalizeTitle(input)).toBe(expected);
    });
  });

  it('разные написания одной игры дают одинаковый ключ', () => {
    const title1 = normalizeTitle('The Witcher® 3: Wild Hunt');
    const title2 = normalizeTitle('The Witcher 3: Wild Hunt — Complete Edition');
    expect(title1).toBe(title2);
  });

  it('fallback: строка из пунктуации не даёт пустую строку', () => {
    expect(normalizeTitle('!!!')).not.toBe('');
    expect(normalizeTitle('###')).not.toBe('');
    expect(normalizeTitle('...')).not.toBe('');
  });

  // Названия без единого значимого символа ключом стать не могут. Отдаём пустую
  // строку честно, а отсев такого мусора — на стороне сохранения в БД.
  it('пустая строка даёт пустой ключ', () => {
    expect(normalizeTitle('')).toBe('');
  });

  it('строка из одних пробелов даёт пустой ключ', () => {
    expect(normalizeTitle('   ')).toBe('');
  });

  it('сохраняет цифры в названии', () => {
    expect(normalizeTitle('2K Launcher')).toContain('2k');
  });

  it('убирает лишние пробелы', () => {
    expect(normalizeTitle('The  Witcher   3')).toBe('the witcher 3');
  });

  it('обрабатывает Unicode нормализацию', () => {
    // Тест на NFKD нормализацию (например, полная форма на половинчатую)
    const result = normalizeTitle('ﬁnale');
    expect(result).toBeTruthy();
  });
});

describe('slugify', () => {
  const testCases = [
    ['The Witcher 3: Wild Hunt', 'the-witcher-3-wild-hunt'],
    ['Ведьмак 3', 'vedmak-3'],
    ['The Witcher 3: Wild Hunt - Game of the Year Edition', 'the-witcher-3-wild-hunt'],
    ['DOOM Eternal', 'doom-eternal'],
    ['Command & Conquer', 'command-and-conquer'],
  ];

  testCases.forEach(([input, expected]) => {
    it(`слаганизует "${input}" в "${expected}"`, () => {
      expect(slugify(input)).toBe(expected);
    });
  });

  it('результат не содержит пробелов', () => {
    const result = slugify('The Witcher 3: Wild Hunt');
    expect(result).not.toContain(' ');
  });

  it('результат не начинается на дефис', () => {
    const result = slugify('The Witcher 3');
    expect(result[0]).not.toBe('-');
  });

  it('результат не заканчивается на дефис', () => {
    const result = slugify('The Witcher 3');
    expect(result[result.length - 1]).not.toBe('-');
  });

  it('результат не содержит повторные дефисы', () => {
    expect(slugify('The Witcher 3')).not.toMatch(/--/);
  });

  it('пустой/мусорный ввод даёт непустую строку', () => {
    expect(slugify('!!!')).not.toBe('');
    expect(slugify('   ')).not.toBe('');
    expect(slugify('')).not.toBe('');
  });

  it('fallback на "game" при пустом результате', () => {
    expect(slugify('!!!')).toBe('game');
  });

  it('трансглитерирует кириллицу в латиницу', () => {
    const result = slugify('Ведьмак');
    expect(result).toBe('vedmak');
  });

  it('трансглитерирует сложные слова кириллицей', () => {
    expect(slugify('Ёлка')).toContain('elka');
    expect(slugify('Чебурашка')).toContain('cheburashka');
    expect(slugify('Щелкунчик')).toContain('schelkunchik');
  });

  it('смешанная кириллица и латиница преобразуется корректно', () => {
    const result = slugify('The Ведьмак 3');
    expect(result).toBeTruthy();
    expect(result).not.toContain(' ');
  });

  it('цифры сохраняются в слаге', () => {
    const result = slugify('The Witcher 3');
    expect(result).toContain('3');
  });

  it('амперсанд преобразуется в "and"', () => {
    const result = slugify('Command & Conquer');
    expect(result).toContain('and');
  });
});
