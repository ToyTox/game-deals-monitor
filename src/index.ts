// Должен идти первым импортом: модули парсеров читают process.env на этапе загрузки.
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cron from 'node-cron';
import dotenv from 'dotenv';
import prisma from './database.js';
import gamesRouter from './routes/games.js';
import adminRouter from './routes/admin.js';
import parserService from './services/parserService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Статика лежит в корне проекта: src/ (tsx) и dist/ (node) — оба на уровень ниже
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Middleware
app.use(cors());
app.use(morgan('combined'));
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

// Scheduler - запуск парсеров по расписанию
const cronSchedule = process.env.CRON_SCHEDULE || '0 6 * * *';

console.log(`⏰ Расписание парсеров: "${cronSchedule}"`);

cron.schedule(cronSchedule, async () => {
  console.log('\n' + '═'.repeat(50));
  console.log('🔍 Запланированная проверка платформ...');
  console.log('═'.repeat(50));
  try {
    await parserService.parseAll();
  } catch (error) {
    console.error('❌ Ошибка при запланированной проверке:', error);
  }
});

// Запустить парсеры при старте (опционально)
const runOnStartup = process.env.RUN_ON_STARTUP !== 'false';

// Server startup
const startServer = async () => {
  try {
    // Проверить подключение к БД
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ База данных подключена');

    if (runOnStartup) {
      console.log('\n🚀 Запуск парсеров при старте...');
      await parserService.parseAll();
    } else {
      console.log('\n⏭️  Парсеры не запущены при старте (RUN_ON_STARTUP=false)');
    }

    app.listen(PORT, () => {
      console.log('\n' + '═'.repeat(50));
      console.log(`✨ Game Deals Monitor запущен на порту ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
      console.log('═'.repeat(50) + '\n');
    });
  } catch (error) {
    console.error('❌ Ошибка при запуске:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Выключение сервера...');
  await prisma.$disconnect();
  process.exit(0);
});

startServer();
