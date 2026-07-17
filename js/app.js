/* ============================================================
   MakeDay CRM — клиенты, праздники, сделки
   Данные: localStorage. Экспорт/импорт: JSON, Excel (SheetJS).
   ============================================================ */
'use strict';

const STORE_KEY = 'makeday_crm_v1';

const SERVICES = {
  dm:    { name: 'Дед Мороз + Снегурочка', emoji: '🎅', color: '#3b82f6' },
  doll:  { name: 'Ростовая кукла',          emoji: '🐻', color: '#a855f7' },
  foam:  { name: 'Пенная вечеринка',        emoji: '💦', color: '#06b6d4' },
  cotton:{ name: 'Выездная вата',           emoji: '🍬', color: '#f472b6' },
  combo: { name: 'Комбо',                   emoji: '🎉', color: '#ef4444' },
  other: { name: 'Другое',                  emoji: '✨', color: '#64748b' },
};

const STAGES = [
  { id: 'new',       name: '📥 Новая заявка',  color: '#64748b' },
  { id: 'talk',      name: '💬 Переговоры',    color: '#f59e0b' },
  { id: 'prepaid',   name: '💳 Предоплата',    color: '#8b5cf6' },
  { id: 'confirmed', name: '✅ Подтверждён',   color: '#3b82f6' },
  { id: 'done',      name: '🏁 Выполнен',      color: '#22c55e' },
  { id: 'cancelled', name: '❌ Отменён',       color: '#ef4444' },
];
const OPEN_STAGES = ['new', 'talk', 'prepaid', 'confirmed'];

const SOURCES = ['Авито', 'ВКонтакте', 'Сарафанное радио', 'Рассылка', 'Повторный клиент', 'Instagram', 'Telegram', 'Другое'];

/* ---------------- state ---------------- */
let state = { clients: [], deals: [], seeded: false };
let currentView = 'dashboard';
let calCursor = new Date();
let calSelected = todayStr();
let importParsed = null; // {headers, rows, mapping}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { state = JSON.parse(raw); return; }
  } catch (e) { console.warn('load failed', e); }
  seed();
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

/* ---------------- seed (реальные предстоящие заказы Влада из Notion) ---------------- */
function seed() {
  const y = new Date().getFullYear();
  const mkClient = (name, phone, extra = {}) => ({
    id: uid(), name, phone: phone || '', type: 'person', address: '', source: '',
    notes: '', tags: [], holidays: [], createdAt: Date.now(), ...extra,
  });
  const elena = mkClient('Елена (Ника, Вика, Алиса)', '', {
    notes: 'Постоянный клиент: Дед Мороз + Снегурочка для трёх дочек.',
    tags: ['постоянный', 'ДМ+СГ'],
    holidays: [{ id: uid(), title: 'Новый год — визит ДМ+СГ', date: `${y}-12-31`, yearly: true }],
  });
  const lubov = mkClient('Любовь', '', {
    tags: ['пена'],
    notes: 'Пенная вечеринка, предоплата 1500 внесена.',
  });
  const anna = mkClient('Анна (Мила Лема)', '', {
    tags: ['пена'],
    notes: '2 бочки пены + челлендж + 2 красителя.',
  });
  const jubilee = mkClient('Юбилей 50 лет (VIP-беседка)', '', {
    tags: ['юбилей'],
    holidays: [{ id: uid(), title: 'Юбилей', date: `${y}-07-18`, yearly: true }],
    address: 'Фрезеровщиков',
  });
  const girl6 = mkClient('Праздник девочке 6 лет', '', {
    holidays: [{ id: uid(), title: 'День рождения дочки', date: `${y}-07-25`, yearly: true }],
  });
  state.clients = [elena, lubov, anna, jubilee, girl6];

  const mkDeal = (clientId, service, title, date, time, amount, stage, extra = {}) => ({
    id: uid(), clientId, service, title, date, time, amount: amount || 0,
    prepaid: 0, address: '', note: '', stage, createdAt: Date.now(), ...extra,
  });
  state.deals = [
    mkDeal(jubilee.id, 'doll', 'Белый мишка на юбилей', `${y}-07-18`, '18:00', 0, 'confirmed', { address: 'Фрезеровщиков, VIP-беседка' }),
    mkDeal(anna.id, 'foam', '2 бочки пены + челлендж + красители', `${y}-07-19`, '17:00', 27000, 'confirmed'),
    mkDeal(null, 'foam', 'Пена 2 бочки — школа', `${y}-07-24`, '14:00', 0, 'confirmed', { address: 'Пышма' }),
    mkDeal(girl6.id, 'other', 'Праздник девочке 6 лет', `${y}-07-25`, '18:00', 0, 'confirmed'),
    mkDeal(null, 'doll', 'Мишка', `${y}-08-01`, '17:10', 0, 'confirmed', { address: 'Кафе «Маркус»' }),
    mkDeal(null, 'cotton', 'Вата + баннер', `${y}-08-02`, '14:00', 0, 'confirmed', { address: 'Горный Щит' }),
    mkDeal(lubov.id, 'foam', '2 бочки пены + краситель', `${y}-08-02`, '16:30', 16000, 'prepaid', { prepaid: 1500 }),
  ];
  state.seeded = true;
  save();
}

