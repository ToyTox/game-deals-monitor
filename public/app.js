'use strict';

const $ = (id) => document.getElementById(id);

// API helper
async function api(path, opts = {}) {
  const defaultOpts = {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  };
  const finalOpts = { ...defaultOpts, ...opts };
  if (opts.body) {
    finalOpts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, finalOpts);
  const data = await res.json();
  if (!res.ok) {
    const msg = [data.error, data.message].filter(Boolean).join(' ');
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data;
}

// State helpers
function setLoading(text = 'Загрузка…') {
  const el = $('result-state');
  el.className = 'state-loading';
  el.textContent = text;
}

function showError(msg) {
  const el = $('result-state');
  el.className = 'state-error';
  el.textContent = msg;
  $('games-grid').innerHTML = '';
  $('result-table').innerHTML = '';
}

function showEmpty(msg) {
  const el = $('result-state');
  el.className = 'state-empty';
  el.textContent = msg;
  $('games-grid').innerHTML = '';
  $('result-table').innerHTML = '';
}

function clearState() {
  const el = $('result-state');
  el.className = '';
  el.textContent = '';
}

// Result helper
function setResult(title, meta, data) {
  $('result-title').textContent = title;
  $('result-meta').textContent = meta;
  $('raw-json').textContent = JSON.stringify(data, null, 2);
}

// Formatters
function fmtPrice(v) {
  if (v === null || v === undefined) return '—';
  if (v === 0) return 'Бесплатно';
  return Number(v).toFixed(2);
}

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('ru-RU');
}

function text(v, fallback = '—') {
  if (!v && v !== 0) return fallback;
  return v;
}

