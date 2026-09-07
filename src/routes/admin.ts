import { Router, Request, Response } from 'express';
import gameService from '../services/gameService.js';
import parserService from '../services/parserService.js';

const router = Router();

/**
 * GET /api/admin/stats
 * Получить статистику
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await gameService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: 'Ошибка при получении статистики',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/updates
 * Получить логи обновлений
 */
router.get('/updates', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const logs = await gameService.getUpdateLogs(limit);
    res.json({
      logs,
      total: logs.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Ошибка при получении логов',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/parse
 * Запустить парсеры вручную
 */
router.post('/parse', async (req: Request, res: Response) => {
  try {
    const platform = req.body.platform as string | undefined;

    if (platform) {
      const result = await parserService.parsePlatform(platform);
      res.json({
        message: Парсер ${platform} успешно завершен,
        result,
      });
    } else {
      const results = await parserService.parseAll();
      res.json({
        message: 'Все парсеры успешно завершены',
        results,
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Ошибка при запуске парсеров',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/platforms
 * Получить список доступных платформ
 */
router.get('/platforms', (req: Request, res: Response) => {
  try {
    const platforms = parserService.getAvailablePlatforms();
    res.json({
      platforms,
      total: platforms.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Ошибка при получении платформ',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/health
 * Проверка здоровья API
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime(),
  });
});

export default router;
