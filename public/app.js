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
  setWishlistUser('');
  $('wishlist-grid').innerHTML = '';
  $('wishlist-meta').textContent = '';
  $('wishlist-pager').innerHTML = '';
  sections.wishlist.total = 0;
  // Ответ на уже улетевший запрос не должен нарисоваться в очищенный раздел
  sections.wishlist.requestId++;
  setSectionState('wishlist', 'state-empty', 'Введите SteamID, ссылку на профиль или ник');
}

function initWishlist() {
  $('wishlist-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('wishlist-input').value.trim();
    if (!value) return clearWishlist();
    setWishlistUser(value);
    loadSection('wishlist');
  });

  $('wishlist-clear').addEventListener('click', clearWishlist);

  let saved = '';
  try { saved = localStorage.getItem(WISHLIST_USER_KEY) || ''; } catch (e) {}

  if (saved) setWishlistUser(saved);
  else clearWishlist();
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

// Load stats
async function loadStats() {
  try {
    const data = await api('/api/admin/stats');

    // Tiles
    const tiles = $('stats-tiles');
    tiles.innerHTML = `
      <div class="stat-tile">
        <div class="stat-value">${data.totalGames}</div>
        <div class="stat-label">Всего игр</div>
      </div>
      <div class="stat-tile">
        <div class="stat-value">${data.freeGames}</div>
        <div class="stat-label">Бесплатных</div>
      </div>
      <div class="stat-tile">
        <div class="stat-value">${data.discountedGames}</div>
        <div class="stat-label">Со скидкой</div>
      </div>
      <div class="stat-tile">
        <div class="stat-value">${data.averageDiscount}%</div>
        <div class="stat-label">Средняя скидка</div>
      </div>
      <div class="stat-tile">
        <div class="stat-value">${esc(fmtDate(data.lastUpdate))}</div>
        <div class="stat-label">Последнее обновление</div>
      </div>
    `;

    // By platform
    const platforms = $('stats-platforms');
    if (data.byStore && Object.keys(data.byStore).length > 0) {
      platforms.innerHTML = '<h3>По платформам</h3>' + Object.entries(data.byStore).map(([name, stats]) => `
        <div class="platform-stat">
          <div class="platform-name">${esc(name)}</div>
          <div class="platform-stats">
            Всего: ${stats.total} | Бесплатных: ${stats.free} | Со скидкой: ${stats.discounted}
          </div>
        </div>
      `).join('');
    } else {
      platforms.innerHTML = '';
    }

    // Top discounts
    const top = $('stats-top');
    if (data.topDiscounts && data.topDiscounts.length > 0) {
      top.innerHTML = '<h3>Топ скидок</h3><ul class="top-discounts">' + data.topDiscounts.map(item => `
        <li><strong>${esc(item.title)}</strong> (${esc(item.storeId)}) -${item.discount}%</li>
      `).join('') + '</ul>';
    } else {
      top.innerHTML = '';
    }
  } catch (e) {
    $('stats-tiles').innerHTML = `<div class="state-error">Статистика недоступна: ${esc(e.message)}</div>`;
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
  return Promise.all([loadHealth(), loadStats(), loadPlatforms(), loadParseEstimate()]).then(loadSections);
}

$('btn-stats').addEventListener('click', loadStats);

$('btn-health').addEventListener('click', loadHealth);

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

  // Проверяем, загружены ли данные: если в content есть содержимое, значит успешно загрузили
  const isOpen = !dynamics.hidden;
  const hasData = content.innerHTML.trim().length > 0;

  // Если блок открыт и данные загружены — сворачиваем без запроса
  if (isOpen && hasData) {
    dynamics.hidden = true;
    return;
  }

  // Если блок свёрнут и данные загружены — раскрываем без запроса
  if (!isOpen && hasData) {
    dynamics.hidden = false;
    return;
  }

  // Нет данных (первый клик или после ошибки) — загружаем
  btn.disabled = true;
  state.className = 'dynamics-state';
  state.textContent = 'Загрузка…';
  state.hidden = false;
  content.innerHTML = '';
  dynamics.hidden = false;

  try {
    const platform = btn.dataset.platform;
    const params = new URLSearchParams({ store: platform, title: btn.dataset.title });
    if (btn.dataset.appId) {
      params.append('appId', btn.dataset.appId);
    }

    const dynamicsData = await api(`/api/price-dynamics?${params.toString()}`);
    renderPriceDynamics(dynamics, dynamicsData);
  } catch (err) {
    state.className = 'dynamics-error';
    state.textContent = err.message;
    state.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

function renderPriceDynamics(container, data) {
  const state = container.querySelector('.dynamics-state');
  const content = container.querySelector('.dynamics-content');

  if (!data.graphPoints || data.graphPoints.length === 0) {
    state.className = 'dynamics-no-data';
    state.textContent = `Нет данных по цене для региона ${data.country}`;
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

  state.hidden = true;
  content.innerHTML = `${graphHtml}${periodsHtml}${lowestHtml}<p class="dynamics-meta">Регион: ${esc(data.country)}, валюта: ${esc(data.currency || '—')}</p>`;
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
