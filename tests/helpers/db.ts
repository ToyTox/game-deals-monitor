import prisma from '../../src/database.js';

export { prisma };

/**
 * Чистка между тестами.
 *
 * Удаляем детей явно, а не полагаемся на ON DELETE CASCADE: включает ли
 * адаптер better-sqlite3 PRAGMA foreign_keys — не проверено, а три запроса
 * стоят около миллисекунды.
 *
 * Автоинкрементные id при этом продолжают расти (deleteMany не трогает
 * sqlite_sequence), поэтому в тестах нельзя проверять литеральный id.
 */
export async function resetDb() {
  await prisma.priceHistory.deleteMany();
  await prisma.game.deleteMany();
  await prisma.updateLog.deleteMany();
}