function esc(s) {
  if (!s) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s).replace(/[&<>"']/g, c => map[c]);
}

// Render games
function renderGames(games, expanded = false) {
  const grid = $('games-grid');
  if (!games || games.length === 0) {
    showEmpty('Ничего не найдено');
    return;
  }
  clearState();
  grid.innerHTML = games.map(game => {
    const imgHtml = game.imageUrl
      ? `<img class="card-img" src="${esc(game.imageUrl)}" alt="${esc(game.title)}" loading="lazy">`
      : '<div class="card-img placeholder">🎮</div>';

    const saleEndDateHtml = game.saleEndDate
      ? `<p class="card-sale">Акция до: ${esc(fmtDate(game.saleEndDate))}</p>`
      : '';

    const descHtml = game.description
      ? `<p class="card-desc">${esc(game.description)}</p>`
      : '';

    const priceHtml = game.isFree
      ? `<div class="card-price">Бесплатно</div>`
      : `<div class="card-price"><span class="current">${esc(fmtPrice(game.currentPrice))}</span>${game.originalPrice && game.originalPrice !== game.currentPrice ? `<s class="original">${esc(fmtPrice(game.originalPrice))}</s>` : ''}</div>`;

    const badgesHtml = `
      <div class="badges">
        <span class="badge badge-platform">${esc(game.platform)}</span>
        ${game.isFree ? '<span class="badge badge-free">FREE</span>' : (game.discountPercent > 0 ? `<span class="badge badge-discount">-${game.discountPercent}%</span>` : '')}
      </div>
    `;

    const historyHtml = game.priceHistory && game.priceHistory.length > 0
      ? `<details class="card-history">
          <summary>История цен (${game.priceHistory.length})</summary>
          <ul class="history-list">
            ${game.priceHistory.map(h => `
              <li>
                <strong>${esc(fmtDate(h.createdAt))}</strong><br>
                Цена: ${esc(fmtPrice(h.oldPrice))} → ${esc(fmtPrice(h.newPrice))}<br>
                Скидка: ${h.oldDiscount}% → ${h.newDiscount}%
              </li>
            `).join('')}
          </ul>
        </details>`
      : '';

    const metaHtml = `<p class="card-meta">ID: ${esc(game.id)}</p><p class="card-meta">Создано: ${esc(fmtDate(game.createdAt))}</p><p class="card-meta">Обновлено: ${esc(fmtDate(game.updatedAt))}</p>`;

    return `
      <article class="card${expanded ? ' card-expanded' : ''}">
        ${imgHtml}
        <div class="card-content">
          ${badgesHtml}
          <h3><a href="${esc(game.gameUrl)}" target="_blank" rel="noopener">${esc(game.title)}</a></h3>
          ${priceHtml}
          ${saleEndDateHtml}
          ${descHtml}
          ${metaHtml}
          ${historyHtml}
        </div>
      </article>
    `;
  }).join('');

  // Битая обложка — подменяем заглушкой (инлайновый onerror запрещён)
  grid.querySelectorAll('img.card-img').forEach(img => {
    img.addEventListener('error', () => {
      const stub = document.createElement('div');
      stub.className = 'card-img placeholder';
      stub.textContent = '🎮';
      img.replaceWith(stub);
    });
  });
}

// Render table
function renderTable(headers, rows, emptyMsg = 'Записей нет') {
  const table = $('result-table');
  if (!rows || rows.length === 0) {
    table.innerHTML = `<div class="state-empty">${esc(emptyMsg)}</div>`;
    return;
  }
  table.innerHTML = `
    <table>
      <thead>
        <tr>
          ${headers.map(h => `<th>${esc(h)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr class="${row.isError ? 'row-error' : ''}">
            ${row.cells.map(cell => `<td>${esc(cell)}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// State tracking
let lastGamesQuery = {};
let lastGamesTotal = 0;

function updatePager() {
  const offset = lastGamesQuery.offset || 0;
  const limit = lastGamesQuery.limit || 20;
  $('btn-prev').disabled = offset <= 0;
  $('btn-next').disabled = offset + limit >= lastGamesTotal;
}

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
    if (data.byPlatform && Object.keys(data.byPlatform).length > 0) {
      platforms.innerHTML = '<h3>По платформам</h3>' + Object.entries(data.byPlatform).map(([name, stats]) => `
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
        <li><strong>${esc(item.title)}</strong> (${esc(item.platform)}) -${item.discount}%</li>
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

    const fPlatform = $('f-platform');
    const fPlatformName = $('f-platform-name');
    const fParsePlatform = $('f-parse-platform');

    // #f-platform with empty option
    fPlatform.innerHTML = '<option value="">Все платформы</option>' +
      platforms.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');

    // #f-platform-name without empty option, first selected
    fPlatformName.innerHTML = platforms.map((p, idx) =>
      `<option value="${esc(p)}" ${idx === 0 ? 'selected' : ''}>${esc(p)}</option>`
    ).join('');

    // #f-parse-platform with empty option
    fParsePlatform.innerHTML = '<option value="">Все платформы</option>' +
      platforms.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  } catch (e) {
    console.error('loadPlatforms error:', e);
  }
}

// Button handlers
async function loadGames() {
  try {
    $('games-grid').innerHTML = '';
    $('result-table').innerHTML = '';
    setLoading('Загрузка игр…');

    const platform = $('f-platform').value;
    const minDiscount = $('f-min-discount').value;
    const free = $('f-free').checked;
    const limit = $('f-limit').value;
    const offset = $('f-offset').value;

    const query = new URLSearchParams();
    if (platform) query.append('platform', platform);
    if (minDiscount) query.append('minDiscount', minDiscount);
    if (free) query.append('free', 'true');
    if (limit) query.append('limit', limit);
    if (offset) query.append('offset', offset);

    lastGamesQuery = { platform, minDiscount, free, limit: parseInt(limit) || 20, offset: parseInt(offset) || 0 };

    const data = await api('/api/games?' + query.toString());
    clearState();
    renderGames(data.games);
    setResult('GET /api/games', `total: ${data.total}, показано ${data.games.length}`, data);
    lastGamesTotal = data.total;
    updatePager();
  } catch (e) {
    showError(e.message);
  }
}

$('btn-games').addEventListener('click', loadGames);

$('btn-prev').addEventListener('click', () => {
  const offset = Math.max(0, (lastGamesQuery.offset || 0) - (lastGamesQuery.limit || 20));
  $('f-offset').value = offset;
  loadGames();
});

$('btn-next').addEventListener('click', () => {
  const newOffset = (lastGamesQuery.offset || 0) + (lastGamesQuery.limit || 20);
  $('f-offset').value = newOffset;
  loadGames();
});

$('btn-free').addEventListener('click', async () => {
  try {
    $('games-grid').innerHTML = '';
    $('result-table').innerHTML = '';
    setLoading('Загрузка бесплатных игр…');

    const limit = $('f-free-limit').value;
    const query = limit ? `?limit=${limit}` : '';
    const data = await api('/api/games/free' + query);
    clearState();
    renderGames(data.games);
    setResult('GET /api/games/free', `total: ${data.total}, показано ${data.games.length}`, data);
  } catch (e) {
    showError(e.message);
  }
});

$('btn-top').addEventListener('click', async () => {
  try {
    $('games-grid').innerHTML = '';
    $('result-table').innerHTML = '';
    setLoading('Загрузка топ скидок…');

    const limit = $('f-top-limit').value;
    const query = limit ? `?limit=${limit}` : '';
    const data = await api('/api/games/top-discounts' + query);
    clearState();
    renderGames(data.games);
    setResult('GET /api/games/top-discounts', `total: ${data.total}, показано ${data.games.length}`, data);
  } catch (e) {
    showError(e.message);
  }
});

$('btn-platform').addEventListener('click', async () => {
  try {
    $('games-grid').innerHTML = '';
    $('result-table').innerHTML = '';
    setLoading('Загрузка игр платформы…');

    const name = $('f-platform-name').value;
    const limit = $('f-platform-limit').value;
    const query = limit ? `?limit=${limit}` : '';
    const data = await api(`/api/games/platform/${encodeURIComponent(name)}` + query);
    clearState();
    renderGames(data.games);
    setResult(`GET /api/games/platform/${name}`, `total: ${data.total}, показано ${data.games.length}`, data);
  } catch (e) {
    showError(e.message);
  }
});

$('btn-search').addEventListener('click', async () => {
  try {
    const q = $('f-search').value;
    if (q.length < 2) {
      showError('Минимум 2 символа');
      return;
    }

    $('games-grid').innerHTML = '';
    $('result-table').innerHTML = '';
    setLoading('Поиск…');

    const data = await api(`/api/games/search?q=${encodeURIComponent(q)}`);
    clearState();
    renderGames(data.games);
    setResult('GET /api/games/search', `query: "${data.query}", total: ${data.total}, показано ${data.games.length}`, data);
  } catch (e) {
    showError(e.message);
  }
});

$('f-search').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') $('btn-search').click();
});

$('btn-title').addEventListener('click', async () => {
  try {
    const title = $('f-title').value;
    if (!title) {
      showError('Укажите название игры');
      return;
    }

    $('games-grid').innerHTML = '';
    $('result-table').innerHTML = '';
    setLoading('Загрузка…');

    const data = await api(`/api/games/${encodeURIComponent(title)}`);
    clearState();
    renderGames([data], true);
    setResult('GET /api/games/:title', `title: "${data.title}"`, data);
  } catch (e) {
    showError(e.message);
  }
});

$('f-title').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') $('btn-title').click();
});

