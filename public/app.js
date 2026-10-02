'use strict';

// ---- Разделы каталога: бесплатные игры и скидки ----
const PAGE_SIZES = [12, 24, 48, 96];

// Ключи совпадают с GAME_SORTS в src/services/gameService.ts
const SORT_LABELS = {
  discount: 'По скидке',
  price_asc: 'Сначала дешёвые',
  price_desc: 'Сначала дорогие',
  newest: 'Новые первыми',
  title: 'По названию',
  ending: 'Скоро закончатся',
  // Только для вишлиста: этих полей у офферов каталога нет
  added: 'Недавно добавленные',
  priority: 'По приоритету в Steam'
};

// Ключ в localStorage для введённого SteamID
const WISHLIST_USER_KEY = 'steamWishlistUser';
// Оформление профиля: храним только URL и SteamID, сами картинки не кэшируем
const PROFILE_KEY = 'steamProfileDecor';
// Пользователь убрал оформление кнопкой — не запрашиваем и не применяем, пока не нажмёт «Показать»
const PROFILE_OPT_OUT_KEY = 'steamProfileDecorOff';

const sections = {
  wishlist: {
    title: 'список желаемого',
    loading: 'Читаем список желаемого…',
    empty: 'В списке желаемого ничего не найдено',
    sorts: ['discount', 'price_asc', 'price_desc', 'title', 'ending', 'added', 'priority'],
    sort: 'discount',
    // Вишлист всегда из Steam — чипы площадок и переключатель демо/DLC ему не нужны
    usesPlatformFilters: false,
    onlyDiscounted: true,
    user: '',
    platforms: [],
    showExtras: false,
    page: 1,
    pageSize: 12,
    total: 0,
    requestId: 0,
    buildUrl: (s) => '/api/wishlist?' + new URLSearchParams({
      user: s.user,
      sort: s.sort,
      onlyDiscounted: String(s.onlyDiscounted),
      limit: String(s.pageSize),
      offset: String((s.page - 1) * s.pageSize)
    }).toString()
  },
  free: {
    title: 'бесплатные игры',
    params: { free: 'true' },
    loading: 'Загрузка бесплатных игр…',
    empty: 'Бесплатных игр пока нет',
    // Цена и скидка у бесплатных одинаковые — сортировать по ним бессмысленно
    sorts: ['newest', 'title', 'ending'],
    sort: 'newest',
    platforms: [],
    // Демо, DLC и kit'ы по умолчанию скрыты
    showExtras: false,
    page: 1,
    pageSize: 12,
    total: 0,
    requestId: 0
  },
  deals: {
    title: 'скидки',
    params: { free: 'false', minDiscount: '1' },
    loading: 'Загрузка скидок…',
    empty: 'Игр со скидкой пока нет',
    sorts: ['discount', 'price_asc', 'price_desc', 'newest', 'title', 'ending'],
    sort: 'discount',
    platforms: [],
    showExtras: false,
    page: 1,
    pageSize: 12,
    total: 0,
    requestId: 0
  }
};

function sectionPages(s) {
  return Math.max(1, Math.ceil(s.total / s.pageSize));
}

function setSectionState(key, cls, msg, html = null) {
  const el = $(`${key}-state`);
  el.className = cls;
  // html — только для собственных подсказок раздела, в него не попадает ввод пользователя
  if (html === null) el.textContent = msg;
  else el.innerHTML = html;
}

// ---- Фильтры разделов: платформы, демо/DLC/kit'ы и сортировка ----
const FILTERS_STORAGE_KEY = 'sectionFilters';

// Заполняется в loadPlatforms; пока пусто — рисуем только сортировку
let platformList = [];

function saveFilters() {
  const data = {};
  Object.entries(sections).forEach(([key, s]) => {
    data[key] = {
      platforms: s.platforms,
      sort: s.sort,
      showExtras: s.showExtras,
      onlyDiscounted: s.onlyDiscounted
    };
  });
  try { localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
}

function restoreFilters() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(FILTERS_STORAGE_KEY)); } catch (e) {}
  if (!saved || typeof saved !== 'object') return;

  Object.entries(sections).forEach(([key, s]) => {
    const f = saved[key];
    if (!f) return;
    if (s.sorts.includes(f.sort)) s.sort = f.sort;
    if (Array.isArray(f.platforms)) s.platforms = f.platforms.filter(p => typeof p === 'string');
    if (typeof f.showExtras === 'boolean') s.showExtras = f.showExtras;
    if (typeof f.onlyDiscounted === 'boolean') s.onlyDiscounted = f.onlyDiscounted;
  });
}

// ---- Раздел вишлиста: ввод SteamID ----
function setWishlistUser(user) {
  const s = sections.wishlist;
  s.user = user;
  s.page = 1;
  $('wishlist-input').value = user;
  $('wishlist-clear').hidden = !user;

  try {
    if (user) localStorage.setItem(WISHLIST_USER_KEY, user);
    else localStorage.removeItem(WISHLIST_USER_KEY);
  } catch (e) {}
}

