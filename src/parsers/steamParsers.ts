import axios from 'axios';
import { BaseParser } from './BaseParsers.js';
import { ParsedGame } from '../types.js';

interface SteamGameData {
  id: number;
  name: string;
  price: number;
  original_price: number;
  discount_percent: number;
  header_image?: string;
}

interface SteamResponse {
  featured_win?: SteamGameData[];
  featured_linux?: SteamGameData[];
  featured_mac?: SteamGameData[];
  featured?: SteamGameData[];
}

export class SteamParser extends BaseParser {
  constructor() {
    super('steam', 'Steam Featured Games');
  }

  async parse(): Promise<ParsedGame[]> {
    const games: ParsedGame[] = [];

    try {
      const response = await axios.get<SteamResponse>(
        'https://store.steampowered.com/api/featuredcategories/'
      );

      const data = response.data;

      const categories = [
        data.featured_win || [],
        data.featured_linux || [],
        data.featured_mac || [],
        data.featured || [],
      ];

      const seenIds = new Set<number>();

      for (const category of categories) {
        for (const item of category) {
          if (seenIds.has(item.id)) continue;
          seenIds.add(item.id);

          const currentPrice = item.price / 100;
          const originalPrice = item.original_price / 100;
          const discount = item.discount_percent;

          games.push({
            title: item.name,
            platform: 'steam',
            originalPrice: originalPrice > 0 ? originalPrice : currentPrice,
            currentPrice: currentPrice,
            discountPercent: discount,
            isFree: currentPrice === 0,
            gameUrl: https://store.steampowered.com/app/${item.id},
            imageUrl: item.header_image || undefined,
          });
        }
      }

      console.log(📊 Steam: найдено ${games.length} игр);
      return games;
    } catch (error) {
      console.error('❌ Steam парсер ошибка:', error);
      return [];
    }
  }
}

export default SteamParser;