/* ---------------- date helpers ---------------- */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmtDate(s, withYear = true) {
  const d = parseISO(s);
  if (!d) return '';
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${d.getDate()} ${months[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
}
function fmtMoney(n) {
  if (!n) return '—';
  return Number(n).toLocaleString('ru-RU') + ' ₽';
}
/* следующее наступление праздника (с учётом ежегодного повтора) */
function nextOccurrence(holiday) {
  const base = parseISO(holiday.date);
  if (!base) return null;
  const today = parseISO(todayStr());
  if (!holiday.yearly) return base >= today ? base : null;
  const occ = new Date(today.getFullYear(), base.getMonth(), base.getDate());
  if (occ < today) occ.setFullYear(occ.getFullYear() + 1);
  return occ;
}
function daysUntil(date) {
  if (!date) return null;
  const today = parseISO(todayStr());
  return Math.round((date - today) / 86400000);
}
function daysBadge(days) {
  if (days === null) return '';
  let cls = '', text = '';
  if (days === 0) { cls = 'today'; text = 'сегодня!'; }
  else if (days === 1) { cls = 'soon'; text = 'завтра'; }
  else if (days <= 7) { cls = 'soon'; text = `через ${days} дн.`; }
  else text = `через ${days} дн.`;
  return `<span class="li-days ${cls}">${text}</span>`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}
function getClient(id) { return state.clients.find(c => c.id === id) || null; }
function clientDeals(id) { return state.deals.filter(d => d.clientId === id); }
function clientSpent(id) {
  return clientDeals(id).filter(d => d.stage === 'done').reduce((s, d) => s + (Number(d.amount) || 0), 0);
}
/* ближайший праздник клиента */
function clientNextHoliday(c) {
  let best = null;
  for (const h of (c.holidays || [])) {
    const occ = nextOccurrence(h);
    if (!occ) continue;
    if (!best || occ < best.occ) best = { occ, h };
  }
  return best;
}

/* ---------------- toast ---------------- */
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/* ---------------- routing ---------------- */
const VIEW_TITLES = {
  dashboard: 'Главная', clients: 'Клиенты', deals: 'Сделки',
  calendar: 'Календарь', settings: 'Настройки',
};
function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.nav-item, .tab-item[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  document.getElementById('topbar-title').textContent = VIEW_TITLES[name] || '';
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  renderBadges();
  if (currentView === 'dashboard') renderDashboard();
  if (currentView === 'clients') renderClients();
  if (currentView === 'deals') renderKanban();
  if (currentView === 'calendar') renderCalendar();
  if (currentView === 'settings') renderSettings();
}

function renderBadges() {
  document.getElementById('badge-clients').textContent = state.clients.length || '';
  const open = state.deals.filter(d => OPEN_STAGES.includes(d.stage)).length;
  document.getElementById('badge-deals').textContent = open || '';
  // мини-напоминание в сайдбаре
  const upcoming = upcomingHolidays(14);
  const el = document.getElementById('sidebar-reminder');
  el.innerHTML = upcoming.length
    ? `🎂 Праздников в ближайшие 2 недели: <b>${upcoming.length}</b><br>Не забудьте написать клиентам!`
    : 'Ближайшие 2 недели праздников у клиентов нет.';
}

/* список ближайших праздников по всем клиентам */
function upcomingHolidays(days = 60) {
  const res = [];
  for (const c of state.clients) {
    for (const h of (c.holidays || [])) {
      const occ = nextOccurrence(h);
      if (!occ) continue;
      const du = daysUntil(occ);
      if (du !== null && du <= days) res.push({ client: c, holiday: h, occ, days: du });
    }
  }
  res.sort((a, b) => a.occ - b.occ);
  return res;
}

/* ---------------- dashboard ---------------- */
function renderDashboard() {
  const holidays30 = upcomingHolidays(30);
  const openDeals = state.deals.filter(d => OPEN_STAGES.includes(d.stage));
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthRevenue = state.deals
    .filter(d => d.stage === 'done' && (d.date || '').startsWith(monthKey))
    .reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const openSum = openDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  document.getElementById('kpi-grid').innerHTML = `
    <div class="kpi" onclick="showView('clients')">
      <div class="kpi-num">${state.clients.length} <span class="kpi-emoji">👥</span></div>
      <div class="kpi-label">клиентов в базе</div>
    </div>
    <div class="kpi ${holidays30.length ? 'warn' : ''}" onclick="showView('calendar')">
      <div class="kpi-num">${holidays30.length} <span class="kpi-emoji">🎂</span></div>
      <div class="kpi-label">праздников за 30 дней</div>
    </div>
    <div class="kpi" onclick="showView('deals')">
      <div class="kpi-num">${openDeals.length} <span class="kpi-emoji">💼</span></div>
      <div class="kpi-label">сделок в работе · ${fmtMoney(openSum)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-num">${fmtMoney(monthRevenue)}</div>
      <div class="kpi-label">выручка за этот месяц</div>
    </div>`;

  // праздники
  const hWrap = document.getElementById('dash-holidays');
  const holidays60 = upcomingHolidays(60);
  hWrap.innerHTML = holidays60.length ? holidays60.slice(0, 8).map(item => `
    <div class="list-item" onclick="openClientDetail('${item.client.id}')">
      <div class="li-emoji">🎂</div>
      <div class="li-body">
        <div class="li-title">${esc(item.client.name)}</div>
        <div class="li-sub">${esc(item.holiday.title)} · ${fmtDate(item.holiday.date, false)}${item.client.phone ? ' · ' + esc(item.client.phone) : ''}</div>
      </div>
      <div class="li-right">${daysBadge(item.days)}</div>
    </div>`).join('')
    : '<div class="list-empty">Праздников в ближайшие 60 дней нет. Добавьте даты праздников клиентам — и здесь появятся напоминания.</div>';

  // заказы
  const today = todayStr();
  const orders = state.deals
    .filter(d => OPEN_STAGES.includes(d.stage) && d.date && d.date >= today)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
    .slice(0, 8);
  const oWrap = document.getElementById('dash-orders');
  oWrap.innerHTML = orders.length ? orders.map(d => {
    const s = SERVICES[d.service] || SERVICES.other;
    const c = getClient(d.clientId);
    return `
    <div class="list-item" onclick="openDealForm('${d.id}')">
      <div class="li-emoji">${s.emoji}</div>
      <div class="li-body">
        <div class="li-title">${esc(d.title || s.name)}</div>
        <div class="li-sub">${fmtDate(d.date, false)}${d.time ? ', ' + esc(d.time) : ''}${c ? ' · ' + esc(c.name) : ''}${d.address ? ' · ' + esc(d.address) : ''}</div>
      </div>
      <div class="li-right"><div class="li-money">${fmtMoney(d.amount)}</div></div>
    </div>`;
  }).join('') : '<div class="list-empty">Предстоящих заказов нет.</div>';

  renderRevenueChart();
}

function renderRevenueChart() {
  const wrap = document.getElementById('dash-revenue');
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('ru-RU', { month: 'short' }),
      sum: 0,
    });
  }
  for (const d of state.deals) {
    if (d.stage !== 'done' || !d.date) continue;
    const m = months.find(x => d.date.startsWith(x.key));
    if (m) m.sum += Number(d.amount) || 0;
  }
  const max = Math.max(...months.map(m => m.sum), 1);
  wrap.innerHTML = months.map(m => `
    <div class="rev-col">
      <div class="rev-val">${m.sum ? Math.round(m.sum / 1000) + 'к' : ''}</div>
      <div class="rev-bar" style="height:${Math.max(3, m.sum / max * 100)}%"></div>
      <div class="rev-label">${m.label}</div>
    </div>`).join('');
}

