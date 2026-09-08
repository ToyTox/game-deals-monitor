import axios from 'axios';
import { BaseParser } from './BaseParsers.js';
import { ParsedGame } from '../types.js';

interface SteamGameData {
  id: number;
  type?: number;
  name: string;
  discounted?: boolean;
  discount_percent?: number;
  original_price?: number | null;
  final_price?: number | null;
  currency?: string;
  header_image?: string;
  large_capsule_image?: string;
  small_capsule_image?: string;
  discount_expiration?: number;
}

interface SteamCategory {
  id?: string;
  name?: string;
  items?: SteamGameData[];
}

interface SteamResponse {
  specials?: SteamCategory;
  top_sellers?: SteamCategory;
  new_releases?: SteamCategory;
  coming_soon?: SteamCategory;
  status?: number;
}

export class SteamParser extends BaseParser {
  constructor() {
    super('steam', 'Steam Featured Games');
  }

  async parse(): Promise<ParsedGame[]> {
    const games: ParsedGame[] = [];

    try {
      const response = await axios.get<SteamResponse>(
        'https://store.steampowered.com/api/featuredcategories/',
        {
          params: { cc: 'us', l: 'en' },
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        }
      );

      const data = response.data;

      const categories = [
        data.specials?.items || [],
        data.top_sellers?.items || [],
        data.new_releases?.items || [],
      ];

      const seenIds = new Set<number>();

      for (const category of categories) {
        for (const item of category) {
          if (!item.id || !item.name) continue;
          if (item.final_price == null && item.original_price == null) continue;
          if (seenIds.has(item.id)) continue;
          seenIds.add(item.id);

          const currentPrice = (item.final_price ?? 0) / 100;
          const originalPrice = item.original_price
            ? item.original_price / 100
            : currentPrice;

          games.push({
            title: item.name,
            platform: 'steam',
            originalPrice: originalPrice,
            currentPrice: currentPrice,
            discountPercent: item.discount_percent ?? 0,
            isFree: currentPrice === 0,
            gameUrl: `https://store.steampowered.com/app/${item.id}`,
            imageUrl:
              item.header_image ||
              item.large_capsule_image ||
              item.small_capsule_image ||
              undefined,
            saleEndDate: item.discount_expiration
              ? new Date(item.discount_expiration * 1000)
              : undefined,
          });
        }
      }

      console.log(`📊 Steam: найдено ${games.length} игр`);
      return games;
    } catch (error) {
      console.error('❌ Steam парсер ошибка:', error);
      return [];
    }
  }
}

export default SteamParser;
