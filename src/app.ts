import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import gamesRouter from './routes/games.js';
import adminRouter from './routes/admin.js';

// Статика лежит в корне проекта: src/ (tsx) и dist/ (node) — оба на уровень ниже
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * Собрать Express-приложение без побочных эффектов: ни listen, ни cron.
 * Запуском занимается index.ts, а тесты монтируют то же самое приложение.
 */
export function createApp(): express.Express {
  const app = express();

  // Middleware
  app.use(cors());
  // В тестах лог каждого запроса забивает вывод сюиты.
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }
  app.use(express.json());

  // Веб-интерфейс (должен идти до роутеров, чтобы "/" отдавал index.html)
  app.use(express.static(PUBLIC_DIR));

  // Routes
  app.use('/api/games', gamesRouter);
  app.use('/api/admin', adminRouter);

  // Root endpoint
  app.get('/api', (req, res) => {
    res.json({
      name: 'Game Deals Monitor API',
      version: '1.0.0',
      description: 'API для мониторинга скидок и бесплатных игр',
      endpoints: {
        ui: '/',
        games: '/api/games',
        freeGames: '/api/games/free',
        topDiscounts: '/api/games/top-discounts',
        platformGames: '/api/games/platform/:name',
        search: '/api/games/search?q=query',
        singleGame: '/api/games/:title',
        stats: '/api/admin/stats',
        updates: '/api/admin/updates',
        manualParse: '/api/admin/parse (POST)',
        platforms: '/api/admin/platforms',
        health: '/api/admin/health',
      },
    });
  });

  // Error handling
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('🔴 Ошибка:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
    });
  });

  return app;
}

export default createApp;