function clearWishlist() {
  clearProfileDecor();
  setWishlistUser('');
  $('wishlist-grid').innerHTML = '';
  $('wishlist-meta').textContent = '';
  $('wishlist-pager').innerHTML = '';
  sections.wishlist.total = 0;
  // Ответ на уже улетевший запрос не должен нарисоваться в очищенный раздел
  sections.wishlist.requestId++;
  setSectionState('wishlist', 'state-empty', 'Введите SteamID, ссылку на профиль или ник');
}

// «Забыть»: SteamID, оформление и флаг отказа
function forgetWishlist() {
  setProfileOptOut(false);
  clearWishlist();
}

function initWishlist() {
  $('wishlist-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('wishlist-input').value.trim();
    if (!value) return clearWishlist();
    // Другой пользователь: оформление прежнего убираем сразу, не дожидаясь ответа /profile
    if (value !== sections.wishlist.user) clearProfileDecor();
    // Явная отправка формы с вводом снимает отказ от оформления
    setProfileOptOut(false);
    setWishlistUser(value);
    loadSection('wishlist');
  });

  $('wishlist-clear').addEventListener('click', forgetWishlist);
  $('wishlist-decor-off').addEventListener('click', optOutProfileDecor);
  $('wishlist-avatar').addEventListener('error', () => { $('wishlist-avatar').hidden = true; });

  initProfileBackground();

  let saved = '';
  try { saved = localStorage.getItem(WISHLIST_USER_KEY) || ''; } catch (e) {}

  if (saved) setWishlistUser(saved);
  else clearWishlist();

  // Сохранённое оформление применяем сразу, без запроса
  if (!isProfileOptedOut()) applyProfileDecor(readStoredProfile());
}

// ---- Оформление профиля: аватар и фон ----
let currentProfile = null;
// Номер актуального запроса профиля: сброс или смена пользователя обесценивает улетевший ответ
let profileRequestId = 0;
let profileRequestFor = '';
// Неполный сохранённый профиль перезапрашиваем не чаще одного раза за загрузку страницы
let incompleteRetried = false;
let bgVideo = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function isProfileOptedOut() {
  try { return localStorage.getItem(PROFILE_OPT_OUT_KEY) === '1'; } catch (e) { return false; }
}

function setProfileOptOut(value) {
  try {
    if (value) localStorage.setItem(PROFILE_OPT_OUT_KEY, '1');
    else localStorage.removeItem(PROFILE_OPT_OUT_KEY);
  } catch (e) {}
}

function isHttpsUrl(url) {
  if (url === null || url === undefined) return true;
  return typeof url === 'string' && url.startsWith('https://');
}

function readStoredProfile() {
  try {
    const data = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (!data || typeof data.steamId !== 'string') return null;
    const bg = data.background;
    if (!isHttpsUrl(data.avatarUrl)) return null;
    if (bg && !(isHttpsUrl(bg.imageUrl) && isHttpsUrl(bg.videoWebmUrl) && isHttpsUrl(bg.videoMp4Url))) return null;
    return data;
  } catch (e) { return null; }
}

function storeProfile(profile) {
  try {
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_KEY);
  } catch (e) {}
}

// Убирает оформление с экрана и из localStorage; флаг отказа не трогает
function clearProfileDecor() {
  profileRequestId++;
  profileRequestFor = '';
  storeProfile(null);
  applyProfileDecor(null);
}

// «Убрать оформление»: данные чистим, отказ запоминаем
function optOutProfileDecor() {
  profileRequestId++;
  profileRequestFor = '';
  setProfileOptOut(true);
  storeProfile(null);
  applyProfileDecor(null);
}

function applyProfileDecor(profile) {
  currentProfile = profile;
  const avatar = $('wishlist-avatar');

  if (profile && profile.avatarUrl) {
    avatar.src = profile.avatarUrl;
    avatar.alt = profile.name ? `Аватар ${profile.name}` : 'Аватар профиля Steam';
    avatar.title = profile.name || '';
    avatar.hidden = false;
  } else {
    avatar.hidden = true;
    avatar.removeAttribute('src');
  }

  renderProfileBackground(profile && profile.background);
  $('wishlist-decor-off').hidden = !(profile && (profile.avatarUrl || profile.background));
}

function removeBgVideo() {
  if (!bgVideo) return;
  bgVideo.pause();
  bgVideo.remove();
  bgVideo = null;
}

