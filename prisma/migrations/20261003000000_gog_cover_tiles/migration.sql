-- Разовая правка данных: оригиналы обложек GOG (<hash>.<ext>, до 1,8 МБ) заменяем
-- на лёгкую плитку <hash>_product_tile_398.jpg. Повторный запуск ничего не меняет:
-- у плитки в имени есть «_», и условие её уже не пропускает.
UPDATE "Game"
SET "imageUrl" = substr("imageUrl", 1, 31 + instr(substr("imageUrl", 32), '.') - 1) || '_product_tile_398.jpg'
WHERE "imageUrl" LIKE 'https://images.gog-statics.com/%'
  AND instr(substr("imageUrl", 32), '_') = 0
  AND instr(substr("imageUrl", 32), '/') = 0
  AND instr(substr("imageUrl", 32), '.') > 0;
