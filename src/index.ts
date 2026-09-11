// Должен идти первым импортом: модули парсеров читают process.env на этапе загрузки.
import 'dotenv/config';
import cron from 'node-cron';
import dotenv from 'dotenv';
import prisma from './database.js';
import { createApp } from './app.js';
import parserService from './services/parserService.js';

dotenv.config();

const app = createApp();
const PORT = process.env.PORT || 3000;

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
