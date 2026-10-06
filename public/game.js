'use strict';

// Страница одной игры: /game.html?slug=<slug> или /game.html?steamAppId=<appId>.
// Данные — GET /api/games/slug/:slug, для игр вишлиста без записи в базе —
// GET /api/wishlist/app/:appId в той же форме. Помощники (api, esc, fmtPrice, fmtDate,
// KIND_LABELS) приходят из common.js.

function setState(cls, msg, html = null) {
  const el = $('game-state');
  el.className = cls;
  // html — только для собственных подсказок страницы, ввод пользователя в него не попадает
  if (html === null) el.textContent = msg;
  else el.innerHTML = html;
}

function clearState() {
  setState('', '');
}

// Цена магазина в его валюте плюс рублёвый эквивалент, если валюта не рублёвая
function offerPriceHtml(offer) {
  if (offer.isFree) return '<span class="game-offer-price">Бесплатно</span>';
  if (offer.currentPrice === null) return '<span class="game-offer-none">Цены нет</span>';

  const original =
    offer.originalPrice && offer.originalPrice !== offer.currentPrice
      ? `<s class="original">${esc(fmtPrice(offer.originalPrice, offer.currency))}</s>`
      : '';

  const rub =
    offer.currency !== 'RUB' && offer.currentPriceRub !== null
      ? `<span class="game-offer-rub">≈ ${esc(fmtPrice(offer.currentPriceRub, 'RUB'))}</span>`
      : '';

  return `<span class="game-offer-price">${esc(fmtPrice(offer.currentPrice, offer.currency))}</span>${original}${rub}`;
}

function historyHtml(offer) {
  if (!offer.priceHistory || offer.priceHistory.length === 0) return '';

  return `
    <details class="card-history">
      <summary>История цен в ${esc(offer.storeName)} (${offer.priceHistory.length})</summary>
      <ul class="history-list">
        ${offer.priceHistory.map(h => `
          <li>
            <strong>${esc(fmtDate(h.createdAt))}</strong><br>
            Цена: ${esc(fmtPrice(h.oldPrice, offer.currency))} ${icon('arrow-right')} ${esc(fmtPrice(h.newPrice, offer.currency))}<br>
            Скидка: ${h.oldDiscount}% ${icon('arrow-right')} ${h.newDiscount}%
          </li>
        `).join('')}
      </ul>
    </details>`;
}

function offersHtml(offers) {
  if (offers.length === 0) {
    return '<p class="game-offers-empty">Ни в одном магазине сейчас нет предложения по этой игре</p>';
  }

  // Лучшее — первое с ценой: сервис уже отсортировал по рублёвому эквиваленту
  const best = offers.find(o => o.currentPrice !== null || o.isFree);

  const rows = offers.map(offer => `
    <tr class="${offer === best && offers.length > 1 ? 'game-offer-best' : ''}">
      <td>
        <span class="badge badge-platform">${esc(offer.platform)}</span>
        ${offer === best && offers.length > 1 ? '<span class="badge badge-free">Дешевле всего</span>' : ''}
      </td>
      <td>${offerPriceHtml(offer)}</td>
      <td>${offer.discountPercent > 0 ? `<span class="badge badge-discount">-${offer.discountPercent}%</span>` : '—'}</td>
      <td>${offer.saleEndDate ? esc(fmtDate(offer.saleEndDate)) : '—'}</td>
      <td><a href="${esc(offer.gameUrl)}" target="_blank" rel="noopener">Купить ${icon('arrow-right', 'icon-external')}</a></td>
    </tr>
  `).join('');

  return `
    <div class="game-offers-scroll">
      <table class="game-offers">
        <thead>
          <tr>
            <th>Магазин</th>
            <th>Цена</th>
            <th>Скидка</th>
            <th>Акция до</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${offers.map(historyHtml).join('')}`;
}

