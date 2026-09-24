'use strict';

// Общий код главной страницы и админки (public/app.js и public/admin.js)

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

// Formatters
function fmtPrice(v, currency) {
  if (v === null || v === undefined) return '—';
  if (v === 0) return 'Бесплатно';
  if (currency) {
    try {
      return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(v);
    } catch {
      // Неизвестный код валюты — показываем голое число
    }
  }
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

// Бейджи для всего, что не полноценная игра (ключи — GAME_KINDS из src/types.ts)
const KIND_LABELS = { demo: 'Демо', dlc: 'DLC', kit: 'Kit' };

// Отрисовка карточек в произвольную сетку
function renderCards(grid, games, expanded = false) {
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

    // Позиции вишлиста, которых нет в продаже в нашем регионе, приходят без цены
    const priceHtml = game.unavailable
      ? `<div class="card-price card-price-none">Нет в продаже в регионе</div>`
      : game.isFree
        ? `<div class="card-price">Бесплатно</div>`
        : `<div class="card-price"><span class="current">${esc(fmtPrice(game.currentPrice, game.currency))}</span>${game.originalPrice && game.originalPrice !== game.currentPrice ? `<s class="original">${esc(fmtPrice(game.originalPrice, game.currency))}</s>` : ''}</div>`;

    const badgesHtml = `
      <div class="badges">
        <span class="badge badge-platform">${esc(game.platform)}</span>
        ${KIND_LABELS[game.kind] ? `<span class="badge badge-kind">${KIND_LABELS[game.kind]}</span>` : ''}
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
                Цена: ${esc(fmtPrice(h.oldPrice, game.currency))} → ${esc(fmtPrice(h.newPrice, game.currency))}<br>
                Скидка: ${h.oldDiscount}% → ${h.newDiscount}%
              </li>
            `).join('')}
          </ul>
        </details>`
      : '';

    // У позиций вишлиста нет записи в базе — печатать «ID: undefined» незачем
    const metaHtml = game.id === undefined
      ? ''
      : `<p class="card-meta">ID: ${esc(game.id)}</p><p class="card-meta">Создано: ${esc(fmtDate(game.createdAt))}</p><p class="card-meta">Обновлено: ${esc(fmtDate(game.updatedAt))}</p>`;

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

// ---- Всплывающие уведомления ----
function showToast(kind, title, lines = []) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  toast.innerHTML = `
    <p class="toast-title">${esc(title)}</p>
    ${lines.length > 0
      ? `<ul class="toast-lines">${lines.map(l => `<li class="${l.isError ? 'is-error' : ''}">${esc(l.text)}</li>`).join('')}</ul>`
      : ''}
  `;

  let timer = null;
  const close = () => {
    clearTimeout(timer);
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 200);
  };
  toast.addEventListener('click', close);
  timer = setTimeout(close, kind === 'error' ? 10000 : 6000);

  $('toasts').appendChild(toast);
}

// Тема (значение уже проставлено инлайн-скриптом в <head>)
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // в тёмной показываем ☀️ («включить светлую»), в светлой — 🌙
  $('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
}

applyTheme(document.documentElement.dataset.theme || 'dark');

$('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('theme', next); } catch (e) {}
});

// Пока пользователь не сделал явный выбор — следуем за системой вживую
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
  let stored = null;
  try { stored = localStorage.getItem('theme'); } catch (err) {}
  if (!stored) applyTheme(e.matches ? 'light' : 'dark');
});