/* ---------------- clients ---------------- */
function renderClients() {
  const q = (document.getElementById('clients-search').value || '').toLowerCase().trim();
  const sort = document.getElementById('clients-sort').value;
  let list = state.clients.slice();

  if (q) {
    list = list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.notes || '').toLowerCase().includes(q) ||
      (c.tags || []).some(t => t.toLowerCase().includes(q)));
  }
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  else if (sort === 'recent') list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  else if (sort === 'spent') list.sort((a, b) => clientSpent(b.id) - clientSpent(a.id));
  else { // holiday
    list.sort((a, b) => {
      const na = clientNextHoliday(a), nb = clientNextHoliday(b);
      if (na && nb) return na.occ - nb.occ;
      if (na) return -1;
      if (nb) return 1;
      return a.name.localeCompare(b.name, 'ru');
    });
  }

  const wrap = document.getElementById('clients-list');
  document.getElementById('clients-empty').classList.toggle('hidden', state.clients.length > 0);
  wrap.innerHTML = list.map(c => {
    const nh = clientNextHoliday(c);
    const spent = clientSpent(c.id);
    let holidayHtml = '';
    if (nh) {
      const du = daysUntil(nh.occ);
      const cls = du === 0 ? 'today' : (du <= 7 ? 'soon' : '');
      holidayHtml = `<div class="cc-holiday ${cls}">🎂 ${esc(nh.h.title)} — ${fmtDate(nh.h.date, false)} ${daysBadge(du)}</div>`;
    }
    return `
    <div class="client-card" onclick="openClientDetail('${c.id}')">
      ${spent ? `<div class="cc-total">${fmtMoney(spent)}</div>` : ''}
      <div class="cc-top">
        <div class="cc-avatar">${esc(initials(c.name))}</div>
        <div>
          <div class="cc-name">${esc(c.name)}</div>
          <div class="cc-phone">${esc(c.phone || 'телефон не указан')}</div>
        </div>
      </div>
      ${holidayHtml}
      ${(c.tags || []).length ? `<div class="cc-tags">${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

/* ---------------- kanban ---------------- */
function renderKanban() {
  const svcSel = document.getElementById('deals-filter-service');
  if (!svcSel.dataset.filled) {
    svcSel.innerHTML = '<option value="">Все услуги</option>' +
      Object.entries(SERVICES).map(([k, s]) => `<option value="${k}">${s.emoji} ${s.name}</option>`).join('');
    svcSel.dataset.filled = '1';
  }
  const svcFilter = svcSel.value;
  const showClosed = document.getElementById('deals-show-closed').checked;
  const stages = showClosed ? STAGES : STAGES.filter(s => OPEN_STAGES.includes(s.id));

  const wrap = document.getElementById('kanban');
  const today = todayStr();
  wrap.innerHTML = stages.map(stage => {
    const deals = state.deals
      .filter(d => d.stage === stage.id && (!svcFilter || d.service === svcFilter))
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    const sum = deals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    return `
    <div class="kan-col" data-stage="${stage.id}">
      <div class="kan-head" style="color:${stage.color}">
        <span>${stage.name}</span><span class="kan-count">${deals.length}</span>
      </div>
      <div class="kan-sum">${sum ? fmtMoney(sum) : ''}</div>
      <div class="kan-cards">
        ${deals.map(d => dealCardHtml(d, stage.id, today)).join('')}
      </div>
    </div>`;
  }).join('');

  setupKanbanDnD();
}

function dealCardHtml(d, stageId, today) {
  const s = SERVICES[d.service] || SERVICES.other;
  const c = getClient(d.clientId);
  const isPast = d.date && d.date < today && OPEN_STAGES.includes(stageId);
  const idx = STAGES.findIndex(x => x.id === stageId);
  const prev = idx > 0 && STAGES[idx - 1] ? STAGES[idx - 1] : null;
  const next = STAGES[idx + 1] && STAGES[idx + 1].id !== 'cancelled' ? STAGES[idx + 1] : null;
  return `
  <div class="deal-card" draggable="true" data-id="${d.id}" style="border-left-color:${s.color}" onclick="openDealForm('${d.id}')">
    <div class="dc-title">${s.emoji} ${esc(d.title || s.name)}</div>
    <div class="dc-meta">
      ${c ? `<span>👤 ${esc(c.name)}</span>` : ''}
      ${d.address ? `<span>📍 ${esc(d.address)}</span>` : ''}
    </div>
    <div class="dc-row">
      <span class="dc-money">${fmtMoney(d.amount)}${Number(d.prepaid) ? ` <small style="color:var(--muted);font-weight:400">(аванс ${fmtMoney(d.prepaid)})</small>` : ''}</span>
      ${d.date ? `<span class="dc-date ${isPast ? 'past' : ''}">${fmtDate(d.date, false)}${d.time ? ' ' + esc(d.time) : ''}</span>` : ''}
    </div>
    <div class="dc-move" onclick="event.stopPropagation()">
      ${prev ? `<button class="btn btn-sm" onclick="moveDeal('${d.id}','${prev.id}')">‹ назад</button>` : ''}
      ${next ? `<button class="btn btn-sm btn-primary" onclick="moveDeal('${d.id}','${next.id}')">${next.id === 'done' ? '🏁 готово' : 'дальше ›'}</button>` : ''}
    </div>
  </div>`;
}

function moveDeal(id, stage) {
  const d = state.deals.find(x => x.id === id);
  if (!d) return;
  d.stage = stage;
  save();
  render();
  const st = STAGES.find(s => s.id === stage);
  toast(`Сделка → ${st ? st.name : stage}`, stage === 'done' ? 'success' : '');
}

function setupKanbanDnD() {
  let draggedId = null;
  document.querySelectorAll('.deal-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      draggedId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedId = null;
    });
  });
  document.querySelectorAll('.kan-col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (draggedId) moveDeal(draggedId, col.dataset.stage);
    });
  });
}

