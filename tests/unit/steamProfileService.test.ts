import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import { SteamProfileService, ProfileError } from '../../src/services/steamProfileService.js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const mockedGet = axios.get as unknown as Mock;

const STEAM_ID = '76561198006409530';
const BASE = 'https://shared.fastly.steamstatic.com/community_assets/images/';

const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<profile>
  <steamID64>${STEAM_ID}</steamID64>
  <steamID><![CDATA[Игрок]]></steamID>
  <avatarIcon><![CDATA[https://avatars.steamstatic.com/aaa.jpg]]></avatarIcon>
  <avatarFull><![CDATA[https://avatars.steamstatic.com/aaa_full.jpg]]></avatarFull>
  <groups>
    <group>
      <groupName><![CDATA[Группа]]></groupName>
      <avatarFull><![CDATA[https://avatars.steamstatic.com/group_full.jpg]]></avatarFull>
    </group>
  </groups>
</profile>`;

const STATIC_BG = { response: { profile_background: { image_large: 'items/1/static.jpg' } } };
const ANIMATED_BG = {
  response: {
    profile_background: {
      image_large: 'items/2/poster.jpg',
      movie_webm: 'items/2/movie.webm',
      movie_mp4: 'items/2/movie.mp4',
    },
  },
};

/** Ответы Steam по адресу: XML профиля и надетый фон; undefined — этот запрос падает. */
function mockSteam({ xml, background }: { xml?: string; background?: unknown }) {
  mockedGet.mockImplementation(async (url: string) => {
    if (url.includes('?xml=1')) {
      if (xml === undefined) throw new Error('xml down');
      return { data: xml };
    }
    if (url.includes('GetProfileItemsEquipped')) {
      if (background === undefined) throw new Error('api down');
      return { data: background };
    }
    throw new Error(`неожиданный запрос: ${url}`);
  });
}

describe('SteamProfileService', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('статичный фон: полный URL картинки, видео нет', async () => {
    mockSteam({ xml: XML, background: STATIC_BG });

    const profile = await new SteamProfileService().getProfile(STEAM_ID);

    expect(profile.background).toEqual({
      imageUrl: `${BASE}items/1/static.jpg`,
      videoWebmUrl: null,
      videoMp4Url: null,
    });
  });

  it('анимированный фон: и картинка-постер, и оба видео с полными URL', async () => {
    mockSteam({ xml: XML, background: ANIMATED_BG });

    const profile = await new SteamProfileService().getProfile(STEAM_ID);

    expect(profile.background).toEqual({
      imageUrl: `${BASE}items/2/poster.jpg`,
      videoWebmUrl: `${BASE}items/2/movie.webm`,
      videoMp4Url: `${BASE}items/2/movie.mp4`,
    });
  });

  it('пустой фон -> background null', async () => {
    mockSteam({ xml: XML, background: { response: { profile_background: {} } } });

    const profile = await new SteamProfileService().getProfile(STEAM_ID);

    expect(profile.background).toBeNull();
  });

  it('берёт аватар и имя профиля, а не группы', async () => {
    mockSteam({ xml: XML, background: STATIC_BG });

    const profile = await new SteamProfileService().getProfile(STEAM_ID);

    expect(profile.avatarUrl).toBe('https://avatars.steamstatic.com/aaa_full.jpg');
    expect(profile.name).toBe('Игрок');
    expect(profile.steamId).toBe(STEAM_ID);
  });

  it('сбой XML: аватар и имя пустые, фон на месте', async () => {
    mockSteam({ background: STATIC_BG });

    const profile = await new SteamProfileService().getProfile(STEAM_ID);

    expect(profile.avatarUrl).toBeNull();
    expect(profile.name).toBeNull();
    expect(profile.background?.imageUrl).toBe(`${BASE}items/1/static.jpg`);
  });

  it('сбой API фона: фон пустой, аватар на месте', async () => {
    mockSteam({ xml: XML });

    const profile = await new SteamProfileService().getProfile(STEAM_ID);

    expect(profile.background).toBeNull();
    expect(profile.avatarUrl).toBe('https://avatars.steamstatic.com/aaa_full.jpg');
  });

  it('полный отказ Steam -> ProfileError, и он не кэшируется', async () => {
    const svc = new SteamProfileService();
    mockSteam({});

    await expect(svc.getProfile(STEAM_ID)).rejects.toBeInstanceOf(ProfileError);

    mockSteam({ xml: XML, background: STATIC_BG });
    await expect(svc.getProfile(STEAM_ID)).resolves.toMatchObject({ steamId: STEAM_ID });
  });

  it('повторный запрос берётся из кэша', async () => {
    const svc = new SteamProfileService();
    mockSteam({ xml: XML, background: STATIC_BG });

    await svc.getProfile(STEAM_ID);
    const calls = mockedGet.mock.calls.length;
    await svc.getProfile(STEAM_ID);

    expect(mockedGet.mock.calls.length).toBe(calls);
  });

  it('частичный сбой: missing указывает часть и результат не кэшируется как полный', async () => {
    const svc = new SteamProfileService();
    mockSteam({ background: STATIC_BG });

    const partial = await svc.getProfile(STEAM_ID);
    expect(partial.missing).toEqual(['avatar']);

    const calls = mockedGet.mock.calls.length;
    mockSteam({ xml: XML, background: STATIC_BG });
    const full = await svc.getProfile(STEAM_ID);

    expect(mockedGet.mock.calls.length).toBeGreaterThan(calls);
    expect(full.missing).toBeUndefined();
    expect(full.avatarUrl).toBe('https://avatars.steamstatic.com/aaa_full.jpg');
  });

  it('сбой API фона: missing = background, повторный вызов снова идёт в Steam', async () => {
    const svc = new SteamProfileService();
    mockSteam({ xml: XML });

    expect((await svc.getProfile(STEAM_ID)).missing).toEqual(['background']);
    const calls = mockedGet.mock.calls.length;
    await svc.getProfile(STEAM_ID);

    expect(mockedGet.mock.calls.length).toBeGreaterThan(calls);
  });

  it('отсутствие фона у пользователя не считается сбоем', async () => {
    mockSteam({ xml: XML, background: { response: {} } });

    const profile = await new SteamProfileService().getProfile(STEAM_ID);

    expect(profile.background).toBeNull();
    expect(profile.missing).toBeUndefined();
  });

  it('аватар с чужой схемой или хостом отбрасывается', async () => {
    for (const url of ['http://avatars.steamstatic.com/a.jpg', 'https://evil.example/a.jpg', 'https://steamstatic.com.evil.example/a.jpg']) {
      const xml = XML.replace('https://avatars.steamstatic.com/aaa_full.jpg', url);
      mockSteam({ xml, background: STATIC_BG });

      const profile = await new SteamProfileService().getProfile(STEAM_ID);

      expect(profile.avatarUrl).toBeNull();
      expect(profile.missing).toBeUndefined();
    }
  });
});
