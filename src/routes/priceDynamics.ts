import { Router, Request, Response } from 'express';
import itadService, {
  PriceDynamicsError,
  type SupportedStore,
} from '../services/itadService.js';

const router = Router();

/**
 * GET /api/price-dynamics/status
 * Информация о поддержке функции динамики цен.
 * Всегда отвечает 200 с флагом enabled.
 */
router.get('/status', (req: Request, res: Response) => {
  const enabled = itadService.isFunctionEnabled();
  const supportedStores = itadService.getSupportedStores();

  res.json({
    enabled,
    country: process.env.ITAD_COUNTRY || 'RU',
    supportedStores,
    registerUrl: 'https://isthereanydeal.com/apps/my/',
    ...(enabled ? {} : {
      reminder: 'Register your API key at https://isthereanydeal.com/apps/my/ and add it to .env as ITAD_API_KEY',
    }),
  });
});

/**
 * GET /api/price-dynamics
 * Получить динамику цены игры на определённом магазине.
 * Параметры:
 * - store: 'steam' | 'gog' | 'epic' (обязателен)
 * - title: название игры (обязателен для всех)
 * - appId: Steam appId (опционален, для Steam)
 */
router.get('/', async (req: Request, res: Response) => {
  const store = typeof req.query.store === 'string' ? req.query.store.toLowerCase() : '';
  const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';

  // Validate store
  if (!store || !['steam', 'gog', 'epic'].includes(store)) {
    return res.status(400).json({
      error: 'Missing or unsupported store parameter',
      code: 'invalid_store',
    });
  }

  // Validate title for all stores
  if (!title) {
    return res.status(400).json({
      error: 'Missing title parameter',
      code: 'missing_title',
    });
  }

  // Parse appId: only accept if all digits and > 0, otherwise ignore
  let appId: number | undefined;
  if (req.query.appId) {
    const appIdStr = String(req.query.appId).trim();
    // Check if string consists only of digits and the number is > 0
    if (/^\d+$/.test(appIdStr)) {
      const parsed = Number.parseInt(appIdStr, 10);
      if (parsed > 0) {
        appId = parsed;
      }
    }
  }

  try {
    // For Steam: prefer appId if valid, otherwise use title
    // For GOG/Epic: use title
    const gameIdOrTitle = store === 'steam' && appId !== undefined ? appId : title;
    const dynamics = await itadService.getPriceDynamics(store as SupportedStore, gameIdOrTitle);

    res.json(dynamics);
  } catch (error) {
    if (error instanceof PriceDynamicsError) {
      if (error.code === 'no_key') {
        return res.status(503).json({
          error: error.message,
          code: error.code,
        });
      }

      if (error.code === 'not_found') {
        return res.status(404).json({
          error: error.message,
          code: error.code,
        });
      }

      if (error.code === 'unsupported_shop') {
        return res.status(400).json({
          error: error.message,
          code: error.code,
        });
      }

      if (error.code === 'upstream') {
        return res.status(502).json({
          error: error.message,
          code: error.code,
        });
      }
    }

    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
