import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma, resetDb } from '../helpers/db.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sql = readFileSync(
  path.join(root, 'prisma', 'migrations', '20261003000000_gog_cover_tiles', 'migration.sql'),
  'utf8'
);

const HASH = '5a4a5c397cdce1d6336ff3676f7f0272200c2b7beb2682a4650538994ccba82d';
const TILE = `https://images.gog-statics.com/${HASH}_product_tile_398.jpg`;

const covers = async () =>
  (await prisma.game.findMany({ orderBy: { title: 'asc' } })).map((g) => g.imageUrl);

describe('миграция обложек GOG', () => {
  beforeEach(resetDb);

  it('переводит оригиналы на плитку и не трогает остальное; повторный запуск ничего не меняет', async () => {
    const urls = [
      `https://images.gog-statics.com/${HASH}.png`,
      TILE,
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/header.jpg',
      null,
    ];
    await prisma.game.createMany({
      data: urls.map((imageUrl, i) => ({
        title: `Game ${i}`,
        normalizedTitle: `game ${i}`,
        slug: `game-${i}`,
        kind: 'game',
        imageUrl,
      })),
    });

    await prisma.$executeRawUnsafe(sql);
    const once = await covers();
    expect(once).toEqual([TILE, TILE, urls[2], null]);

    await prisma.$executeRawUnsafe(sql);
    expect(await covers()).toEqual(once);
  });
});
