import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Относительно этого файла, а не process.cwd(): рабочий каталог у прогона
// может отличаться, а расположение фикстур — нет.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function readFixture(name: string): string {
  return readFileSync(path.join(dir, name), 'utf8');
}

export function readJsonFixture<T = unknown>(name: string): T {
  return JSON.parse(readFixture(name)) as T;
}