function renderGame(game) {
  const root = $('game-root');

  const imgHtml = game.imageUrl
    ? `<img class="game-img" src="${esc(game.imageUrl)}" alt="${esc(game.title)}">`
    : '<div class="game-img placeholder"></div>';

  const maxDiscount = game.offers.reduce((acc, o) => Math.max(acc, o.discountPercent), 0);
  const badgesHtml = `
    <div class="badges">
      ${KIND_LABELS[game.kind] ? `<span class="badge badge-kind">${KIND_LABELS[game.kind]}</span>` : ''}
      ${game.offers.some(o => o.isFree) ? '<span class="badge badge-free">FREE</span>' : ''}
      ${maxDiscount > 0 ? `<span class="badge badge-discount">-${maxDiscount}%</span>` : ''}
      <span class="badge badge-platform">Магазинов: ${game.offers.length}</span>
    </div>`;

  const tagsHtml = game.tags && game.tags.length > 0
    ? `<ul class="card-tags">${game.tags.map(t => `<li class="card-tag">${esc(t.name)}</li>`).join('')}</ul>`
    : '';

  const descHtml = game.description
    ? `<p class="game-desc">${esc(game.description)}</p>`
    : '<p class="game-desc game-desc-empty">Магазины не дали описания к этой игре</p>';

  root.innerHTML = `
    <div class="game-hero">
      ${imgHtml}
      <div class="game-hero-body">
        <h2>${esc(game.title)}</h2>
        ${badgesHtml}
        ${tagsHtml}
        ${descHtml}
      </div>
    </div>
    ${offersHtml(game.offers)}
    ${game.id ? `<p class="card-meta">ID: ${esc(game.id)} · slug: ${esc(game.slug)}</p>` : ''}
    ${game.createdAt ? `<p class="card-meta">Создано: ${esc(fmtDate(game.createdAt))}</p>` : ''}
    ${game.updatedAt ? `<p class="card-meta">Обновлено: ${esc(fmtDate(game.updatedAt))}</p>` : ''}
  `;

  // Битая обложка: повторы, затем заглушка (инлайновый onerror запрещён)
  const img = root.querySelector('img.game-img');
  if (img) watchImage(img);

  root.hidden = false;
}

function showGame(game) {
  clearState();
  document.title = `${game.title} — Game Deals Monitor`;
  renderGame(game);
}

// Игра из вишлиста: если она есть в базе, открываем обычную страницу по slug
async function loadSteamGame(appId) {
  if (!/^\d+$/.test(appId) || Number(appId) <= 0) {
    return setState('state-empty', '', 'Некорректный идентификатор игры Steam. <a href="/">Вернуться к списку</a>');
  }

  setState('state-loading', 'Загрузка…');

  try {
    const app = await api(`/api/wishlist/app/${appId}`);

    if (app.slug) {
      // replaceState: в истории остаётся одна запись, «назад» ведёт к списку
      history.replaceState(null, '', `/game.html?slug=${encodeURIComponent(app.slug)}`);
      try {
        return showGame(await api(`/api/games/slug/${encodeURIComponent(app.slug)}`));
      } catch {
        // Страница по slug недоступна — показываем то, что отдал Steam
      }
    }

    showGame(app);
  } catch (e) {
    $('game-root').hidden = true;
    if (/не найдена/i.test(e.message)) {
      setState('state-empty', '', 'Steam не знает такой игры. <a href="/">Вернуться к списку</a>');
    } else {
      setState('state-error', `Не удалось загрузить игру из Steam: ${e.message}`);
    }
  }
}

async function loadGame() {
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug');
  const steamAppId = params.get('steamAppId');

  if (!slug && steamAppId) {
    return loadSteamGame(steamAppId);
  }

  if (!slug) {
    return setState('state-empty', '', 'Игра не указана. <a href="/">Вернуться к списку</a>');
  }

  setState('state-loading', 'Загрузка…');

  try {
    showGame(await api(`/api/games/slug/${encodeURIComponent(slug)}`));
  } catch (e) {
    $('game-root').hidden = true;
    if (/не найдена/i.test(e.message)) {
      setState('state-empty', '', 'Такой игры нет в базе. <a href="/">Вернуться к списку</a>');
    } else {
      setState('state-error', e.message);
    }
  }
}

loadGame();
