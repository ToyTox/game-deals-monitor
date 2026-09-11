import { describe, it, expect } from 'vitest';
import { dedupeByTitle, parseMoscowDate, parsePriceText } from '../../src/parsers/helpers.js';
import { ParsedGame } from '../../src/types.js';

function game(title: string, discountPercent: number): ParsedGame {
  return {
    title,
    platform: 'steam',
    discountPercent,
    isFree: false,
    gameUrl: `https://example.test/${title}`,
  };
}

describe('parsePriceText', () => {
  it('убирает валюту и разделитель тысяч', () => {
    expect(parsePriceText('1 999 руб.')).toBe(1999);
    expect(parsePriceText('2 199')).toBe(2199);
    expect(parsePriceText('0')).toBe(0);
  });

  it('считает разделитель десятичным только перед двумя цифрами', () => {
    expect(parsePriceText('$19.99')).toBe(19.99);
    expect(parsePriceText('1 999,00 ₽')).toBe(1999);
    expect(parsePriceText('1,234.56')).toBe(1234.56);
  });

  // Оба случая — корректное поведение, а не баг: именно правило «ровно две
  // цифры после разделителя» делает '1.999' тысячей девятьюстами, что и нужно
  // для российских цен Steam.
  it("трактует '1.999' как 1999, а не как 1.999", () => {
    expect(parsePriceText('1.999')).toBe(1999);
  });

  it("трактует '19,9' как 199: одна цифра после запятой — не десятичная часть", () => {
    expect(parsePriceText('19,9')).toBe(199);
  });

  it('возвращает undefined, когда цифр нет', () => {
    expect(parsePriceText('')).toBeUndefined();
    expect(parsePriceText(null)).toBeUndefined();
    expect(parsePriceText(undefined)).toBeUndefined();
    expect(parsePriceText('руб.')).toBeUndefined();
    expect(parsePriceText('—')).toBeUndefined();
  });
});

describe('dedupeByTitle', () => {
  it('из дублей оставляет вариант с большей скидкой', () => {
    const result = dedupeByTitle([game('Portal', 30), game('Portal', 75), game('Portal', 50)]);

    expect(result).toHaveLength(1);
    expect(result[0].discountPercent).toBe(75);
  });

  it('схлопывает названия без учёта регистра', () => {
    const result = dedupeByTitle([game('PORTAL', 10), game('portal', 20)]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('portal');
  });

  // Сравнение через `>`, а не `>=`: при равных скидках побеждает первый.
  it('при равной скидке оставляет первый встреченный вариант', () => {
    const result = dedupeByTitle([game('Portal', 50), game('PORTAL', 50)]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Portal');
  });

  it('сохраняет порядок первого вхождения и не трогает разные названия', () => {
    const result = dedupeByTitle([game('Portal', 10), game('Half-Life', 20), game('Portal', 90)]);

    expect(result.map((g) => g.title)).toEqual(['Portal', 'Half-Life']);
    expect(result[0].discountPercent).toBe(90);
  });

  it('на пустом списке возвращает пустой', () => {
    expect(dedupeByTitle([])).toEqual([]);
  });
});

describe('parseMoscowDate', () => {
  // Проверяем именно ISO-строку: она доказывает, что смещение +03:00 применено,
  // и тест не зависит от таймзоны машины, на которой идёт прогон.
  it('трактует наивную строку как московское время', () => {
    expect(parseMoscowDate('2031-02-23 00:00:00')?.toISOString()).toBe(
      '2031-02-22T21:00:00.000Z'
    );
  });

  it('возвращает undefined для пустой строки и мусора', () => {
    expect(parseMoscowDate('')).toBeUndefined();
    expect(parseMoscowDate(undefined)).toBeUndefined();
    expect(parseMoscowDate('не дата')).toBeUndefined();
  });
});
