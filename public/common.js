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

// Пиксельная иконка из /icons (маска в CSS, цвет — по тексту вокруг)
function icon(name, extra = '') {
  return `<span class="icon icon-${name}${extra ? ` ${extra}` : ''}" aria-hidden="true"></span>`;
}

// ---- Загрузка картинок: повторы и восстановление ----
// Обложка может не загрузиться из-за плавающего сбоя сети. Битую картинку
// перезагружаем несколько раз с растущей паузой, и только потом ставим заглушку.
// Заглушка хранит исходный URL и оживает при возврате сети или на вкладку.
const IMG_RETRY_LIMIT = 3;
let imgRetryDelay = 1500;

// Тот же URL с меняющимся параметром — браузер не отдаст закэшированную ошибку
function imgRetryUrl(url, attempt) {
  try {
    const u = new URL(url, location.href);
    u.searchParams.set('_retry', `${attempt}-${Date.now()}`);
    return u.href;
  } catch {
    return url;
  }
}

// Битая картинка → заглушка того же класса с исходным URL
function imageToStub(img, url) {
  const stub = document.createElement('div');
  stub.className = `${img.className} placeholder`;
  stub.dataset.imgSrc = url;
  stub.dataset.imgAlt = img.alt || '';
  stub.setAttribute('role', 'img');
  stub.setAttribute('aria-label', img.alt || '');
  img.replaceWith(stub);
}

// Следит за картинкой; giveUp(img, url) вызывается, когда попытки исчерпаны.
// Новый src, выставленный не нами (другой профиль), начинает отсчёт заново.
function watchImage(img, giveUp = imageToStub) {
  let origin = null;
  let lastRetry = null;
  let attempt = 0;

  img.addEventListener('error', () => {
    const current = img.getAttribute('src');
    if (current !== lastRetry) {
      origin = current;
      attempt = 0;
    }
    if (!origin) return;
    if (attempt >= IMG_RETRY_LIMIT) return giveUp(img, origin);

    attempt++;
    setTimeout(() => {
      if (!img.isConnected || img.getAttribute('src') !== current) return;
      lastRetry = imgRetryUrl(origin, attempt);
      img.src = lastRetry;
    }, imgRetryDelay * attempt);
  });
}

// Аватар: после исчерпания попыток прячем, исходный URL помним для восстановления
function hideFailedImage(img, url) {
  img.hidden = true;
  img.dataset.imgFailed = url;
}

// Сеть вернулась или пользователь вернулся на вкладку: оживляем всё, что сдалось
function retryFailedImages() {
  document.querySelectorAll('div[data-img-src]').forEach(stub => {
    const img = document.createElement('img');
    img.className = stub.className.replace(/\s*\bplaceholder\b/, '');
    img.alt = stub.dataset.imgAlt || '';
    img.src = imgRetryUrl(stub.dataset.imgSrc, 1);
    watchImage(img);
    stub.replaceWith(img);
  });

  document.querySelectorAll('img[data-img-failed]').forEach(img => {
    const url = img.dataset.imgFailed;
    delete img.dataset.imgFailed;
    img.hidden = false;
    img.src = imgRetryUrl(url, 1);
  });
}

window.addEventListener('online', retryFailedImages);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) retryFailedImages();
});

// Статус ITAD (заполняется в app.js до отрисовки карточек)
let itadStatus = null;

// Отрисовка карточек в произвольную сетку
function renderCards(grid, games, expanded = false) {
  grid.innerHTML = games.map(game => {
    const imgHtml = game.imageUrl
      ? `<img class="card-img" src="${esc(game.imageUrl)}" alt="${esc(game.title)}" loading="lazy">`
      : '<div class="card-img placeholder"></div>';

    const saleEndDateHtml = game.saleEndDate
      ? `<p class="card-sale">Акция до: ${esc(fmtDate(game.saleEndDate))}</p>`
      : '';

    // В сетке описание не показываем — оно на странице игры (game.html).
    // Развёрнутая карточка осталась только в админке, там текст к месту.
    const descHtml = expanded && game.description
      ? `<p class="card-desc">${esc(game.description)}</p>`
      : '';

    // В компактной карточке — только первый тег
    const tagsHtml = game.tags && game.tags.length > 0
      ? `<p class="card-tag card-tag-single">${esc(game.tags[0].name)}</p>`
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

    // Заголовок — ссылка на страницу игры, растянутая на всю карточку (.card-link::after),
    // поэтому вложенных ссылок нет, а фокус и Enter работают как у обычной ссылки.
    // У позиций вишлиста записи в базе может не быть: их страница открывается
    // по appId из Steam. Ссылка в магазин — отдельной строкой у всех.
    const gamePageUrl = game.slug
      ? `/game.html?slug=${encodeURIComponent(game.slug)}`
      : `/game.html?steamAppId=${encodeURIComponent(game.appId)}`;
    const titleHtml = `<h3><a class="card-link" href="${gamePageUrl}">${esc(game.title)}</a></h3>
         <p class="card-store-link"><a href="${esc(game.gameUrl)}" target="_blank" rel="noopener">В магазине ${icon('arrow-right', 'icon-external')}</a></p>`;

    // Кнопка динамики цены для Steam, GOG и Epic: рисуется, только если ITAD включён.
    // appid — из вишлиста или ссылки на игру; без него запрос уходит по названию
    const dynamicsAppId = game.appId ? String(game.appId) : (game.gameUrl?.match(/\/app\/(\d+)/)?.[1] || '');
    const priceDynamicsBtn = (itadStatus?.enabled && (game.platform === 'steam' || game.platform === 'gog' || game.platform === 'epic'))
      ? `<button class="btn-price-dynamics" type="button" data-platform="${esc(game.platform)}" data-app-id="${esc(dynamicsAppId)}" data-title="${esc(game.title)}">${icon('chart')} Динамика цены</button>`
      : '';

    const priceDynamicsBlock = `<div class="card-dynamics" hidden>
      <div class="dynamics-state">Загрузка…</div>
      <div class="dynamics-content"></div>
    </div>`;

    return `
      <article class="card${expanded ? ' card-expanded' : ''}">
        ${imgHtml}
        <div class="card-content">
          ${badgesHtml}
          ${titleHtml}
          ${priceHtml}
          ${saleEndDateHtml}
          ${descHtml}
          ${tagsHtml}
          ${priceDynamicsBtn}
          ${priceDynamicsBlock}
        </div>
      </article>
    `;
  }).join('');

  // Битая обложка: повторы, затем заглушка (инлайновый onerror запрещён)
  grid.querySelectorAll('img.card-img').forEach(img => watchImage(img));
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
  // в тёмной показываем солнце («включить светлую»), в светлой — луну
  $('theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
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

// Оформление: пиксельное (по умолчанию) или обычное; значение уже проставлено инлайн-скриптом в <head>
function applyStyle(style) {
  document.documentElement.dataset.style = style;
  const btn = $('style-toggle');
  // подпись показывает, что включится по клику
  const label = style === 'pixel' ? 'Включить обычное оформление' : 'Включить пиксельное оформление';
  btn.textContent = style === 'pixel' ? 'Aa' : 'PX';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

applyStyle(document.documentElement.dataset.style === 'plain' ? 'plain' : 'pixel');

$('style-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.style === 'plain' ? 'pixel' : 'plain';
  applyStyle(next);
  try { localStorage.setItem('style', next); } catch (e) {}
});
