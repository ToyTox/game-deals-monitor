import { Router, Request, Response } from 'express';
import steamWishlistService, {
  WishlistError,
  type WishlistItem,
} from '../services/steamWishlistService.js';

import prisma from '../database.js';
import { normalizeTitle } from '../lib/titleNormalizer.js';
import steamProfileService, { ProfileError } from '../services/steamProfileService.js';

const router = Router();

/** SQLite принимает не больше 999 параметров в запросе, поэтому ищем пачками. */
const LOOKUP_CHUNK = 400;

function chunked<T>(values: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += LOOKUP_CHUNK) {
    chunks.push(values.slice(i, i + LOOKUP_CHUNK));
  }
  return chunks;
}

/**
 * Slug игр из базы для позиций вишлиста: appId -> slug. Сначала по Steam-офферу
 * с тем же appId в gameUrl, для остальных — по нормализованному названию, как
 * в saveGames. Запросов столько же, сколько пачек, а не позиций.
 */
async function findSlugs(items: { appId: number; title: string }[]): Promise<Map<number, string>> {
  const slugs = new Map<number, string>();
  const wanted = new Set(items.map((item) => item.appId));

  for (const ids of chunked([...wanted])) {
    const offers = await prisma.offer.findMany({
      where: { storeId: 'steam', OR: ids.map((id) => ({ gameUrl: { contains: `/app/${id}` } })) },
      select: { gameUrl: true, game: { select: { slug: true } } },
      orderBy: { id: 'asc' },
    });

    for (const offer of offers) {
      // contains ловит и /app/12 внутри /app/123 — точный appId берём из ссылки
      const appId = Number(offer.gameUrl.match(/\/app\/(\d+)/)?.[1]);
      if (wanted.has(appId) && !slugs.has(appId)) {
        slugs.set(appId, offer.game.slug);
      }
    }
  }

  const byTitle = new Map<string, number[]>();
  for (const item of items) {
    if (slugs.has(item.appId)) continue;
    const key = normalizeTitle(item.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), item.appId]);
  }

  for (const keys of chunked([...byTitle.keys()])) {
    const games = await prisma.game.findMany({
      where: { normalizedTitle: { in: keys } },
      select: { normalizedTitle: true, slug: true },
    });

    for (const game of games) {
      for (const appId of byTitle.get(game.normalizedTitle) ?? []) {
        slugs.set(appId, game.slug);
      }
    }
  }

  return slugs;
}

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
 * GET /api/wishlist/profile
 * Аватар, имя и фон профиля Steam по SteamID64. Отдельным запросом, чтобы не замедлять вишлист.
 * При частичном сбое Steam в ответе есть `missing` — список не полученных частей (`avatar`, `background`).
 */
router.get('/profile', async (req: Request, res: Response) => {
  const steamId = typeof req.query.steamId === 'string' ? req.query.steamId.trim() : '';

  if (!/^\d{17}$/.test(steamId)) {
    return res.status(400).json({ error: 'Укажите SteamID64 (17 цифр) в параметре steamId' });
  }

  try {
    res.json(await steamProfileService.getProfile(steamId));
  } catch (error) {
    if (error instanceof ProfileError) {
      return res.status(502).json({ error: error.message, code: 'upstream' });
    }

    res.status(500).json({
      error: 'Ошибка при получении профиля Steam',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/wishlist/app/:appId
 * Одна игра Steam в форме GET /api/games/slug/:slug — для страницы игры, которой нет в базе.
 * Если игра в базе есть, в ответе её slug, и фронт переходит на обычную страницу.
 */
router.get('/app/:appId', async (req: Request, res: Response) => {
  if (!/^\d+$/.test(req.params.appId) || Number(req.params.appId) <= 0) {
    return res.status(400).json({ error: 'appId должен быть положительным числом' });
  }

  const appId = Number(req.params.appId);

  try {
    const app = await steamWishlistService.getApp(appId);
    const slug = (await findSlugs([app])).get(appId) ?? null;

    res.json({ ...app, slug });
  } catch (error) {
    if (error instanceof WishlistError) {
      const status = error.code === 'upstream' ? 502 : 404;
      return res.status(status).json({ error: error.message, code: error.code });
    }

    res.status(500).json({
      error: 'Ошибка при получении игры Steam',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

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

    // Slug подмешиваем в копии: items лежат в кэше сервиса, а slug в базе может смениться.
    const page = sorted.slice(offset, offset + limit);
    const slugs = await findSlugs(page);
    const games = page.map((item) => {
      const slug = slugs.get(item.appId);
      return slug ? { ...item, slug } : item;
    });

    res.json({
      games,
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