function renderProfileBackground(bg) {
  const layer = $('profile-bg');
  removeBgVideo();

  if (!bg || !bg.imageUrl) {
    layer.hidden = true;
    layer.style.backgroundImage = '';
    document.body.classList.remove('has-profile-bg');
    return;
  }

  layer.style.backgroundImage = `url("${bg.imageUrl}")`;
  layer.hidden = false;
  document.body.classList.add('has-profile-bg');

  // При reduced-motion видео не создаём и не грузим — остаётся статичная картинка
  if (reducedMotion.matches) return;

  const sources = [
    [bg.videoWebmUrl, 'video/webm'],
    [bg.videoMp4Url, 'video/mp4']
  ].filter(([url]) => url);
  if (sources.length === 0) return;

  const video = document.createElement('video');
  if (!sources.some(([, type]) => video.canPlayType(type))) return;

  video.className = 'profile-bg-video';
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.controls = false;
  video.disablePictureInPicture = true;
  video.tabIndex = -1;
  // Пока вкладка скрыта или play() не вызван, ничего не качаем
  video.preload = 'none';
  video.poster = bg.imageUrl;
  video.setAttribute('aria-hidden', 'true');

  // Видео поверх картинки появляется только когда реально пошло; сбой всех источников — убираем
  let failed = 0;
  sources.forEach(([url, type]) => {
    const source = document.createElement('source');
    source.src = url;
    source.type = type;
    source.addEventListener('error', () => {
      if (++failed === sources.length && bgVideo === video) removeBgVideo();
    });
    video.appendChild(source);
  });
  video.addEventListener('playing', () => video.classList.add('is-playing'));

  layer.appendChild(video);
  bgVideo = video;
  if (!document.hidden) video.play().catch(() => {});
}

function initProfileBackground() {
  // Скрытая вкладка: пауза, чтобы не жечь батарею
  document.addEventListener('visibilitychange', () => {
    if (!bgVideo) return;
    if (document.hidden) bgVideo.pause();
    else bgVideo.play().catch(() => {});
  });

  // Смена настройки без перезагрузки
  const onChange = () => {
    if (currentProfile && !isProfileOptedOut()) renderProfileBackground(currentProfile.background);
  };
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onChange);
  else if (reducedMotion.addListener) reducedMotion.addListener(onChange);
}

// После успешного вишлиста: профиль запрашиваем, только если SteamID новый или данных нет
async function ensureProfileDecor(steamId) {
  if (!steamId || isProfileOptedOut()) return;

  const stored = readStoredProfile();
  if (stored && stored.steamId === steamId) {
    if (!stored.incomplete || incompleteRetried) return;
    incompleteRetried = true;
  }
  if (profileRequestFor === steamId) return;

  const requestId = ++profileRequestId;
  profileRequestFor = steamId;

  try {
    const data = await api('/api/wishlist/profile?' + new URLSearchParams({ steamId }));
    if (requestId !== profileRequestId || isProfileOptedOut()) return;

    const profile = {
      steamId,
      avatarUrl: data.avatarUrl || null,
      name: data.name || null,
      background: data.background && data.background.imageUrl ? data.background : null,
      incomplete: Array.isArray(data.missing) && data.missing.length > 0
    };
    storeProfile(profile);
    applyProfileDecor(profile);
  } catch (e) {
    // Ошибка профиля вишлисту не мешает; чужое оформление при этом не оставляем
    // Неполный профиль того же пользователя при сбое повторного запроса остаётся
    const keep = readStoredProfile();
    if (requestId === profileRequestId && !isProfileOptedOut() && !(keep && keep.steamId === steamId)) {
      storeProfile(null);
      applyProfileDecor(null);
    }
  } finally {
    if (requestId === profileRequestId) profileRequestFor = '';
  }
}

function renderFilters(key) {
  const s = sections[key];

  // У вишлиста вместо площадок и демо/DLC — переключатель «только со скидкой»
  if (s.usesPlatformFilters === false) {
    $(`${key}-filters`).innerHTML = `
      <label class="filter-toggle">
        <input type="checkbox" data-discounted${s.onlyDiscounted ? ' checked' : ''}>
        Только со скидкой
      </label>
      <label class="filter-sort">
        Сортировка:
        <select data-sort>
          ${s.sorts.map(k => `<option value="${k}"${k === s.sort ? ' selected' : ''}>${esc(SORT_LABELS[k])}</option>`).join('')}
        </select>
      </label>
    `;
    return;
  }

  const chips = platformList.length > 0
    ? `<div class="filter-chips" role="group" aria-label="Платформы">
        <button type="button" class="chip" data-platform="">Все</button>
        ${platformList.map(p => `<button type="button" class="chip" data-platform="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>`
    : '';

  $(`${key}-filters`).innerHTML = `
    ${chips}
    <label class="filter-toggle">
      <input type="checkbox" data-extras${s.showExtras ? ' checked' : ''}>
      Демо, DLC и kit'ы
    </label>
    <label class="filter-sort">
      Сортировка:
      <select data-sort>
        ${s.sorts.map(k => `<option value="${k}"${k === s.sort ? ' selected' : ''}>${esc(SORT_LABELS[k])}</option>`).join('')}
      </select>
    </label>
  `;
  syncChips(key);
}