/* ---------------- calendar ---------------- */
function calEvents() {
  // map 'YYYY-MM-DD' -> {holidays:[], deals:[]}
  const map = {};
  const push = (key, type, item) => {
    if (!map[key]) map[key] = { holidays: [], deals: [] };
    map[key][type].push(item);
  };
  const y0 = calCursor.getFullYear();
  for (const c of state.clients) {
    for (const h of (c.holidays || [])) {
      const base = parseISO(h.date);
      if (!base) continue;
      if (h.yearly) {
        for (const y of [y0 - 1, y0, y0 + 1]) {
          const key = `${y}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
          push(key, 'holidays', { client: c, holiday: h });
        }
      } else push(h.date, 'holidays', { client: c, holiday: h });
    }
  }
  for (const d of state.deals) {
    if (d.date && d.stage !== 'cancelled') push(d.date, 'deals', d);
  }
  return map;
}

function renderCalendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  document.getElementById('cal-title').textContent =
    calCursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  const events = calEvents();
  const first = new Date(y, m, 1);
  let startDow = (first.getDay() + 6) % 7; // Пн=0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const today = todayStr();

  const dows = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
  for (let i = 0; i < totalCells; i++) {
    let cy = y, cm = m, cd, other = false;
    if (i < startDow) { cd = prevDays - startDow + 1 + i; cm = m - 1; other = true; }
    else if (i - startDow < daysInMonth) cd = i - startDow + 1;
    else { cd = i - startDow - daysInMonth + 1; cm = m + 1; other = true; }
    const dt = new Date(cy, cm, cd);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const ev = events[key];
    const dots = ev ? (
      ev.holidays.slice(0, 3).map(() => '<i class="dot dot-holiday"></i>').join('') +
      ev.deals.slice(0, 3).map(() => '<i class="dot dot-deal"></i>').join('')
    ) : '';
    html += `
    <div class="cal-cell ${other ? 'other' : ''} ${key === today ? 'today' : ''} ${key === calSelected ? 'selected' : ''}" data-date="${key}">
      <span class="cal-daynum">${dt.getDate()}</span>
      <span class="cal-dots">${dots}</span>
    </div>`;
  }
  document.getElementById('cal-grid').innerHTML = html;
  document.querySelectorAll('.cal-cell').forEach(cell =>
    cell.addEventListener('click', () => { calSelected = cell.dataset.date; renderCalendar(); }));

  renderCalDay(events);
}

function renderCalDay(events) {
  const ev = events[calSelected] || { holidays: [], deals: [] };
  document.getElementById('cal-day-title').textContent = 'События · ' + fmtDate(calSelected);
  const items = [];
  for (const h of ev.holidays) {
    items.push(`
    <div class="list-item" onclick="openClientDetail('${h.client.id}')">
      <div class="li-emoji">🎂</div>
      <div class="li-body">
        <div class="li-title">${esc(h.client.name)}</div>
        <div class="li-sub">${esc(h.holiday.title)}${h.client.phone ? ' · ' + esc(h.client.phone) : ''}</div>
      </div>
    </div>`);
  }
  for (const d of ev.deals) {
    const s = SERVICES[d.service] || SERVICES.other;
    const c = getClient(d.clientId);
    const stage = STAGES.find(x => x.id === d.stage);
    items.push(`
    <div class="list-item" onclick="openDealForm('${d.id}')">
      <div class="li-emoji">${s.emoji}</div>
      <div class="li-body">
        <div class="li-title">${esc(d.title || s.name)}</div>
        <div class="li-sub">${d.time ? esc(d.time) + ' · ' : ''}${c ? esc(c.name) + ' · ' : ''}${stage ? stage.name : ''}</div>
      </div>
      <div class="li-right"><div class="li-money">${fmtMoney(d.amount)}</div></div>
    </div>`);
  }
  document.getElementById('cal-day-list').innerHTML =
    items.join('') || '<div class="list-empty">На этот день событий нет. Нажмите «＋ Добавить», чтобы создать заказ.</div>';
}

/* ---------------- settings ---------------- */
function renderSettings() {
  const done = state.deals.filter(d => d.stage === 'done');
  const total = done.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const holidaysCount = state.clients.reduce((s, c) => s + (c.holidays || []).length, 0);
  document.getElementById('settings-stats').innerHTML = `
    <div><span>Клиентов</span><b>${state.clients.length}</b></div>
    <div><span>Дат праздников</span><b>${holidaysCount}</b></div>
    <div><span>Сделок всего</span><b>${state.deals.length}</b></div>
    <div><span>Выполнено сделок</span><b>${done.length}</b></div>
    <div><span>Выручка (выполненные)</span><b>${fmtMoney(total)}</b></div>`;
}

/* ---------------- modals ---------------- */
function openModal(html) {
  closeModal();
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" id="modal-overlay"><div class="modal">${html}</div></div>`;
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  document.body.style.overflow = '';
}

/* --------- client form --------- */
function holidayRowHtml(h = {}) {
  return `
  <div class="holiday-row">
    <input type="text" class="h-title" placeholder="Например: ДР сына Миши" value="${esc(h.title || '')}">
    <input type="date" class="h-date" value="${esc(h.date || '')}">
    <button type="button" class="holiday-del" onclick="this.closest('.holiday-row').remove()">✕</button>
  </div>`;
}

function openClientForm(id = null) {
  const c = id ? getClient(id) : null;
  openModal(`
  <div class="modal-head">
    <h2>${c ? '✏️ Клиент' : '➕ Новый клиент'}</h2>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="form-grid">
    <div class="field"><label>Имя / название *</label>
      <input id="cf-name" type="text" placeholder="Мария (мама Артёма)" value="${esc(c?.name || '')}"></div>
    <div class="form-row">
      <div class="field"><label>Телефон</label>
        <input id="cf-phone" type="tel" placeholder="+7 900 000-00-00" value="${esc(c?.phone || '')}"></div>
      <div class="field"><label>Откуда клиент</label>
        <select id="cf-source">
          <option value="">—</option>
          ${SOURCES.map(s => `<option ${c?.source === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></div>
    </div>
    <div class="field"><label>Адрес</label>
      <input id="cf-address" type="text" placeholder="Екатеринбург, ул. …" value="${esc(c?.address || '')}"></div>
    <div class="field"><label>🎂 Праздники клиента (повторяются каждый год)</label>
      <div class="holiday-rows" id="cf-holidays">
        ${(c?.holidays || []).map(holidayRowHtml).join('')}
      </div>
      <button type="button" class="add-holiday-btn" onclick="addHolidayRow()">＋ добавить дату праздника</button>
    </div>
    <div class="field"><label>Теги (через запятую)</label>
      <input id="cf-tags" type="text" placeholder="постоянный, ДМ+СГ" value="${esc((c?.tags || []).join(', '))}"></div>
    <div class="field"><label>Заметки</label>
      <textarea id="cf-notes" placeholder="Ребёнку 5 лет, любит динозавров…">${esc(c?.notes || '')}</textarea></div>
  </div>
  <div class="modal-actions">
    ${c ? `<button class="btn btn-danger" onclick="deleteClient('${c.id}')">Удалить</button>` : ''}
    <button class="btn" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="saveClientForm('${c ? c.id : ''}')">Сохранить</button>
  </div>`);
  if (!(c?.holidays || []).length) addHolidayRow();
  setTimeout(() => document.getElementById('cf-name').focus(), 50);
}

function addHolidayRow() {
  document.getElementById('cf-holidays').insertAdjacentHTML('beforeend', holidayRowHtml());
}

function saveClientForm(id) {
  const name = document.getElementById('cf-name').value.trim();
  if (!name) { toast('Укажите имя клиента', 'error'); return; }
  const holidays = [];
  document.querySelectorAll('#cf-holidays .holiday-row').forEach(row => {
    const title = row.querySelector('.h-title').value.trim();
    const date = row.querySelector('.h-date').value;
    if (date) holidays.push({ id: uid(), title: title || 'Праздник', date, yearly: true });
  });
  const data = {
    name,
    phone: document.getElementById('cf-phone').value.trim(),
    source: document.getElementById('cf-source').value,
    address: document.getElementById('cf-address').value.trim(),
    tags: document.getElementById('cf-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    notes: document.getElementById('cf-notes').value.trim(),
    holidays,
  };
  if (id) {
    const c = getClient(id);
    Object.assign(c, data);
    toast('Клиент обновлён', 'success');
  } else {
    state.clients.push({ id: uid(), type: 'person', createdAt: Date.now(), ...data });
    toast('Клиент добавлен 🎉', 'success');
  }
  save(); closeModal(); render();
}

function deleteClient(id) {
  const c = getClient(id);
  if (!c) return;
  if (!confirm(`Удалить клиента «${c.name}»? Его сделки останутся без привязки.`)) return;
  state.clients = state.clients.filter(x => x.id !== id);
  state.deals.forEach(d => { if (d.clientId === id) d.clientId = null; });
  save(); closeModal(); render();
  toast('Клиент удалён');
}

/* --------- client detail --------- */
function openClientDetail(id) {
  const c = getClient(id);
  if (!c) return;
  const deals = clientDeals(id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const spent = clientSpent(id);
  const holidaysHtml = (c.holidays || []).map(h => {
    const occ = nextOccurrence(h);
    const du = daysUntil(occ);
    return `<div class="list-item">
      <div class="li-emoji">🎂</div>
      <div class="li-body">
        <div class="li-title">${esc(h.title)}</div>
        <div class="li-sub">${fmtDate(h.date, false)} · каждый год</div>
      </div>
      <div class="li-right">${du !== null ? daysBadge(du) : ''}</div>
    </div>`;
  }).join('') || '<div class="list-empty">Даты праздников не указаны — добавьте через «Редактировать».</div>';

  const dealsHtml = deals.map(d => {
    const s = SERVICES[d.service] || SERVICES.other;
    const stage = STAGES.find(x => x.id === d.stage);
    return `<div class="list-item" onclick="openDealForm('${d.id}')">
      <div class="li-emoji">${s.emoji}</div>
      <div class="li-body">
        <div class="li-title">${esc(d.title || s.name)}</div>
        <div class="li-sub">${d.date ? fmtDate(d.date) : 'без даты'} · ${stage ? stage.name : ''}</div>
      </div>
      <div class="li-right"><div class="li-money">${fmtMoney(d.amount)}</div></div>
    </div>`;
  }).join('') || '<div class="list-empty">Сделок пока нет.</div>';

  openModal(`
  <div class="modal-head">
    <h2>Карточка клиента</h2>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="detail-head">
    <div class="cc-avatar">${esc(initials(c.name))}</div>
    <div>
      <div class="detail-name">${esc(c.name)}</div>
      ${spent ? `<div class="muted">заказов выполнено на <b style="color:var(--success)">${fmtMoney(spent)}</b></div>` : ''}
    </div>
  </div>
  <div class="detail-info">
    ${c.phone ? `<span>📞 <a href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">${esc(c.phone)}</a></span>` : ''}
    ${c.address ? `<span>📍 ${esc(c.address)}</span>` : ''}
    ${c.source ? `<span>🔎 Источник: ${esc(c.source)}</span>` : ''}
    ${(c.tags || []).length ? `<div class="cc-tags">${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    ${c.notes ? `<span class="muted">📝 ${esc(c.notes)}</span>` : ''}
  </div>
  <div class="detail-section"><h3>Праздники</h3><div class="list">${holidaysHtml}</div></div>
  <div class="detail-section"><h3>Сделки</h3><div class="list">${dealsHtml}</div></div>
  <div class="modal-actions">
    <button class="btn" onclick="openClientForm('${c.id}')">✏️ Редактировать</button>
    <button class="btn btn-primary" onclick="openDealForm(null,'${c.id}')">＋ Новая сделка</button>
  </div>`);
}

/* --------- deal form --------- */
function openDealForm(id = null, presetClientId = null) {
  const d = id ? state.deals.find(x => x.id === id) : null;
  const clientOptions = state.clients
    .slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map(c => `<option value="${c.id}" ${(d?.clientId || presetClientId) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');
  openModal(`
  <div class="modal-head">
    <h2>${d ? '✏️ Сделка' : '➕ Новая сделка'}</h2>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="form-grid">
    <div class="field"><label>Что за заказ *</label>
      <input id="df-title" type="text" placeholder="Мишка на день рождения" value="${esc(d?.title || '')}"></div>
    <div class="form-row">
      <div class="field"><label>Услуга</label>
        <select id="df-service">
          ${Object.entries(SERVICES).map(([k, s]) => `<option value="${k}" ${d?.service === k ? 'selected' : ''}>${s.emoji} ${s.name}</option>`).join('')}
        </select></div>
      <div class="field"><label>Этап</label>
        <select id="df-stage">
          ${STAGES.map(s => `<option value="${s.id}" ${(d?.stage || 'new') === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select></div>
    </div>
    <div class="field"><label>Клиент</label>
      <select id="df-client">
        <option value="">— без клиента —</option>
        ${clientOptions}
      </select></div>
    <div class="form-row">
      <div class="field"><label>Дата</label>
        <input id="df-date" type="date" value="${esc(d?.date || calSelected || '')}"></div>
      <div class="field"><label>Время</label>
        <input id="df-time" type="time" value="${esc(d?.time || '')}"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Сумма, ₽</label>
        <input id="df-amount" type="number" inputmode="numeric" placeholder="5000" value="${d?.amount || ''}"></div>
      <div class="field"><label>Предоплата, ₽</label>
        <input id="df-prepaid" type="number" inputmode="numeric" placeholder="1000" value="${d?.prepaid || ''}"></div>
    </div>
    <div class="field"><label>Адрес</label>
      <input id="df-address" type="text" placeholder="ул. Умельцев, 9" value="${esc(d?.address || '')}"></div>
    <div class="field"><label>Заметка</label>
      <textarea id="df-note" placeholder="Ребёнку 6 лет, вход через двор…">${esc(d?.note || '')}</textarea></div>
  </div>
  <div class="modal-actions">
    ${d ? `<button class="btn btn-danger" onclick="deleteDeal('${d.id}')">Удалить</button>` : ''}
    <button class="btn" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" onclick="saveDealForm('${d ? d.id : ''}')">Сохранить</button>
  </div>`);
  setTimeout(() => document.getElementById('df-title').focus(), 50);
}

function saveDealForm(id) {
  const title = document.getElementById('df-title').value.trim();
  if (!title) { toast('Опишите заказ', 'error'); return; }
  const data = {
    title,
    service: document.getElementById('df-service').value,
    stage: document.getElementById('df-stage').value,
    clientId: document.getElementById('df-client').value || null,
    date: document.getElementById('df-date').value,
    time: document.getElementById('df-time').value,
    amount: Number(document.getElementById('df-amount').value) || 0,
    prepaid: Number(document.getElementById('df-prepaid').value) || 0,
    address: document.getElementById('df-address').value.trim(),
    note: document.getElementById('df-note').value.trim(),
  };
  if (id) {
    Object.assign(state.deals.find(x => x.id === id), data);
    toast('Сделка обновлена', 'success');
  } else {
    state.deals.push({ id: uid(), createdAt: Date.now(), ...data });
    toast('Сделка создана 💼', 'success');
  }
  save(); closeModal(); render();
}

function deleteDeal(id) {
  if (!confirm('Удалить сделку?')) return;
  state.deals = state.deals.filter(x => x.id !== id);
  save(); closeModal(); render();
  toast('Сделка удалена');
}

/* --------- quick add --------- */
function openQuickAdd() {
  if (currentView === 'clients') { openClientForm(); return; }
  if (currentView === 'deals') { openDealForm(); return; }
  openModal(`
  <div class="modal-head"><h2>Что добавить?</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="btn-row" style="flex-direction:column">
    <button class="btn btn-primary" style="justify-content:center;padding:14px" onclick="openClientForm()">👤 Клиента</button>
    <button class="btn btn-primary" style="justify-content:center;padding:14px" onclick="openDealForm()">💼 Сделку / заказ</button>
  </div>`);
}

/* ---------------- global search ---------------- */
function renderGlobalSearch() {
  const q = document.getElementById('global-search').value.toLowerCase().trim();
  const wrap = document.getElementById('global-search-results');
  if (q.length < 2) { wrap.innerHTML = ''; return; }
  const items = [];
  for (const c of state.clients) {
    if (c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.notes || '').toLowerCase().includes(q)) {
      items.push(`<div class="card list-item" style="margin:0" onclick="openClientDetail('${c.id}')">
        <div class="li-emoji">👤</div>
        <div class="li-body"><div class="li-title">${esc(c.name)}</div><div class="li-sub">${esc(c.phone || '')}</div></div>
      </div>`);
    }
  }
  for (const d of state.deals) {
    if ((d.title || '').toLowerCase().includes(q) || (d.note || '').toLowerCase().includes(q) || (d.address || '').toLowerCase().includes(q)) {
      const s = SERVICES[d.service] || SERVICES.other;
      items.push(`<div class="card list-item" style="margin:0" onclick="openDealForm('${d.id}')">
        <div class="li-emoji">${s.emoji}</div>
        <div class="li-body"><div class="li-title">${esc(d.title)}</div><div class="li-sub">${d.date ? fmtDate(d.date) : ''} ${fmtMoney(d.amount)}</div></div>
      </div>`);
    }
  }
  wrap.innerHTML = items.slice(0, 10).join('') || '<div class="list-empty">Ничего не найдено.</div>';
}

/* ---------------- export / import ---------------- */
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `makeday-crm-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Копия сохранена ⬇', 'success');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.clients) || !Array.isArray(data.deals)) throw new Error('bad format');
      if (!confirm(`Заменить текущие данные? В файле: ${data.clients.length} клиентов, ${data.deals.length} сделок.`)) return;
      state = data;
      save(); render();
      toast('Данные восстановлены ✅', 'success');
    } catch (e) {
      toast('Не удалось прочитать файл', 'error');
    }
  };
  reader.readAsText(file);
}

/* --------- Excel import --------- */
const IMPORT_FIELDS = {
  name: 'Имя',
  phone: 'Телефон',
  holidayDate: 'Дата праздника',
  holidayTitle: 'Название праздника',
  address: 'Адрес',
  source: 'Источник',
  notes: 'Заметки',
  skip: '— пропустить —',
};
function guessField(header) {
  const h = String(header).toLowerCase();
  if (/имя|фио|клиент|заказчик|назван/.test(h)) return 'name';
  if (/тел|номер|phone|whatsapp|ватсап/.test(h)) return 'phone';
  if (/дата|др\b|день рожд|праздник.*дата|когда/.test(h)) return 'holidayDate';
  if (/событ|повод|праздник/.test(h)) return 'holidayTitle';
  if (/адрес/.test(h)) return 'address';
  if (/источ|откуда/.test(h)) return 'source';
  if (/примеч|заметк|коммент|инфо/.test(h)) return 'notes';
  return 'skip';
}
function parseAnyDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);                       // 2026-07-18
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);                 // 18.07.2026
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2})$/);                // 18.07.26
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})$/);                           // 18.07 → текущий год
  if (m) return `${new Date().getFullYear()}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

function handleExcelFile(file) {
  if (typeof XLSX === 'undefined') {
    toast('Библиотека Excel ещё загружается или нет интернета. Попробуйте через пару секунд.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = XLSX.read(reader.result, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const nonEmpty = rows.filter(r => r.some(c => String(c).trim() !== ''));
      if (nonEmpty.length < 2) { toast('В файле не найдено данных', 'error'); return; }
      const headers = nonEmpty[0].map(h => String(h).trim() || '(без названия)');
      importParsed = {
        headers,
        rows: nonEmpty.slice(1),
        mapping: headers.map(guessField),
        fileName: file.name,
      };
      renderImportPreview();
    } catch (e) {
      console.error(e);
      toast('Не удалось прочитать Excel-файл', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderImportPreview() {
  const p = importParsed;
  const wrap = document.getElementById('import-preview');
  if (!p) { wrap.innerHTML = ''; return; }
  const preview = p.rows.slice(0, 6);
  wrap.innerHTML = `
    <p style="margin:12px 0 4px"><b>${esc(p.fileName)}</b> — строк: ${p.rows.length}. Проверьте, что колонки распознаны верно:</p>
    <div class="import-table-wrap"><table class="import-table">
      <tr>${p.headers.map((h, i) => `<th>
        <div>${esc(h)}</div>
        <select data-col="${i}" onchange="importParsed.mapping[${i}]=this.value">
          ${Object.entries(IMPORT_FIELDS).map(([k, label]) =>
            `<option value="${k}" ${p.mapping[i] === k ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </th>`).join('')}</tr>
      ${preview.map(r => `<tr>${p.headers.map((_, i) =>
        `<td>${esc(r[i] instanceof Date ? r[i].toLocaleDateString('ru-RU') : String(r[i] ?? '').slice(0, 40))}</td>`).join('')}</tr>`).join('')}
    </table></div>
    <div class="btn-row">
      <button class="btn btn-primary" onclick="confirmImport()">✅ Импортировать ${p.rows.length} строк</button>
      <button class="btn" onclick="importParsed=null;renderImportPreview()">Отмена</button>
    </div>`;
}

function confirmImport() {
  const p = importParsed;
  if (!p) return;
  if (!p.mapping.includes('name')) { toast('Отметьте колонку с именем клиента', 'error'); return; }
  let added = 0, updated = 0;
  for (const row of p.rows) {
    const rec = {};
    p.mapping.forEach((field, i) => {
      if (field === 'skip') return;
      const v = row[i];
      if (field === 'holidayDate') rec[field] = parseAnyDate(v);
      else rec[field] = String(v ?? '').trim();
    });
    if (!rec.name) continue;
    // дедупликация по телефону или имени
    const phoneNorm = (rec.phone || '').replace(/\D/g, '');
    let existing = phoneNorm
      ? state.clients.find(c => (c.phone || '').replace(/\D/g, '') === phoneNorm)
      : null;
    if (!existing) existing = state.clients.find(c => c.name.toLowerCase() === rec.name.toLowerCase());
    const holiday = rec.holidayDate
      ? { id: uid(), title: rec.holidayTitle || 'Праздник', date: rec.holidayDate, yearly: true }
      : null;
    if (existing) {
      if (rec.phone && !existing.phone) existing.phone = rec.phone;
      if (rec.address && !existing.address) existing.address = rec.address;
      if (rec.notes) existing.notes = existing.notes ? existing.notes + '\n' + rec.notes : rec.notes;
      if (holiday && !(existing.holidays || []).some(h => h.date === holiday.date)) {
        existing.holidays = existing.holidays || [];
        existing.holidays.push(holiday);
      }
      updated++;
    } else {
      state.clients.push({
        id: uid(), type: 'person', createdAt: Date.now(),
        name: rec.name, phone: rec.phone || '', address: rec.address || '',
        source: rec.source || 'Импорт из Excel', notes: rec.notes || '',
        tags: [], holidays: holiday ? [holiday] : [],
      });
      added++;
    }
  }
  importParsed = null;
  save(); render(); renderImportPreview();
  toast(`Импорт готов: +${added} новых, ${updated} обновлено ✅`, 'success');
}

/* ---------------- init ---------------- */
function init() {
  load();

  // навигация
  document.querySelectorAll('.nav-item, .tab-item[data-view]').forEach(b =>
    b.addEventListener('click', () => showView(b.dataset.view)));
  document.getElementById('btn-settings-mobile').addEventListener('click', () => showView('settings'));

  // быстрое добавление
  document.getElementById('btn-quick-add').addEventListener('click', openQuickAdd);
  document.getElementById('tab-quick-add').addEventListener('click', openQuickAdd);

  // глобальный поиск
  document.getElementById('btn-global-search').addEventListener('click', () => {
    const w = document.getElementById('global-search-wrap');
    w.classList.toggle('hidden');
    if (!w.classList.contains('hidden')) document.getElementById('global-search').focus();
  });
  document.getElementById('global-search').addEventListener('input', renderGlobalSearch);

  // клиенты
  document.getElementById('clients-search').addEventListener('input', renderClients);
  document.getElementById('clients-sort').addEventListener('change', renderClients);

  // сделки
  document.getElementById('deals-filter-service').addEventListener('change', renderKanban);
  document.getElementById('deals-show-closed').addEventListener('change', renderKanban);

  // календарь
  document.getElementById('cal-prev').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
  document.getElementById('cal-next').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
  document.getElementById('cal-today').addEventListener('click', () => { calCursor = new Date(); calSelected = todayStr(); renderCalendar(); });

  // настройки
  document.getElementById('btn-export-json').addEventListener('click', exportJSON);
  document.getElementById('btn-import-json-trigger').addEventListener('click', () => document.getElementById('import-json').click());
  document.getElementById('import-json').addEventListener('change', e => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('import-excel').addEventListener('change', e => {
    if (e.target.files[0]) handleExcelFile(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    if (!confirm('Удалить ВСЕ данные CRM? Это действие нельзя отменить.')) return;
    if (!confirm('Точно удалить? Рекомендуем сначала скачать копию (JSON).')) return;
    localStorage.removeItem(STORE_KEY);
    state = { clients: [], deals: [], seeded: true };
    save(); render();
    toast('Все данные удалены');
  });

  // Esc закрывает модалку
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  showView('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