$('btn-history').addEventListener('click', async () => {
  try {
    const title = $('f-history-title').value;
    if (!title) {
      showError('Укажите название игры');
      return;
    }

    $('games-grid').innerHTML = '';
    $('result-table').innerHTML = '';
    setLoading('Загрузка истории…');

    const data = await api(`/api/games/${encodeURIComponent(title)}/price-history`);
    clearState();

    const rows = data.history.map(h => ({
      cells: [
        fmtDate(h.createdAt),
        fmtPrice(h.oldPrice),
        fmtPrice(h.newPrice),
        `${h.oldDiscount}%`,
        `${h.newDiscount}%`
      ],
      isError: false
    }));
    renderTable(['Дата', 'Старая цена', 'Новая цена', 'Старая скидка', 'Новая скидка'], rows, 'История цен пуста');
    setResult('GET /api/games/:title/price-history', `game: "${data.game}", записей: ${data.total}`, data);
  } catch (e) {
    showError(e.message);
  }
});

$('f-history-title').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') $('btn-history').click();
});

$('btn-updates').addEventListener('click', async () => {
  try {
    $('games-grid').innerHTML = '';
    $('result-table').innerHTML = '';
    setLoading('Загрузка логов…');

    const limit = $('f-updates-limit').value;
    const query = limit ? `?limit=${limit}` : '';
    const data = await api('/api/admin/updates' + query);
    clearState();

    const rows = data.logs.map(log => ({
      cells: [
        fmtDate(log.createdAt),
        log.platform,
        String(log.gamesCount),
        String(log.newGames),
        String(log.updatedGames),
        String(log.freedGames),
        `${log.duration} мс`,
        log.status,
        text(log.error)
      ],
      isError: log.status !== 'success'
    }));
    renderTable(['Дата', 'Платформа', 'Игр', 'Новых', 'Обновлено', 'Бесплатных', 'Длительность', 'Статус', 'Ошибка'], rows, 'Логов пока нет');
    setResult('GET /api/admin/updates', `total: ${data.total}, показано ${data.logs.length}`, data);
  } catch (e) {
    showError(e.message);
  }
});

