import axios from 'axios';
import { REQUEST_TIMEOUT, USER_AGENT } from '../parsers/steamRegion.js';

const STEAM_API = 'https://api.steampowered.com';
const STEAM_COMMUNITY = 'https://steamcommunity.com';
const BACKGROUND_BASE = 'https://shared.fastly.steamstatic.com/community_assets/images/';

/** Время жизни профиля в памяти процесса. */
const CACHE_TTL_MS = 15 * 60 * 1000;

/** Сколько профилей держим одновременно; самый старый вытесняется. */
const CACHE_MAX_ENTRIES = 50;

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

export interface ProfileBackground {
  /** Статичная картинка: фон целиком или постер для видео. */
  imageUrl: string;
  /** Только у анимированных фонов. */
  videoWebmUrl: string | null;
  videoMp4Url: string | null;
}

/** Часть профиля, которую не удалось получить из-за сбоя Steam. */
export type MissingPart = 'avatar' | 'background';

export interface SteamProfile {
  steamId: string;
  avatarUrl: string | null;
  name: string | null;
  background: ProfileBackground | null;
  /** Только у неполного результата: что именно не получено. Отсутствие фона/аватара у пользователя сюда не входит. */
  missing?: MissingPart[];
}

interface RawBackground {
  image_large?: string;
  movie_webm?: string;
  movie_mp4?: string;
}

const httpConfig = {
  timeout: REQUEST_TIMEOUT,
  headers: { 'User-Agent': USER_AGENT },
};

/** Относительный путь ассета -> полный URL. Пустое значение — null. */
function assetUrl(path?: string): string | null {
  return path ? BACKGROUND_BASE + path.replace(/^\/+/, '') : null;
}

/** Аватар принимаем только с https и хоста Steam CDN. */
function safeAvatarUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isSteamHost = host === 'steamstatic.com' || host.endsWith('.steamstatic.com');
    return parsed.protocol === 'https:' && isSteamHost ? url : null;
  } catch {
    return null;
  }
}

/** Первое вхождение тега: в XML профиля корневые поля идут раньше, чем данные групп. */
function firstTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*?))\\s*</${tag}>`));
  const value = match ? (match[1] ?? match[2] ?? '').trim() : '';
  return value || null;
}

export class SteamProfileService {
  private cache = new Map<string, { value: SteamProfile; at: number }>();

  /** Аватар и имя из XML профиля. Аватары групп лежат ниже корневого — берём первый. */
  private async fetchXml(steamId: string): Promise<{ avatarUrl: string | null; name: string | null }> {
    const response = await axios.get<string>(`${STEAM_COMMUNITY}/profiles/${steamId}/?xml=1`, {
      ...httpConfig,
      responseType: 'text',
    });
    const xml = String(response.data);

    return { avatarUrl: safeAvatarUrl(firstTag(xml, 'avatarFull')), name: firstTag(xml, 'steamID') };
  }

  /** Надетый фон профиля. Пустой объект в ответе — фона нет. */
  private async fetchBackground(steamId: string): Promise<ProfileBackground | null> {
    const response = await axios.get<{ response?: { profile_background?: RawBackground } }>(
      `${STEAM_API}/IPlayerService/GetProfileItemsEquipped/v1/`,
      { ...httpConfig, params: { steamid: steamId } }
    );
    const raw = response.data?.response?.profile_background;

    const imageUrl = assetUrl(raw?.image_large);
    if (!raw || !imageUrl) return null;

    return {
      imageUrl,
      videoWebmUrl: assetUrl(raw.movie_webm),
      videoMp4Url: assetUrl(raw.movie_mp4),
    };
  }

  /**
   * Профиль по SteamID64. Сбой одной части оставляет её пустой, сбой обеих — ProfileError.
   * Полный результат кэшируется на CACHE_TTL_MS; неполный (есть missing) и полный отказ не кэшируются.
   */
  async getProfile(steamId: string): Promise<SteamProfile> {
    const cached = this.cache.get(steamId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }

    const [xml, background] = await Promise.allSettled([
      this.fetchXml(steamId),
      this.fetchBackground(steamId),
    ]);

    if (xml.status === 'rejected' && background.status === 'rejected') {
      const reason = xml.reason;
      throw new ProfileError(
        `Steam не ответил на запрос профиля: ${reason instanceof Error ? reason.message : 'unknown'}`
      );
    }

    const value: SteamProfile = {
      steamId,
      avatarUrl: xml.status === 'fulfilled' ? xml.value.avatarUrl : null,
      name: xml.status === 'fulfilled' ? xml.value.name : null,
      background: background.status === 'fulfilled' ? background.value : null,
    };

    const missing: MissingPart[] = [];
    if (xml.status === 'rejected') missing.push('avatar');
    if (background.status === 'rejected') missing.push('background');

    if (missing.length > 0) {
      return { ...value, missing };
    }

    this.cache.set(steamId, { value, at: Date.now() });

    if (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) {
        this.cache.delete(oldest.value);
      }
    }

    return value;
  }

  /** Сбрасывает кэш. Нужен тестам. */
  resetCache(): void {
    this.cache.clear();
  }
}

export default new SteamProfileService();
