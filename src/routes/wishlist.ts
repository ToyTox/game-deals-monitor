import { Router, Request, Response } from 'express';
import steamWishlistService, {
  WishlistError,
  type WishlistItem,
} from '../services/steamWishlistService.js';

const router = Router();

/**
 * Сортировки списка желаемого. Ключи первых пяти совпадают с GAME_SORTS в gameService,
 * чтобы селект на фронте был одинаковым для всех разделов; added и priority — свои,
 * их даёт только вишлист.
 *
 * Вторым ключом везде идёт appId: без него позиции с одинаковой скидкой меняются
 * местами между запросами, и при листании карточки дублируются или пропадают.
 */
const WISHLIST_SORTS = {
  discount: (a, b) => b.discountPercent - a.discountPercent,
  price_asc: (a, b) => nullsLast(a.currentPrice, b.currentPrice),
  price_desc: (a, b) => nullsLast(a.currentPrice, b.currentPrice, true),
  title: (a, b) => a.title.localeCompare(b.title, 'ru'),
  ending: (a, b) => nullsLast(ms(a.saleEndDate), ms(b.saleEndDate)),
  added: (a, b) => (ms(b.addedAt) ?? 0) - (ms(a.addedAt) ?? 0),
  priority: (a, b) => (a.priority || Number.MAX_SAFE_INTEGER) - (b.priority || Number.MAX_SAFE_INTEGER),
} satisfies Record<string, (a: WishlistItem, b: WishlistItem) => number>;

export type WishlistSort = keyof typeof WISHLIST_SORTS;

export const DEFAULT_WISHLIST_SORT: WishlistSort = 'discount';

function isWishlistSort(value: unknown): value is WishlistSort {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WISHLIST_SORTS, value);
}

function ms(date: Date | null): number | null {
  return date ? date.getTime() : null;
}

/**
 * Позиции без цены и без даты всегда в конце, в какую сторону ни сортируй.
 * Пустым считается только null: цена 0 — это бесплатная игра, полноправное значение.
 */
function nullsLast(left: number | null, right: number | null, descending = false): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  return descending ? right - left : left - right;
}

function parseCount(raw: unknown, fallback: number): number {
  const value = Number.parseInt(String(raw), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * GET /api/wishlist
 * Список желаемого Steam по SteamID, ссылке на профиль или нику.
 */
router.get('/', async (req: Request, res: Response) => {
  const user = typeof req.query.user === 'string' ? req.query.user.trim() : '';

  if (!user) {
    return res.status(400).json({
      error: 'Укажите SteamID, ссылку на профиль или ник в параметре user',
    });
  }

  // Фильтр включён по умолчанию: блок существует ради скидок, а не ради всего вишлиста.
  const onlyDiscounted = req.query.onlyDiscounted !== 'false';
  const sort = isWishlistSort(req.query.sort) ? req.query.sort : DEFAULT_WISHLIST_SORT;
  const limit = parseCount(req.query.limit, 12);
  const offset = parseCount(req.query.offset, 0);

  try {
    const wishlist = await steamWishlistService.getWishlist(user);

    const discountedTotal = wishlist.items.filter((item) => item.discountPercent > 0).length;
    const unavailableTotal = wishlist.items.filter((item) => item.unavailable).length;

    const filtered = onlyDiscounted
      ? wishlist.items.filter((item) => item.discountPercent > 0)
      : wishlist.items;

    // Копия: sort правит массив на месте, а items лежат в кэше сервиса.
    const sorted = [...filtered].sort(
      (a, b) => WISHLIST_SORTS[sort](a, b) || a.appId - b.appId
    );

    res.json({
      games: sorted.slice(offset, offset + limit),
      total: sorted.length,
      limit,
      offset,
      sort,
      steamId: wishlist.steamId,
      wishlistTotal: wishlist.wishlistTotal,
      discountedTotal,
      unavailableTotal,
      truncated: wishlist.truncated,
    });
  } catch (error) {
    if (error instanceof WishlistError) {
      // not_found и empty_or_private — это «по такому вводу показать нечего», то есть 404.
      // upstream — Steam не ответил, наша вина нулевая: 502.
      const status = error.code === 'upstream' ? 502 : 404;
      return res.status(status).json({ error: error.message, code: error.code });
    }

    res.status(500).json({
      error: 'Ошибка при получении списка желаемого',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
