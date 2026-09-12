import type { Express } from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import prisma from './database.js';
import parserService from './services/parserService.js';

export interface StartServerOptions {
  app: Express;
  port: number;
  /** Тесты биндят 127.0.0.1, прод слушает все интерфейсы. */
  host?: string;
  runOnStartup?: boolean;
  parser?: { parseAll(): Promise<unknown> };
  checkDb?: () => Promise<unknown>;
  onFatal?: (code: number) => void;
}

export interface StartedServer {
  server: Server;
  /**
   * Фоновый прогон парсеров. Промис уже с обработанным отказом: ждать его
   * нужно только тестам, чтобы прогон не утёк в следующий файл сюиты.
   */
  parsing: Promise<void>;
}

/** Понятный текст вместо голого стека Node — чаще всего это забытый второй экземпляр. */
function describeListenError(error: NodeJS.ErrnoException, port: number): string {
  switch (error.code) {
    case 'EADDRINUSE':
      return `❌ Порт ${port} уже занят — вероятно, запущен другой экземпляр. Освободите порт (lsof -i :${port}) или укажите другой: PORT=3001 npm run dev`;
    case 'EACCES':
      return `❌ Нет прав на порт ${port}. Выберите порт выше 1024 или укажите другой: PORT=3001 npm run dev`;
    default:
      return `❌ Не удалось открыть порт ${port}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function listen(
  app: Express,
  port: number,
  host: string | undefined,
  onFatal: (code: number) => void
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = host ? app.listen(port, host) : app.listen(port);
    let listening = false;

    // Подписка навешивается синхронно: без неё ошибка биндинга уходит
    // в unhandled 'error' и печатается стеком.
    server.on('error', (error: NodeJS.ErrnoException) => {
      console.error(describeListenError(error, port));
      // Ошибка у уже поднятого сервера не повод гасить процесс.
      if (listening) return;
      onFatal(1);
      reject(error);
    });

    server.once('listening', () => {
      listening = true;
      // При port: 0 реальный порт известен только сейчас.
      const actualPort = (server.address() as AddressInfo | null)?.port ?? port;

      console.log('\n' + '═'.repeat(50));
      console.log(`✨ Game Deals Monitor запущен на порту ${actualPort}`);
      console.log(`📍 http://localhost:${actualPort}`);
      console.log('═'.repeat(50) + '\n');

      resolve(server);
    });
  });
}

/**
 * Парсеры обходят площадки минутами, поэтому прогон уходит в фон: порт уже открыт,
 * API отвечает, данные подтягиваются по мере готовности.
 */
function startParsing(
  runOnStartup: boolean,
  parser: { parseAll(): Promise<unknown> }
): Promise<void> {
  if (!runOnStartup) {
    console.log('⏭️  Парсеры не запущены при старте (RUN_ON_STARTUP=false)\n');
    return Promise.resolve();
  }

  console.log('🚀 Парсеры запущены в фоне — API уже отвечает, данные появятся по мере готовности\n');

  // Обработчик отказа навешивается в том же тике, так что unhandled rejection невозможен.
  return parser.parseAll().then(
    () => {
      console.log('✅ Стартовый парсинг завершён');
    },
    (error) => {
      console.error(
        '⚠️  Стартовый парсинг завершился с ошибкой:',
        error instanceof Error ? error.message : String(error)
      );
    }
  );
}

export async function startServer({
  app,
  port,
  host,
  runOnStartup = true,
  parser = parserService,
  checkDb = () => prisma.$queryRaw`SELECT 1`,
  onFatal = (code: number) => process.exit(code),
}: StartServerOptions): Promise<StartedServer> {
  try {
    await checkDb();
    console.log('✅ База данных подключена');
  } catch (error) {
    // Без базы поднимать порт незачем: каждый запрос всё равно упадёт.
    console.error('❌ Ошибка при запуске:', error);
    onFatal(1);
    throw error;
  }

  const server = await listen(app, port, host, onFatal);

  return { server, parsing: startParsing(runOnStartup, parser) };
}

export default startServer;
