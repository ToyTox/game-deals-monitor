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
  ending: 'Скоро закончатся'
};

const sections = {
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

function setSectionState(key, cls, msg) {
  const el = $(`${key}-state`);
  el.className = cls;
  el.textContent = msg;
}

// ---- Фильтры разделов: платформы, демо/DLC/kit'ы и сортировка ----
const FILTERS_STORAGE_KEY = 'sectionFilters';

// Заполняется в loadPlatforms; пока пусто — рисуем только сортировку
let platformList = [];

function saveFilters() {
  const data = {};
  Object.entries(sections).forEach(([key, s]) => {
    data[key] = { platforms: s.platforms, sort: s.sort, showExtras: s.showExtras };
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
  });
}

function renderFilters(key) {
  const s = sections[key];
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

    const data = await api('/api/games?' + query.toString());
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
      setSectionState(key, 'state-empty', s.platforms.length > 0 ? 'Ничего не найдено для выбранных платформ' : s.empty);
      $(`${key}-meta`).textContent = '';
    } else {
      setSectionState(key, '', '');
      renderCards(grid, data.games);
      const from = (s.page - 1) * s.pageSize + 1;
      $(`${key}-meta`).textContent = `${from}–${from + data.games.length - 1} из ${s.total} · страница ${s.page} из ${pages}`;
    }

    renderPager(key);
  } catch (e) {
    if (requestId !== s.requestId) return;
    grid.innerHTML = '';
    $(`${key}-meta`).textContent = '';
    $(`${key}-pager`).innerHTML = '';
    setSectionState(key, 'state-error', e.message);
  }
}

function loadSections() {
  return Promise.all(Object.keys(sections).map(loadSection));
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

// Init on load (скрипт с defer — DOM уже разобран)
(async () => {
  restoreFilters();
  // Сортировка видна сразу, даже если список платформ не загрузится
  Object.keys(sections).forEach(key => renderFilters(key));
  await reloadAll();
  markRefreshed();
})();
