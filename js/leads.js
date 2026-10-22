/* ============================================================
   Входящие лиды — находки программы поиска клиентов (leads/monitor.py).

   Программа поиска сама кладёт найденные запросы и тендеры в коллекцию
   Firestore `leads`. Здесь — список с фильтрами, ответ в один тап,
   статусы, перевод лида в клиента + сделку и аналитика по источникам.
   Работает только в облачном режиме (Firebase).
   ============================================================ */
'use strict';

const Leads = (() => {
  const STATUSES = [
    { id: 'new',      name: '🆕 Новый' },
    { id: 'written',  name: '✍️ Написали' },
    { id: 'replied',  name: '💬 Ответил' },
    { id: 'priced',   name: '🧮 Посчитал цену' },
    { id: 'booked',   name: '✅ Бронь' },
    { id: 'declined', name: '❌ Отказ' },
    { id: 'junk',     name: '🗑 Не лид' },
  ];
  const STATUS_NAME = Object.fromEntries(STATUSES.map(s => [s.id, s.name]));
  const LEVEL = { hot: '🔥', warm: '🙂', tender: '📑' };

  let list = [];
  let loaded = false;
  let filter = 'active';

  function db() { return (typeof Cloud !== 'undefined' && Cloud.active() && Cloud.db) ? Cloud.db() : null; }

  function start() {
    const d = db();
    if (!d) return;
    d.collection('leads').orderBy('foundAt', 'desc').limit(500).onSnapshot(snap => {
      list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loaded = true;
      renderBadge();
      if (typeof currentView !== 'undefined' && currentView === 'leads') render();
    }, err => {
      console.error('leads sync error', err);
      loaded = true;
      list = [];
      const box = document.getElementById('leads-list');
      if (box) box.innerHTML = `<div class="empty"><div class="empty-emoji">⚠️</div><p>Нет доступа к лидам. Обновите правила базы в Firebase (файл firestore.rules).</p></div>`;
    });
  }

  function renderBadge() {
    const b = document.getElementById('badge-leads');
    if (b) b.textContent = list.filter(l => (l.status || 'new') === 'new').length || '';
  }

  function srcGroup(l) {
    if (l.kind === 'tender') return 'Тендеры';
    if ((l.source || '').startsWith('ВК')) return (l.source || '').includes('комментарий') ? 'ВК: комментарии' : 'ВКонтакте';
    if ((l.source || '').startsWith('@')) return 'Telegram';
    return 'Другое';
  }

  function render() {
    const box = document.getElementById('leads-list');
    if (!box) return;
    if (!db()) {
      document.getElementById('leads-metric').innerHTML = '';
      document.getElementById('leads-filters').innerHTML = '';
      document.getElementById('leads-sources').innerHTML = '';
      box.innerHTML = `<div class="empty"><div class="empty-emoji">☁️</div><p>Лиды доступны в облачном режиме CRM (вход по email).</p></div>`;
      return;
    }
    if (!loaded) { box.innerHTML = `<div class="empty"><p>Загружаю лиды…</p></div>`; return; }

    const st = l => l.status || 'new';
    const active = list.filter(l => !['booked', 'declined', 'junk'].includes(st(l)));
    const booked = list.filter(l => st(l) === 'booked').length;
    const real = list.filter(l => st(l) !== 'junk').length;
    document.getElementById('leads-metric').innerHTML = `
      <div class="kpi"><div class="kpi-num">${list.filter(l => st(l) === 'new').length} <span class="kpi-emoji">🆕</span></div><div class="kpi-label">новых</div></div>
      <div class="kpi"><div class="kpi-num">${active.length}</div><div class="kpi-label">в работе</div></div>
      <div class="kpi"><div class="kpi-num" style="color:var(--success)">${booked}</div><div class="kpi-label">броней</div></div>
      <div class="kpi"><div class="kpi-num">${real ? Math.round(booked / real * 100) + '%' : '—'}</div><div class="kpi-label">конверсия в бронь</div></div>`;

    const chips = [['active', `В работе (${active.length})`], ['new', `Новые (${list.filter(l => st(l) === 'new').length})`],
      ['tender', `📑 Тендеры (${list.filter(l => l.kind === 'tender').length})`], ['all', `Все (${list.length})`]];
    document.getElementById('leads-filters').innerHTML = chips.map(([k, label]) =>
      `<button class="btn btn-sm ${filter === k ? 'btn-primary' : ''}" data-lfilter="${k}">${label}</button>`).join('');

    const shown = list.filter(l =>
      filter === 'all' ? true :
      filter === 'new' ? st(l) === 'new' :
      filter === 'tender' ? l.kind === 'tender' :
      !['booked', 'declined', 'junk'].includes(st(l)));
    box.innerHTML = shown.length ? shown.map(cardHtml).join('')
      : `<div class="empty"><div class="empty-emoji">🎯</div><p>${list.length ? 'В этом фильтре пусто.' : 'Лидов пока нет. Программа поиска проверяет ВКонтакте и Telegram каждые полчаса — находки появятся здесь и в боте.'}</p></div>`;

    renderSources();
  }

  function cardHtml(l) {
    const st = l.status || 'new';
    const when = l.postDate ? new Date(l.postDate) : new Date(l.foundAt || Date.now());
    const date = when.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const text = esc(l.text || '');
    return `<div class="card lead-card ${st === 'new' ? 'lead-new' : ''}" data-lid="${esc(l.id)}">
      <div class="lead-head">
        <span class="lead-level">${LEVEL[l.kind === 'tender' ? 'tender' : l.level] || '🙂'}</span>
        <span class="lead-src">${esc(l.source || '')}</span>
        <span class="lead-date">${date}</span>
      </div>
      <div class="lead-text">${text.length > 400 ? text.slice(0, 400) + '…' : text}</div>
      ${l.extra ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(l.extra)}</div>` : ''}
      <div class="btn-row lead-actions">
        ${l.url ? `<a class="btn btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">🔗 ${l.kind === 'tender' ? 'Закупка' : 'Пост'}</a>` : ''}
        ${l.author ? `<a class="btn btn-sm" href="${esc(l.author)}" target="_blank" rel="noopener">👤 Автор</a>` : ''}
        ${l.draft ? `<button class="btn btn-sm" data-lcopy="${esc(l.id)}">📋 Копировать ответ</button>` : ''}
        ${l.clientId ? `<button class="btn btn-sm" data-lclient="${esc(l.clientId)}">👥 Клиент</button>`
                     : (l.kind === 'tender' ? '' : `<button class="btn btn-sm btn-primary" data-ltoclient="${esc(l.id)}">➕ В клиенты</button>`)}
      </div>
      <div class="lead-status">
        <select data-lstatus="${esc(l.id)}">
          ${STATUSES.map(s => `<option value="${s.id}" ${s.id === st ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
      </div>
    </div>`;
  }

  function renderSources() {
    const by = {};
    for (const l of list) {
      if ((l.status || 'new') === 'junk') continue;
      const g = srcGroup(l);
      by[g] = by[g] || { total: 0, booked: 0 };
      by[g].total++;
      if (l.status === 'booked') by[g].booked++;
    }
    const rows = Object.entries(by).sort((a, b) => b[1].total - a[1].total);
    document.getElementById('leads-sources').innerHTML = rows.length ? rows.map(([g, s]) => `
      <div class="list-item">
        <div class="li-body"><div class="li-title">${esc(g)}</div>
          <div class="li-sub">лидов: ${s.total} · броней: ${s.booked}</div></div>
        <div class="li-right"><span class="li-days">${s.total ? Math.round(s.booked / s.total * 100) : 0}%</span></div>
      </div>`).join('') : '<p class="muted">Появится, когда будут лиды.</p>';
  }

  function update(id, data) {
    const d = db();
    if (!d) return Promise.reject(new Error('нет облака'));
    return d.collection('leads').doc(id).update({ ...data, updatedAt: Date.now(), updatedBy: Cloud.userEmail() })
      .catch(e => { toast('⚠️ Не удалось сохранить: ' + e.message, 'error'); throw e; });
  }

  function toClient(id) {
    const l = list.find(x => x.id === id);
    if (!l) return;
    const g = srcGroup(l);
    const source = g.startsWith('ВК') ? 'ВКонтакте' : (g === 'Telegram' ? 'Telegram' : 'Другое');
    const name = (prompt('Как назвать клиента?', 'Лид: ' + (l.source || '')) || '').trim();
    if (!name) return;
    const client = {
      id: uid(), name, phone: '', type: 'person', address: '', source,
      notes: `Найден программой поиска (${l.source || ''}).\nЗапрос: ${l.text || ''}\n${l.url || ''}${l.author ? '\nАвтор: ' + l.author : ''}`,
      tags: ['лид из поиска'], holidays: [], createdAt: Date.now(), leadId: l.id,
    };
    const deal = {
      id: uid(), clientId: client.id, service: 'dm', title: 'Дед Мороз — заявка из поиска',
      date: '', time: '', amount: 0, prepaid: 0, address: '', note: l.url || '',
      stage: 'new', source, createdAt: Date.now(),
    };
    state.clients.push(client);
    state.deals.push(deal);
    save();
    update(l.id, { clientId: client.id, status: l.status === 'new' ? 'written' : (l.status || 'written') }).catch(() => {});
    toast('✅ Клиент и сделка созданы', 'success');
    openClientDetail(client.id);
  }

  function bind() {
    const root = document.getElementById('view-leads');
    if (!root) return;
    root.addEventListener('click', e => {
      const f = e.target.closest('[data-lfilter]');
      if (f) { filter = f.dataset.lfilter; render(); return; }
      const c = e.target.closest('[data-lcopy]');
      if (c) {
        const l = list.find(x => x.id === c.dataset.lcopy);
        if (!l) return;
        copyToClipboard(l.draft)
          .then(() => toast('✅ Ответ скопирован — вставьте в чат', 'success'))
          .catch(() => toast('Не удалось скопировать', 'error'));
        if ((l.status || 'new') === 'new') update(l.id, { status: 'written' }).catch(() => {});
        return;
      }
      const tc = e.target.closest('[data-ltoclient]');
      if (tc) { toClient(tc.dataset.ltoclient); return; }
      const oc = e.target.closest('[data-lclient]');
      if (oc) { openClientDetail(oc.dataset.lclient); return; }
    });
    root.addEventListener('change', e => {
      const s = e.target.closest('[data-lstatus]');
      if (s) update(s.dataset.lstatus, { status: s.value }).then(() => toast(STATUS_NAME[s.value], 'success')).catch(() => {});
    });
  }

  return { start, render, bind, renderBadge };
})();