$('btn-platforms').addEventListener('click', async () => {
  try {
    $('games-grid').innerHTML = '';
    $('result-table').innerHTML = '';
    setLoading('Загрузка списка платформ…');

    const data = await api('/api/admin/platforms');
    clearState();

    const rows = data.platforms.map(p => ({
      cells: [p],
      isError: false
    }));
    renderTable(['Платформа'], rows);
    setResult('GET /api/admin/platforms', `total: ${data.total}`, data);
  } catch (e) {
    showError(e.message);
  }
});

$('btn-parse').addEventListener('click', async () => {
  try {
    const platform = $('f-parse-platform').value;

    $('games-grid').innerHTML = '';
    $('result-table').innerHTML = '';
    setLoading('Парсинг…');

    $('btn-parse').disabled = true;
    $('btn-parse').textContent = 'Парсинг…';
    $('parse-status').textContent = platform
      ? `Парсим ${platform}, это может занять время…`
      : 'Парсим все платформы, это может занять время…';

    const body = platform ? { platform } : {};
    const data = await api('/api/admin/parse', { method: 'POST', body });

    // Сначала обновляем список игр, потом поверх выводим результат парсинга
    await loadGames();
    clearState();

    const results = data.result ? [data.result] : (data.results || []);
    const rows = results.map(r => ({
      cells: [
        r.platform,
        String(r.total),
        String(r.new),
        String(r.updated),
        String(r.freed),
        text(r.error)
      ],
      isError: !!r.error
    }));
    renderTable(['Платформа', 'Всего', 'Новых', 'Обновлено', 'Бесплатных', 'Ошибка'], rows);
    setResult('POST /api/admin/parse', `результатов: ${results.length}`, data);

    $('parse-status').textContent = data.message || 'Готово';

    await loadHealth();
    await loadStats();
  } catch (e) {
    $('parse-status').textContent = '';
    showError(e.message);
  } finally {
    $('btn-parse').disabled = false;
    $('btn-parse').textContent = 'Запустить парсинг';
  }
});

$('btn-stats').addEventListener('click', loadStats);

$('btn-health').addEventListener('click', loadHealth);

$('refresh-all').addEventListener('click', async () => {
  await Promise.all([loadHealth(), loadStats(), loadPlatforms()]);
  await loadGames();
});

// Init on load (скрипт с defer — DOM уже разобран)
(async () => {
  await Promise.all([loadHealth(), loadStats(), loadPlatforms()]);
  await loadGames();
})();
