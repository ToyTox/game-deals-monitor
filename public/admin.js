'use strict';

// Админка: ручки API и сырой ответ сервера. Общее — в public/common.js

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

// Render games
function renderGames(games, expanded = false) {
  if (!games || games.length === 0) {
    showEmpty('Ничего не найдено');
    return;
  }
  clearState();
  renderCards($('games-grid'), games, expanded);
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
        fmtPrice(h.oldPrice, data.currency),
        fmtPrice(h.newPrice, data.currency),
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
  } catch (e) {
    $('parse-status').textContent = '';
    showError(e.message);
  } finally {
    $('btn-parse').disabled = false;
    $('btn-parse').textContent = 'Запустить парсинг';
  }
});

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

$('btn-stats').addEventListener('click', loadStats);

// Состояние сервиса: health, время последнего обновления, типичная длительность парсинга
async function loadServiceStatus() {
  const [health, stats, estimate] = await Promise.allSettled([
    api('/api/admin/health'),
    api('/api/admin/stats'),
    api('/api/admin/parse-estimate')
  ]);

  const healthText = health.status === 'fulfilled'
    ? `ok · uptime ${fmtUptime(health.value.uptime)}`
    : 'недоступен';
  const lastUpdate = stats.status === 'fulfilled' ? fmtDate(stats.value.lastUpdate) : '—';
  const est = estimate.status === 'fulfilled' ? estimate.value : null;

  $('service-tiles').innerHTML = `
    <div class="stat-tile">
      <div class="stat-value" id="service-health">${esc(healthText)}</div>
      <div class="stat-label">Статус сервиса</div>
    </div>
    <div class="stat-tile">
      <div class="stat-value" id="service-last-update">${esc(lastUpdate)}</div>
      <div class="stat-label">Последнее обновление данных</div>
    </div>
    <div class="stat-tile">
      <div class="stat-value" id="service-parse-total">${est && est.total ? esc(fmtApprox(est.total)) : '—'}</div>
      <div class="stat-label">Обычно парсинг всех площадок</div>
    </div>
  `;

  const platforms = est && est.platforms ? [...est.platforms].sort((a, b) => b.duration - a.duration) : [];
  $('service-estimate').innerHTML = platforms.length > 0
    ? '<h3>Длительность парсинга по площадкам</h3>' + platforms.map(p => `
        <div class="platform-stat">
          <div class="platform-name">${esc(p.platform)}</div>
          <div class="platform-stats">${esc(fmtApprox(p.duration))}</div>
        </div>
      `).join('')
    : '';
}

// Списки платформ в формах ручек
async function loadPlatforms() {
  try {
    const data = await api('/api/admin/platforms');
    const platforms = data.platforms || [];

    const options = platforms.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');

    // #f-platform и #f-parse-platform — с пустым вариантом «все»
    $('f-platform').innerHTML = '<option value="">Все платформы</option>' + options;
    $('f-parse-platform').innerHTML = '<option value="">Все платформы</option>' + options;

    // #f-platform-name — без пустого варианта, выбран первый
    $('f-platform-name').innerHTML = platforms.map((p, idx) =>
      `<option value="${esc(p)}" ${idx === 0 ? 'selected' : ''}>${esc(p)}</option>`
    ).join('');
  } catch (e) {
    console.error('loadPlatforms error:', e);
  }
}

// Init on load (скрипт с defer — DOM уже разобран)
loadServiceStatus();
loadStats();
showEmpty('Выберите ручку API выше — результат появится здесь');
loadPlatforms();
