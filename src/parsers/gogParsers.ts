import axios from 'axios';
import { BaseParser } from './BaseParsers.js';
import { ParsedGame } from '../types.js';

interface GOGGameData {
  id: string;
  title: string;
  url: string;
  image: string;
  normalPrice: number;
  finalPrice: number;
  discount: number;
}

interface GOGApiResponse {
  products: GOGGameData[];
  totalPages: number;
}

export class GOGParser extends BaseParser {
  constructor() {
    super('gog', 'GOG.com');
  }

  async parse(): Promise<ParsedGame[]> {
    const games: ParsedGame[] = [];

    try {
      let page = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        const response = await axios.get<GOGApiResponse>(
          'https://api.gog.com/v2/games/products',
          {
            params: {
              limit: 50,
              page: page,
              sort: 'discount_desc',
              lang: 'en',
              hiddenFlag: 'exclude',
            },
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          }
        );

        if (response.data?.products) {
          for (const item of response.data.products) {
            games.push({
              title: item.title,
              platform: 'gog',
              currency: 'USD',
              originalPrice: item.normalPrice,
              currentPrice: item.finalPrice,
              discountPercent: item.discount,
              isFree: item.finalPrice === 0,
              gameUrl: `https://www.gog.com${item.url}`,
              imageUrl: item.image,
            });
          }

          hasMorePages =
            page < (response.data.totalPages || 1) && page < 5;
          page++;
        } else {
          hasMorePages = false;
        }
      }

      const freeGames = await this.parseFreeGames();
      games.push(...freeGames);

      console.log(`📊 GOG: найдено ${games.length} игр`);
      return games;
    } catch (error) {
      console.error('❌ GOG парсер ошибка:', error);
      return [];
    }
  }

  private async parseFreeGames(): Promise<ParsedGame[]> {
    const games: ParsedGame[] = [];

    try {
      const response = await axios.get<GOGApiResponse>(
        'https://api.gog.com/v2/games/products',
        {
          params: {
            limit: 50,
            page: 1,
            priceRange: '0,0',
            sort: 'release_desc',
            lang: 'en',
          },
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        }
      );

      if (response.data?.products) {
        for (const item of response.data.products) {
          games.push({
            title: item.title,
            platform: 'gog',
            currency: 'USD',
            originalPrice: item.normalPrice,
            currentPrice: 0,
            discountPercent: 100,
            isFree: true,
            gameUrl: `https://www.gog.com${item.url}`,
            imageUrl: item.image,
          });
        }
      }
    } catch (error) {
      console.error('❌ GOG Free Games парсер ошибка:', error);
    }

    return games;
  }
}

export default GOGParser;