// Подсветка чипов по состоянию — без перерисовки, чтобы не терять фокус с клавиатуры
function syncChips(key) {
  const s = sections[key];
  $(`${key}-filters`).querySelectorAll('.chip').forEach(chip => {
    const p = chip.dataset.platform;
    const on = p ? s.platforms.includes(p) : s.platforms.length === 0;
    chip.classList.toggle('is-active', on);
    chip.setAttribute('aria-pressed', String(on));
  });
}

function applyFilters(key) {
  sections[key].page = 1;
  saveFilters();
  syncChips(key);
  loadSection(key);
}

// Номера страниц: первая, последняя, соседи текущей; остальное — многоточие
function pageItems(current, pages) {
  const items = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - current) <= 1) {
      items.push(p);
    } else if (items[items.length - 1] !== '…') {
      items.push('…');
    }
  }
  return items;
}

function renderPager(key) {
  const s = sections[key];
  const el = $(`${key}-pager`);

  if (s.total === 0) {
    el.innerHTML = '';
    return;
  }

  const pages = sectionPages(s);
  const nums = pageItems(s.page, pages).map(item =>
    item === '…'
      ? '<span class="pager-gap">…</span>'
      : `<button type="button" class="page-btn${item === s.page ? ' is-active' : ''}" data-page="${item}"${item === s.page ? ' aria-current="page"' : ''}>${item}</button>`
  ).join('');

  el.innerHTML = `
    <div class="pager-nav">
      <button type="button" class="pager-btn" data-page="prev" ${s.page <= 1 ? 'disabled' : ''} aria-label="Предыдущая страница">←</button>
      ${nums}
      <button type="button" class="pager-btn" data-page="next" ${s.page >= pages ? 'disabled' : ''} aria-label="Следующая страница">→</button>
    </div>
    <label class="pager-size">
      На странице:
      <select data-size>
        ${PAGE_SIZES.map(n => `<option value="${n}"${n === s.pageSize ? ' selected' : ''}>${n}</option>`).join('')}
      </select>
    </label>
  `;
}

async function loadSection(key) {
  const s = sections[key];
  const grid = $(`${key}-grid`);

  setSectionState(key, 'state-loading', s.loading);

  // Быстрые клики по чипам шлют запросы внахлёст — рисуем только ответ на последний
  const requestId = ++s.requestId;

  try {
    const query = new URLSearchParams({
      ...s.params,
      sort: s.sort,
      limit: String(s.pageSize),
      offset: String((s.page - 1) * s.pageSize)
    });
    if (s.platforms.length > 0) query.set('platform', s.platforms.join(','));
    if (!s.showExtras) query.set('kind', 'game');

    const data = await api(s.buildUrl ? s.buildUrl(s) : '/api/games?' + query.toString());
    if (requestId !== s.requestId) return;
    s.total = data.total;
    if (key === 'wishlist') ensureProfileDecor(data.steamId);

    // Страница могла уехать за границы (например, после парсинга) — вернёмся на последнюю
    const pages = sectionPages(s);
    if (s.page > pages) {
      s.page = pages;
      return loadSection(key);
    }

    if (!data.games || data.games.length === 0) {
      grid.innerHTML = '';
      const empty = s.buildUrl && s.onlyDiscounted
        ? 'Ни на одну игру из списка желаемого сейчас нет скидки'
        : s.platforms.length > 0 ? 'Ничего не найдено для выбранных платформ' : s.empty;
      setSectionState(key, 'state-empty', empty);
      $(`${key}-meta`).textContent = wishlistMeta(s, data);
    } else {
      setSectionState(key, '', '');
      renderCards(grid, data.games);
      const from = (s.page - 1) * s.pageSize + 1;
      const range = `${from}–${from + data.games.length - 1} из ${s.total} · страница ${s.page} из ${pages}`;
      $(`${key}-meta`).textContent = s.buildUrl ? `${wishlistMeta(s, data)} · ${range}` : range;
    }

    renderPager(key);
  } catch (e) {
    if (requestId !== s.requestId) return;
    grid.innerHTML = '';
    $(`${key}-meta`).textContent = '';
    $(`${key}-pager`).innerHTML = '';

    // Пустой и закрытый вишлист Steam не различает, поэтому вместо голой ошибки
    // показываем, что именно проверить в настройках профиля
    if (s.buildUrl && /приватност/i.test(e.message)) {
      setSectionState(key, 'state-empty', '', `${esc(e.message)}.
        Проверьте, что «Игровые данные» открыты в
        <a href="https://steamcommunity.com/my/edit/settings" target="_blank" rel="noopener">настройках приватности</a>.`);
    } else {
      setSectionState(key, 'state-error', e.message);
    }
  }
}

// Сводка по вишлисту: сколько всего, сколько со скидкой, сколько без цены
function wishlistMeta(s, data) {
  if (!s.buildUrl) return '';

  const parts = [`в вишлисте ${data.wishlistTotal}`, `со скидкой ${data.discountedTotal}`];
  if (data.unavailableTotal > 0) parts.push(`без цены ${data.unavailableTotal}`);
  if (data.truncated) parts.push(`показаны первые ${data.wishlistTotal > 2000 ? 2000 : data.wishlistTotal}`);

  return parts.join(' · ');
}

