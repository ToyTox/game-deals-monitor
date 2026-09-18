/**
 * Нормализация названий игр для сопоставления между магазинами и создания URL-friendly слагов.
 */

/**
 * Нормализует название игры в ключ для сопоставления между магазинами.
 * Убирает символы брендинга, издания, переводит римские цифры, нормализует пунктуацию.
 */
export function normalizeTitle(title: string): string {
  // Символы товарных знаков снимаем ДО NFKD: разложение превращает ™ в буквы
  // «TM», и «Dead Space™» стало бы «dead spacetm».
  let normalized = title.replace(/[®™©]/g, ' ');

  // Применяем NFKD нормализацию Unicode (разложение составных символов)
  normalized = normalized.normalize('NFKD');

  // Комбинирующие диакритические знаки, оставшиеся после разложения, удаляем
  // именно пустой строкой: замена на пробел разорвала бы слово изнутри
  // («Pokémon» → «pok e mon», «Ёлка» → «е лка»).
  normalized = normalized.replace(/\p{M}/gu, '');

  // Приводим к нижнему регистру
  normalized = normalized.toLowerCase();

  // Убираем содержимое круглых и квадратных скобок вместе со скобками
  normalized = normalized.replace(/[([][^)\]]*[)\]]/g, ' ');

  // Убираем маркеры изданий, но только в связке со словом «edition»: слова вроде
  // gold, digital, complete, anniversary сплошь и рядом входят в само название
  // («Halo: Combat Evolved Anniversary», «Digital Combat Simulator»), и вырезать
  // их поодиночке — значит склеить разные игры в одну.
  normalized = normalized.replace(
    /\b(?:deluxe|ultimate|definitive|complete|enhanced|gold|premium|standard|digital|legendary|special|collector'?s|anniversary|game of the year)\s+edition\b/g,
    ' '
  );

  // Аббревиатура GOTY самодостаточна и в названиях игр не встречается
  normalized = normalized.replace(/\bgoty\b/g, ' ');

  // Оставшееся одиночное «edition» (например, «… — Edition 2024»)
  normalized = normalized.replace(/\bedition\b/g, ' ');

  // Заменяем амперсанд на "and"
  normalized = normalized.replace(/&/g, ' and ');

  // Преобразуем основные римские цифры в арабские (только как самостоятельные слова)
  normalized = normalized.replace(/\bii\b/gi, '2');
  normalized = normalized.replace(/\biii\b/gi, '3');
  normalized = normalized.replace(/\biv\b/gi, '4');
  normalized = normalized.replace(/\bv\b/gi, '5');
  normalized = normalized.replace(/\bvi\b/gi, '6');
  normalized = normalized.replace(/\bvii\b/gi, '7');
  normalized = normalized.replace(/\bviii\b/gi, '8');
  normalized = normalized.replace(/\bix\b/gi, '9');
  normalized = normalized.replace(/\bx\b/gi, '10');
  normalized = normalized.replace(/\bxi\b/gi, '11');
  normalized = normalized.replace(/\bxii\b/gi, '12');

  // Убираем всю пунктуацию и диакритику, оставляя только буквы (латиница + кириллица), цифры и пробелы
  normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ');

  // Схлопываем множественные пробелы в один и удаляем пробелы по краям
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Fallback: если результат пустой, возвращаем оригинальное название в нижнем регистре
  if (!normalized) {
    return title.trim().toLowerCase();
  }

  return normalized;
}

/**
 * Создаёт URL-friendly слаг из названия игры.
 * Нормализует, транслитерирует кириллицу, заменяет пробелы на дефисы.
 */
export function slugify(title: string): string {
  // Получаем нормализованное название
  let slug = normalizeTitle(title);

  // Таблица транслитерации кириллицы в латиницу
  const cyrillicMap: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'i',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };

  // Транслитерируем каждый символ. Именно ?? , а не ||: ъ и ь отображаются в
  // пустую строку, и на || мягкий знак «вернулся» бы в слаг как есть.
  slug = slug
    .split('')
    .map((char) => cyrillicMap[char] ?? char)
    .join('');

  // normalizeTitle умеет отдать fallback с пунктуацией (например, для «!!!»),
  // поэтому в слаге оставляем только то, что безопасно в URL
  slug = slug.replace(/[^a-z0-9]+/g, ' ').trim();

  // Заменяем пробелы на дефисы
  slug = slug.replace(/\s+/g, '-');

  // Схлопываем повторные дефисы
  slug = slug.replace(/-+/g, '-');

  // Обрезаем дефисы по краям
  slug = slug.replace(/^-+|-+$/g, '');

  // Fallback: если пусто, возвращаем 'game'
  if (!slug) {
    return 'game';
  }

  return slug;
}
