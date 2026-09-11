import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, '.tmp', 'test.db');

const wipe = () => ['', '-shm', '-wal'].forEach((suffix) => rmSync(dbPath + suffix, { force: true }));

export async function setup() {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  wipe();

  // src/generated/ в .gitignore — на свежем клоне клиента Prisma нет вообще.
  if (!existsSync(path.join(root, 'src/generated/prisma/client.ts'))) {
    execFileSync('npx', ['prisma', 'generate'], { cwd: root, stdio: 'inherit' });
  }

  // Схему накатываем миграциями, а не db push: тесты должны видеть ровно тот
  // DDL, который получает продакшен, иначе расхождение схем останется незамеченным.
  // globalSetup идёт в ГЛАВНОМ процессе, где test.env ещё не применён,
  // поэтому DATABASE_URL передаём подпроцессу явно.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });
}

export async function teardown() {
  wipe();
}
