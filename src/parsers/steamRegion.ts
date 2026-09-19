// Регион магазина. По умолчанию — российский Steam: цены в рублях, названия и описания на русском.
export const COUNTRY_CODE = process.env.STEAM_COUNTRY_CODE || 'ru';
export const LANGUAGE = process.env.STEAM_LANGUAGE || 'russian';

export const REQUEST_TIMEOUT = 15000;
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/** Валюта региона, если Steam её не вернул явно. */
export const FALLBACK_CURRENCY: Record<string, string> = {
  ru: 'RUB',
  kz: 'KZT',
  by: 'BYN',
  ua: 'UAH',
  us: 'USD',
};

/** Валюта текущего региона; для незнакомого кода страны — доллар. */
export function regionCurrency(): string {
  return FALLBACK_CURRENCY[COUNTRY_CODE] ?? 'USD';
}
