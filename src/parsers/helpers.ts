import { ParsedGame } from '../types.js';

/**
 * Пара (title, platform) в базе уникальна, поэтому одинаковые названия внутри одного
 * прогона схлопываем заранее — иначе одна и та же запись создаётся и тут же перезаписывается.
 *
 * Из дублей остаётся вариант с большей скидкой; при равенстве побеждает первый.
 */
export function dedupeByTitle(games: ParsedGame[]): ParsedGame[] {
  const byTitle = new Map<string, ParsedGame>();

  for (const game of games) {
    const key = game.title.toLowerCase();
    const existing = byTitle.get(key);

    if (!existing || game.discountPercent > existing.discountPercent) {
      byTitle.set(key, game);
    }
  }

  return [...byTitle.values()];
}

/** "1 999 руб." -> 1999, "$19.99" -> 19.99. */
export function parsePriceText(text?: string | null): number | undefined {
  if (!text) return undefined;

  const cleaned = text.replace(/[^\d.,]/g, '');
  if (!cleaned) return undefined;

  // Разделитель считаем десятичным, только если после него ровно две цифры.
  const decimal = cleaned.match(/^(.*)([.,])(\d{2})$/);
  const normalized = decimal
    ? `${decimal[1].replace(/[.,]/g, '')}.${decimal[3]}`
    : cleaned.replace(/[.,]/g, '');

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Разобрать наивную строку по московскому времени: "2031-02-23 00:00:00".
 * Такой формат отдаёт API VK Play.
 */
export function parseMoscowDate(raw?: string): Date | undefined {
  if (!raw) return undefined;

  const date = new Date(`${raw.replace(' ', 'T')}+03:00`);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
