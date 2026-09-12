import { describe, it, expect, vi, afterEach } from 'vitest';
import net from 'net';
import type { Server } from 'http';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { startServer, type StartServerOptions } from '../../src/server.js';

/**
 * Порт, парсер и проверка БД приходят опциями, поэтому RUN_ON_STARTUP и
 * DATABASE_URL из env-блока vitest.config.ts на этот файл не влияют.
 *
 * Слушающие сокеты закрываются в afterEach, а не в конце теста: при
 * pool: 'forks' + singleFork один забытый хендл подвешивает весь прогон,
 * а упавшая проверка пропустила бы остаток тела теста.
 */
const opened: { close(cb?: () => void): unknown }[] = [];

afterEach(async () => {
  await Promise.all(
    opened.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

async function start(overrides: Partial<StartServerOptions> = {}) {
  const started = await startServer({
    app: createApp(),
    port: 0,
    host: '127.0.0.1',
    checkDb: async () => undefined,
    parser: { parseAll: vi.fn(async () => []) },
    onFatal: vi.fn(),
    ...overrides,
  });

  opened.push(started.server);
  return started;
}

/** Занять свободный порт, чтобы воспроизвести EADDRINUSE. */
async function occupyPort(): Promise<number> {
  const blocker = net.createServer();
  opened.push(blocker);

  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));

  return (blocker.address() as net.AddressInfo).port;
}

describe('startServer', () => {
  // Ради этого всё и затевалось: раньше listen вызывался после await parseAll(),
  // и порт молчал все минуты обхода площадок.
  it('открывает порт, не дожидаясь конца парсинга', async () => {
    let finishParse!: () => void;
    const parseAll = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishParse = resolve;
        })
    );

    const { server, parsing } = await start({ parser: { parseAll } });

    await request(server).get('/api').expect(200);
    expect(parseAll).toHaveBeenCalledTimes(1);

    finishParse();
    await parsing;
  });

  it('падение фонового парсинга не роняет сервер', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFatal = vi.fn();
    const parseAll = vi.fn(async () => {
      throw new Error('сеть недоступна');
    });

    const { server, parsing } = await start({ parser: { parseAll }, onFatal });

    await expect(parsing).resolves.toBeUndefined();
    expect(onFatal).not.toHaveBeenCalled();
    await request(server).get('/api').expect(200);
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('Стартовый парсинг');
  });

  it('про занятый порт сообщает понятно, без стека Node', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await occupyPort();
    const onFatal = vi.fn();
    const parseAll = vi.fn(async () => []);

    await expect(start({ port, onFatal, parser: { parseAll } })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });

    expect(onFatal).toHaveBeenCalledWith(1);
    expect(parseAll).not.toHaveBeenCalled();

    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain(String(port));
    expect(logged).toContain('PORT=');
    expect(logged).not.toContain('setupListenHandle');
  });

  it('без базы не открывает порт и сигналит о выходе с кодом 1', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFatal = vi.fn();
    const parseAll = vi.fn(async () => []);

    await expect(
      start({ checkDb: async () => Promise.reject(new Error('db down')), onFatal, parser: { parseAll } })
    ).rejects.toThrow('db down');

    expect(onFatal).toHaveBeenCalledWith(1);
    expect(parseAll).not.toHaveBeenCalled();
  });

  it('с runOnStartup: false парсеры не запускаются, сервер отвечает', async () => {
    const parseAll = vi.fn(async () => []);

    const { server, parsing } = await start({ runOnStartup: false, parser: { parseAll } });

    await parsing;
    expect(parseAll).not.toHaveBeenCalled();
    await request(server).get('/api').expect(200);
  });
});
