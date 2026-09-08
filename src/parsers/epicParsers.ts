import axios from 'axios';
import { BaseParser } from './BaseParsers.js';
import { ParsedGame } from '../types.js';

interface EpicResponse {
  data?: {
    Catalog?: {
      searchStore?: Array<{
        title: string;
        id: string;
        keyImages?: Array<{
          type: string;
          url: string;
        }>;
        price?: {
          totalPrice?: {
            discountPrice?: number;
            originalPrice?: number;
          };
        };
        promotions?: {
          promotionalOffers?: Array<{
            promotionalOffers?: Array<{
              discountSetting?: {
                discountPercentage: number;
              };
            }>;
          }>;
        };
      }>;
    };
  };
}

export class EpicParser extends BaseParser {
  constructor() {
    super('epic', 'Epic Games Store');
  }

  async parse(): Promise<ParsedGame[]> {
    const games: ParsedGame[] = [];

    try {
      const response = await axios.post<EpicResponse>(
        'https://www.epicgames.com/graphql',
        {
          query: `
            query {
              Catalog {
                searchStore(first: 100, sortBy: NAME) {
                  elements {
                    title
                    id
                    keyImages {
                      type
                      url
                    }
                    price {
                      totalPrice {
                        discountPrice
                        originalPrice
                      }
                    }
                    promotions {
                      promotionalOffers {
                        promotionalOffers {
                          discountSetting {
                            discountPercentage
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
        },
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        }
      );

      if (response.data?.data?.Catalog?.searchStore) {
        for (const item of response.data.data.Catalog.searchStore) {
          const originalPrice = item.price?.totalPrice?.originalPrice || 0;
          const currentPrice = item.price?.totalPrice?.discountPrice || originalPrice;
          const discount =
            item.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0]
              ?.discountSetting?.discountPercentage || 0;

          const headerImage = item.keyImages?.find((img: any) => img.type === 'Thumbnail')?.url;

          games.push({
            title: item.title,
            platform: 'epic',
            originalPrice: originalPrice > 0 ? originalPrice / 100 : 0,
            currentPrice: currentPrice > 0 ? currentPrice / 100 : 0,
            discountPercent: discount,
            isFree: currentPrice === 0,
            gameUrl: `https://www.epicgames.com/store/en-US/p/${item.id}`,
            imageUrl: headerImage,
          });
        }
      }

      const freeGames = await this.parseFreeGames();
      games.push(...freeGames);

      console.log(`📊 Epic Games: найдено ${games.length} игр`);
      return games;
    } catch (error) {
      console.error('❌ Epic Games парсер ошибка:', error);
      return [];
    }
  }

  private async parseFreeGames(): Promise<ParsedGame[]> {
    const games: ParsedGame[] = [];
    try {
      // Epic раздает бесплатные игры каждую неделю
    } catch (error) {
      console.error('❌ Epic Free Games парсер ошибка:', error);
    }
    return games;
  }
}

export default EpicParser;
