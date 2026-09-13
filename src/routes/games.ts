import { Router, Request, Response } from "express";
import gameService from "../services/gameService.js";
import parserService from "../services/parserService.js";

const router = Router();

/**
 * Платформы из query: `?platform=steam,gog` или повторённый `?platform=steam&platform=gog`
 * (Express отдаёт его массивом). Регистр не важен, пустые значения и дубли отбрасываются.
 */
function parsePlatforms(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const platforms = values
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(platforms)];
}

/**
 * GET /api/games
 * Получить все игры со фильтрацией
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const platform = parsePlatforms(req.query.platform);
    const sort = typeof req.query.sort === "string" ? req.query.sort : undefined;
    const minDiscount = req.query.minDiscount
      ? parseInt(req.query.minDiscount as string)
      : undefined;
    // free=true — только бесплатные, free=false — только платные, без параметра — всё подряд
    const freeOnly = req.query.free === "true";
    const excludeFree = req.query.free === "false";
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const result = await gameService.getGames({
      platform,
      minDiscount,
      freeOnly,
      excludeFree,
      sort,
      limit,
      offset,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: "Ошибка при получении игр",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/games/free
 * Получить только бесплатные игры
 */
router.get("/free", async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const games = await gameService.getFreeGames(limit);
    res.json({
      games,
      total: games.length,
    });
  } catch (error) {
    res.status(500).json({
      error: "Ошибка при получении бесплатных игр",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/games/top-discounts
 * Получить топ скидок
 */
router.get("/top-discounts", async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const games = await gameService.getTopDiscounts(limit);
    res.json({
      games,
      total: games.length,
    });
  } catch (error) {
    res.status(500).json({
      error: "Ошибка при получении топ скидок",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/games/platform/:name
 * Получить игры по платформе
 */
router.get("/platform/:name", async (req: Request, res: Response) => {
  try {
    const platform = req.params.name.toLowerCase();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

    const games = await gameService.getByPlatform(platform, limit);
    res.json({
      platform,
      games,
      total: games.length,
    });
  } catch (error) {
    res.status(500).json({
      error: "Ошибка при получении игр платформы",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/games/search
 * Поиск игр по названию
 */
router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = req.query.q;

    if (typeof query !== "string" || query.length < 2) {
      return res.status(400).json({
        error: "Укажите поисковый запрос (минимум 2 символа)",
      });
    }

    const games = await gameService.search(query);
    res.json({
      query,
      games,
      total: games.length,
    });
  } catch (error) {
    res.status(500).json({
      error: "Ошибка при поиске",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/games/:title
 * Получить одну игру и ее историю цен
 */
router.get("/:title", async (req: Request, res: Response) => {
  try {
    const game = await gameService.getByTitle(req.params.title);

    if (!game) {
      return res.status(404).json({
        error: "Игра не найдена",
      });
    }

    res.json(game);
  } catch (error) {
    res.status(500).json({
      error: "Ошибка при получении игры",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/games/:title/price-history
 * Получить историю цены для игры
 */
router.get("/:title/price-history", async (req: Request, res: Response) => {
  try {
    const { currency, history } = await gameService.getPriceHistory(req.params.title);
    res.json({
      game: req.params.title,
      currency,
      history,
      total: history.length,
    });
  } catch (error) {
    res.status(404).json({
      error: "Игра не найдена",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