function loadSections() {
  // Вишлист без введённого SteamID грузить нечем — раздел ждёт ввода
  const keys = Object.keys(sections).filter(key => !sections[key].buildUrl || sections[key].user);
  return Promise.all(keys.map(loadSection));
}

// ---- Сворачиваемые разделы ----
// Ключ в localStorage: { wishlist: true, ... } — только свёрнутые
const COLLAPSED_KEY = 'collapsedSections';

function loadCollapsed() {
  try {
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  } catch (e) {
    return {};
  }
}

function setCollapsed(key, collapsed) {
  $(`section-${key}`).classList.toggle('is-collapsed', collapsed);
  document.querySelector(`#section-${key} .section-toggle`).setAttribute('aria-expanded', String(!collapsed));
}

Object.keys(sections).forEach(key => {
  const toggle = document.querySelector(`#section-${key} .section-toggle`);
  setCollapsed(key, !!loadCollapsed()[key]);

  toggle.addEventListener('click', () => {
    const collapsed = toggle.getAttribute('aria-expanded') === 'true';
    setCollapsed(key, collapsed);
    const stored = loadCollapsed();
    if (collapsed) stored[key] = true; else delete stored[key];
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(stored)); } catch (e) {}
  });
});

async function goToPage(key, page) {
  const s = sections[key];
  const pages = sectionPages(s);
  if (page < 1 || page > pages || page === s.page) return;
  s.page = page;
  await loadSection(key);
  $(`section-${key}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

Object.keys(sections).forEach(key => {
  const filters = $(`${key}-filters`);

  filters.addEventListener('click', (e) => {
    const chip = e.target.closest('button[data-platform]');
    if (!chip) return;
    const s = sections[key];
    const p = chip.dataset.platform;
    if (!p) {
      if (s.platforms.length === 0) return;
      s.platforms = [];
    } else {
      s.platforms = s.platforms.includes(p)
        ? s.platforms.filter(x => x !== p)
        : [...s.platforms, p];
    }
    applyFilters(key);
  });

  filters.addEventListener('change', (e) => {
    const s = sections[key];
    if (e.target.matches('select[data-sort]')) {
      s.sort = e.target.value;
    } else if (e.target.matches('input[data-extras]')) {
      s.showExtras = e.target.checked;
    } else if (e.target.matches('input[data-discounted]')) {
      s.onlyDiscounted = e.target.checked;
    } else {
      return;
    }
    applyFilters(key);
  });

  const pager = $(`${key}-pager`);

  pager.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    const s = sections[key];
    const val = btn.dataset.page;
    const page = val === 'prev' ? s.page - 1 : val === 'next' ? s.page + 1 : parseInt(val, 10);
    goToPage(key, page);
  });

  pager.addEventListener('change', (e) => {
    if (!e.target.matches('select[data-size]')) return;
    const s = sections[key];
    s.pageSize = parseInt(e.target.value, 10) || 12;
    s.page = 1;
    loadSection(key);
  });
});

// Load health
async function loadHealth() {
  try {
    const data = await api('/api/admin/health');
    const dot = $('health-dot');
    const text = $('health-text');
    dot.className = 'ok';
    const uptime = parseInt(data.uptime) || 0;
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const secs = uptime % 60;
    let uptimeStr = '';
    if (hours > 0) uptimeStr += `${hours} ч `;
    if (minutes > 0 || hours > 0) uptimeStr += `${minutes} мин `;
    uptimeStr += `${secs} с`;
    text.textContent = `ok · uptime ${uptimeStr}`;
  } catch (e) {
    $('health-dot').className = 'fail';
    $('health-text').textContent = 'недоступен';
  }
}

// Load platforms
async function loadPlatforms() {
  try {
    const data = await api('/api/admin/platforms');
    const platforms = data.platforms || [];

    // Сохранённая площадка могла пропасть из списка: чипа для неё нет,
    // а фильтр по ней молча отсекал бы все игры раздела
    platformList = platforms;
    let pruned = false;
    Object.values(sections).forEach(s => {
      if (s.usesPlatformFilters === false) return;
      const kept = s.platforms.filter(p => platforms.includes(p));
      if (kept.length !== s.platforms.length) {
        s.platforms = kept;
        pruned = true;
      }
    });
    if (pruned) saveFilters();
    Object.keys(sections).forEach(key => renderFilters(key));
  } catch (e) {
    console.error('loadPlatforms error:', e);
  }
}

function reloadAll() {
  return Promise.all([loadHealth(), loadPlatforms(), loadParseEstimate()]).then(loadSections);
}

// ---- «Обновлено N мин назад» ----
let lastRefreshAt = null;

function fmtAgo(date) {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  return `${Math.floor(mins / 60)} ч назад`;
}

// ---- Оценка длительности парсинга (по последним успешным прогонам) ----
let parseEstimate = null;

async function loadParseEstimate() {
  try {
    parseEstimate = await api('/api/admin/parse-estimate');
  } catch (e) {
    parseEstimate = null;
  }
  renderRefreshStatus();
}

function estimateTotal() {
  return parseEstimate && parseEstimate.total ? parseEstimate.total : null;
}

// Прошедшее время: 72 000 → «1:12»
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Примерное время: 16 000 → «~16 с», 218 000 → «~4 мин»
function fmtApprox(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `~${s} с` : `~${Math.ceil(s / 60)} мин`;
}

// Фактическое время: 16 000 → «16 с», 222 000 → «3 мин 42 с»
function fmtTook(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
}

// «vkplay ~4 мин · steam ~16 с · gog ~4 с»
function estimateBreakdown() {
  if (!parseEstimate) return '';
  return [...parseEstimate.platforms]
    .sort((a, b) => b.duration - a.duration)
    .map(p => `${p.platform} ${fmtApprox(p.duration)}`)
    .join(' · ');
}

function renderRefreshStatus() {
  const el = $('refresh-status');
  const total = estimateTotal();
  const parts = [];
  if (lastRefreshAt) parts.push(`Обновлено ${fmtAgo(lastRefreshAt)}`);
  if (total) parts.push(`парсинг ${fmtApprox(total)}`);
  el.textContent = parts.join(' · ');
  el.title = lastRefreshAt ? `Последнее обновление: ${fmtDate(lastRefreshAt)}` : '';

  $('refresh-all').title = total
    ? `Запустить парсинг всех площадок. Обычно ${fmtApprox(total)}: ${estimateBreakdown()}`
    : 'Запустить парсинг всех площадок и перечитать данные';
}

function markRefreshed() {
  lastRefreshAt = new Date();
  renderRefreshStatus();
}

setInterval(renderRefreshStatus, 30000);

// ---- Кнопка «Обновить всё»: парсинг всех площадок + перечитывание данных ----
function parseSummaryToast(data, elapsed) {
  const results = data.results || [];
  const ok = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);

  const sum = (field) => ok.reduce((acc, r) => acc + (r[field] || 0), 0);
  const lines = [];
  if (ok.length > 0) {
    lines.push({ text: `Новых: ${sum('new')} · обновлено: ${sum('updated')} · стали бесплатными: ${sum('freed')}` });
    lines.push({ text: `Площадки: ${ok.map(r => r.platform).join(', ')}` });
  }
  failed.forEach(r => lines.push({ text: `${r.platform}: ${r.error}`, isError: true }));

  if (results.length > 0 && failed.length === results.length) {
    showToast('error', `Все парсеры упали (${fmtTook(elapsed)})`, lines);
  } else if (failed.length > 0) {
    showToast('warning', `Обновлено с ошибками за ${fmtTook(elapsed)}`, lines);
  } else {
    showToast('success', `Обновлено за ${fmtTook(elapsed)}`, lines);
  }
}

let refreshing = false;

$('refresh-all').addEventListener('click', async () => {
  if (refreshing) return;
  refreshing = true;

  const btn = $('refresh-all');
  const label = btn.querySelector('.btn-label');
  const spinner = btn.querySelector('.spinner');
  const started = Date.now();

  const progress = $('refresh-progress');
  const bar = progress.querySelector('.refresh-progress-bar');
  const estimate = estimateTotal();

  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  spinner.hidden = false;
  progress.hidden = false;

  if (estimate) {
    showToast('info', `Парсинг займёт ${fmtApprox(estimate)}`, [
      { text: `Площадки парсятся параллельно, ждём самую долгую: ${estimateBreakdown()}` },
      { text: 'Страницей можно пользоваться, итог появится здесь' }
    ]);
  } else {
    showToast('info', 'Парсинг запущен', [
      { text: 'Точной оценки пока нет — замерим на этом прогоне. Обычно это несколько минут' }
    ]);
  }

  const setIndeterminate = () => {
    bar.style.width = '';
    progress.classList.add('is-indeterminate');
  };

  const tick = () => {
    const elapsed = Date.now() - started;
    if (!estimate) {
      label.textContent = `Парсинг… ${fmtClock(elapsed)}`;
      setIndeterminate();
    } else if (elapsed <= estimate) {
      label.textContent = `Парсинг… ${fmtClock(elapsed)} из ${fmtApprox(estimate)}`;
      // Не доводим до конца: 100% — только когда сервер реально ответил
      bar.style.width = `${Math.round((elapsed / estimate) * 95)}%`;
    } else {
      label.textContent = `Парсинг… ${fmtClock(elapsed)}, дольше обычного`;
      setIndeterminate();
    }
  };
  tick();
  const ticker = setInterval(tick, 1000);

  try {
    let data = null;
    let parseError = null;
    try {
      data = await api('/api/admin/parse', { method: 'POST', body: {} });
    } catch (e) {
      parseError = e;
    }

    clearInterval(ticker);
    label.textContent = 'Загрузка данных…';
    progress.classList.remove('is-indeterminate');
    bar.style.width = '100%';
    // Перечитываем и при ошибке парсинга: часть площадок могла успеть сохраниться
    await reloadAll();

    if (parseError) {
      showToast('error', 'Не удалось обновить', [{ text: parseError.message, isError: true }]);
    } else {
      markRefreshed();
      parseSummaryToast(data, Date.now() - started);
    }
  } finally {
    clearInterval(ticker);
    refreshing = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    spinner.hidden = true;
    label.textContent = 'Обновить всё';
    progress.hidden = true;
    progress.classList.remove('is-indeterminate');
    bar.style.width = '0';
  }
});

// ---- Динамика цены через ITAD ----
document.addEventListener('click', async (e) => {
  if (!e.target.classList.contains('btn-price-dynamics')) return;

  const btn = e.target;
  const card = btn.closest('.card');
  const dynamics = card.querySelector('.card-dynamics');
  const state = dynamics.querySelector('.dynamics-state');
  const content = dynamics.querySelector('.dynamics-content');

  // Признак «загружено» хранится на блоке явно и не зависит от разметки
  const isOpen = !dynamics.hidden;
  const isLoaded = dynamics.dataset.loaded === '1';

  // Данные загружены — сворачиваем/раскрываем без запроса
  if (isLoaded) {
    dynamics.hidden = isOpen;
    return;
  }

  // Нет данных (первый клик или после ошибки) — загружаем
  btn.disabled = true;
  state.className = 'dynamics-state';
  state.textContent = 'Загрузка…';
  state.hidden = false;
  content.innerHTML = '';
  dynamics.hidden = false;
  dynamics.dataset.loaded = '';

  try {
    const platform = btn.dataset.platform;
    const params = new URLSearchParams({ store: platform, title: btn.dataset.title });
    if (btn.dataset.appId) {
      params.append('appId', btn.dataset.appId);
    }

    const dynamicsData = await api(`/api/price-dynamics?${params.toString()}`);
    renderPriceDynamics(dynamics, dynamicsData);
  } catch (err) {
    state.className = 'dynamics-state dynamics-error';
    state.textContent = err.message;
    state.hidden = false;
    content.innerHTML = '';
  } finally {
    btn.disabled = false;
  }
});

function renderPriceDynamics(container, data) {
  const state = container.querySelector('.dynamics-state');
  const content = container.querySelector('.dynamics-content');

  if (!data.graphPoints || data.graphPoints.length === 0) {
    if (content) content.innerHTML = '';
    if (state) {
      state.className = 'dynamics-state dynamics-no-data';
      state.textContent = `Нет данных по цене для региона ${data.country}`;
      state.hidden = false;
    }
    container.dataset.loaded = '1';
    return;
  }

  // График за 180 дней
  const graphHtml = renderPriceGraph(data.graphPoints, data.currency);

  // Таблица периодов
  const periodsHtml = `
    <div class="dynamics-periods">
      <table class="periods-table">
        <thead>
          <tr><th>Период</th><th>Цена</th><th>Изменение</th><th>Минимум</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>День</td>
            <td>${esc(fmtPrice(data.periods.day.price, data.currency))}</td>
            <td class="${data.periods.day.change > 0 ? 'price-up' : data.periods.day.change < 0 ? 'price-down' : ''}">${data.periods.day.change !== null ? (data.periods.day.change > 0 ? '+' : '') + data.periods.day.change + '%' : '—'}</td>
            <td>${esc(fmtPrice(data.periods.day.lowest, data.currency))}</td>
          </tr>
          <tr>
            <td>Неделя</td>
            <td>${esc(fmtPrice(data.periods.week.price, data.currency))}</td>
            <td class="${data.periods.week.change > 0 ? 'price-up' : data.periods.week.change < 0 ? 'price-down' : ''}">${data.periods.week.change !== null ? (data.periods.week.change > 0 ? '+' : '') + data.periods.week.change + '%' : '—'}</td>
            <td>${esc(fmtPrice(data.periods.week.lowest, data.currency))}</td>
          </tr>
          <tr>
            <td>Месяц</td>
            <td>${esc(fmtPrice(data.periods.month.price, data.currency))}</td>
            <td class="${data.periods.month.change > 0 ? 'price-up' : data.periods.month.change < 0 ? 'price-down' : ''}">${data.periods.month.change !== null ? (data.periods.month.change > 0 ? '+' : '') + data.periods.month.change + '%' : '—'}</td>
            <td>${esc(fmtPrice(data.periods.month.lowest, data.currency))}</td>
          </tr>
          <tr>
            <td>Полгода</td>
            <td>${esc(fmtPrice(data.periods.half_year.price, data.currency))}</td>
            <td class="${data.periods.half_year.change > 0 ? 'price-up' : data.periods.half_year.change < 0 ? 'price-down' : ''}">${data.periods.half_year.change !== null ? (data.periods.half_year.change > 0 ? '+' : '') + data.periods.half_year.change + '%' : '—'}</td>
            <td>${esc(fmtPrice(data.periods.half_year.lowest, data.currency))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // Исторический минимум
  const lowestHtml = data.allTimeLowest
    ? `<p class="dynamics-lowest">Исторический минимум: <strong>${esc(fmtPrice(data.allTimeLowest.price, data.currency))}</strong> (${esc(fmtDate(new Date(data.allTimeLowest.timestamp).getTime()))})</p>`
    : '';

  if (state) state.hidden = true;
  if (content) content.innerHTML = `${graphHtml}${periodsHtml}${lowestHtml}<p class="dynamics-meta">Регион: ${esc(data.country)}, валюта: ${esc(data.currency || '—')}</p>`;
  container.dataset.loaded = '1';
}

function renderPriceGraph(graphPoints, currency) {
  if (!graphPoints || graphPoints.length === 0) return '';

  // Получить цены
  const prices = graphPoints
    .map(p => p.price)
    .filter(p => p !== null && p !== undefined);

  if (prices.length === 0) return '';

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;

  const width = 400;
  const height = 200;
  const padding = { top: 30, bottom: 40, left: 50, right: 20 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  // X — по времени на отрезке «сейчас минус 180 дней … сейчас»
  const windowEnd = Date.now();
  const windowStart = windowEnd - 180 * 24 * 60 * 60 * 1000;
  const xAt = (t) => padding.left + ((Math.min(Math.max(t, windowStart), windowEnd) - windowStart) / (windowEnd - windowStart)) * graphWidth;

  const points = graphPoints.map((point) => {
    const price = point.price ?? 0;
    const y = height - padding.bottom - ((price - minPrice) / range) * graphHeight;
    return { x: xAt(new Date(point.timestamp).getTime()), y, price, timestamp: point.timestamp };
  });

  // Ступенчатая линия: горизонталь до времени следующей точки, затем вертикаль
  let pathData = '';
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      pathData += `M ${points[i].x} ${points[i].y}`;
    } else {
      pathData += ` L ${points[i].x} ${points[i - 1].y} L ${points[i].x} ${points[i].y}`;
    }
  }

  // Построить контур для заливки
  let fillPath = pathData;
  if (points.length > 0) {
    fillPath += ` L ${points[points.length - 1].x} ${height - padding.bottom}`;
    fillPath += ` L ${points[0].x} ${height - padding.bottom}`;
    fillPath += ' Z';
  }

  // Уникальный ID для градиента
  const gradId = `grad-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Подписи по краям отрезка
  const startDate = new Date(windowStart);
  const endDate = new Date(windowEnd);

  return `
    <div class="dynamics-graph">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:var(--accent);stop-opacity:0.2" />
            <stop offset="100%" style="stop-color:var(--accent);stop-opacity:0.05" />
          </linearGradient>
        </defs>

        <!-- Сетка временных отметок -->
        <text x="${padding.left}" y="15" font-size="10" fill="var(--muted)">полгода назад</text>
        <text x="${width - padding.right}" y="15" font-size="10" fill="var(--muted)" text-anchor="end">сегодня</text>

        <!-- Графики и подписи осей -->
        <text x="10" y="${padding.top + 8}" font-size="11" fill="var(--muted)" text-anchor="middle">
          ${esc(fmtPrice(maxPrice, currency))}
        </text>
        <text x="10" y="${height - padding.bottom + 20}" font-size="11" fill="var(--muted)" text-anchor="middle">
          ${esc(fmtPrice(minPrice, currency))}
        </text>

        <!-- Дата начала -->
        <text x="${padding.left}" y="${height - 8}" font-size="9" fill="var(--muted)">
          ${startDate.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })}
        </text>

        <!-- Дата конца -->
        <text x="${width - padding.right}" y="${height - 8}" font-size="9" fill="var(--muted)" text-anchor="end">
          ${endDate.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })}
        </text>

        <!-- Область графика -->
        <path d="${fillPath}" fill="url(#${gradId})" />
        <path d="${pathData}" stroke="var(--accent)" stroke-width="2" fill="none" />
      </svg>
    </div>
  `;
}

// ---- Проверка статуса ITAD и показ баннера ----
async function loadItadStatus() {
  try {
    itadStatus = await api('/api/price-dynamics/status');
    if (!itadStatus.enabled) {
      $('itad-banner').hidden = false;
    }
  } catch (err) {
    // Ошибка запроса: показать баннер
    $('itad-banner').hidden = false;
  }
}

// Init on load (скрипт с defer — DOM уже разобран)
(async () => {
  restoreFilters();
  // Сортировка видна сразу, даже если список платформ не загрузится
  Object.keys(sections).forEach(key => renderFilters(key));
  initWishlist();

  // Загрузить статус ITAD до отрисовки карточек
  await loadItadStatus();

  await reloadAll();
  markRefreshed();
})();
