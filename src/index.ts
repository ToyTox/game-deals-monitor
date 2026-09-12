// Должен идти первым импортом: модули парсеров читают process.env на этапе загрузки.
import 'dotenv/config';
import cron from 'node-cron';
import prisma from './database.js';
import { createApp } from './app.js';
import { startServer } from './server.js';
import parserService from './services/parserService.js';

const app = createApp();
const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 3000;

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

// Graceful shutdown — регистрируется до старта, чтобы Ctrl-C работал уже во время проверки БД.
process.on('SIGINT', async () => {
  console.log('\n\n👋 Выключение сервера...');
  await prisma.$disconnect();
  process.exit(0);
});

startServer({ app, port: PORT, runOnStartup, parser: parserService }).catch(() => {
  // Сообщение уже напечатано в startServer, выход — через onFatal.
});
