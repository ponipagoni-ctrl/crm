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

const MAIL_PRESETS = [
  {
    name: '🎂 Скоро праздник',
    text: 'Здравствуйте, {имя}! Это Влад — приезжал к вам с праздником 🎉 Заметил, что скоро {праздник} ({дата}). Могу снова сделать день незабываемым: ростовые куклы, пенная вечеринка, сладкая вата. Для постоянных клиентов — приятная цена. Забронировать дату?',
  },
  {
    name: '🎅 Новый год',
    text: 'Здравствуйте, {имя}! 🎄 Открыл запись на визиты Деда Мороза и Снегурочки на Новый год. Настоящие костюмы, живая программа — дети в восторге. Лучшие даты (30–31 декабря) разбирают уже сейчас. Успеть забронировать?',
  },
  {
    name: '💦 Лето: пена и вата',
    text: 'Здравствуйте, {имя}! ☀️ Лето — время пенных вечеринок! Бочка пены, музыка, ведущий — праздник для двора, дачи или лагеря. Плюс сладкая вата для детей. Есть свободные даты в этом месяце. Интересно?',
  },
];

/* ---------------- state ---------------- */
let state = { clients: [], deals: [], seeded: false };
let currentView = 'dashboard';
let calCursor = new Date();
let calSelected = todayStr();
let importParsed = null; // {headers, rows, mapping}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function applyLoadedState(loaded) {
  if (loaded && Array.isArray(loaded.clients)) {
    state = loaded;
  } else {
    seed();
  }
  state.campaigns = state.campaigns || [];
  state.activeCampaign = state.activeCampaign || null;
}
function save() {
  if (Cloud.active()) Cloud.persist(state);
  else Auth.persist(state);
}

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
  calendar: 'Календарь', stats: 'Статистика', mailing: 'Рассылка', settings: 'Настройки',
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
  if (currentView === 'stats') renderStats();
  if (currentView === 'mailing') renderMailing();
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

/* услуги, которые клиент заказывал (по его сделкам, кроме отменённых) */
function clientServices(clientId) {
  const set = new Set();
  for (const d of state.deals) {
    if (d.clientId === clientId && d.stage !== 'cancelled') set.add(d.service);
  }
  return set;
}

/* ---------------- clients ---------------- */
function renderClients() {
  const q = (document.getElementById('clients-search').value || '').toLowerCase().trim();
  const sort = document.getElementById('clients-sort').value;
  const svc = document.getElementById('clients-service').value;
  let list = state.clients.slice();

  if (svc) list = list.filter(c => clientServices(c.id).has(svc));
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
    const svcBadges = [...clientServices(c.id)]
      .map(s => (SERVICES[s] || SERVICES.other).emoji).join(' ');
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
          <div class="cc-name">${esc(c.name)} ${svcBadges ? `<span title="что заказывал">${svcBadges}</span>` : ''}</div>
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
  const q = (document.getElementById('deals-search').value || '').toLowerCase().trim();
  const period = document.getElementById('deals-period').value;
  const stages = showClosed ? STAGES : STAGES.filter(s => OPEN_STAGES.includes(s.id));

  const now = new Date();
  const ym = d => d ? d.slice(0, 7) : '';
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}`;
  const m3 = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const from3m = `${m3.getFullYear()}-${String(m3.getMonth() + 1).padStart(2, '0')}-01`;

  const matchesFilters = d => {
    if (svcFilter && d.service !== svcFilter) return false;
    if (period === 'thisMonth' && ym(d.date) !== thisMonth) return false;
    if (period === 'lastMonth' && ym(d.date) !== lastMonth) return false;
    if (period === '3m' && (!d.date || d.date < from3m)) return false;
    if (period === 'thisYear' && !(d.date || '').startsWith(String(now.getFullYear()))) return false;
    if (period === 'ng') {
      const m = (d.date || '').slice(5, 7);
      if (m !== '12' && m !== '01') return false;
    }
    if (q) {
      const c = getClient(d.clientId);
      const hay = [d.title, d.address, d.note, c && c.name, c && c.phone]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  // сводка по отфильтрованному
  const visible = state.deals.filter(d => matchesFilters(d) &&
    (showClosed || OPEN_STAGES.includes(d.stage)));
  const visSum = visible.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const visStaff = visible.reduce((s, d) => s + (Number(d.staffPay) || 0), 0);
  document.getElementById('deals-summary').textContent =
    `Показано сделок: ${visible.length} · на сумму ${fmtMoney(visSum)}` +
    (visStaff ? ` · сотрудникам ${fmtMoney(visStaff)} · чистыми ${fmtMoney(visSum - visStaff)}` : '');

  const wrap = document.getElementById('kanban');
  const today = todayStr();
  wrap.innerHTML = stages.map(stage => {
    const deals = state.deals
      .filter(d => d.stage === stage.id && matchesFilters(d))
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
      ${d.staffName ? `<span>🧑‍💼 ${esc(d.staffName)}${Number(d.staffPay) ? ` — ${fmtMoney(d.staffPay)}` : ''}</span>` : ''}
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
  setTimeout(() => { const el = document.getElementById('cf-name'); if (el) el.focus(); }, 50);
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

/* имена сотрудников, встречавшиеся в сделках (для подсказок) */
function staffNames() {
  const set = new Set();
  for (const d of state.deals) {
    if (d.staffName) String(d.staffName).split(',').forEach(s => { s = s.trim(); if (s) set.add(s); });
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
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
    <div class="form-row">
      <div class="field"><label>Кто работал (сотрудник)</label>
        <input id="df-staff" type="text" list="staff-list" placeholder="Ксюша" value="${esc(d?.staffName || '')}">
        <datalist id="staff-list">${staffNames().map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <div class="field"><label>Выплата сотруднику, ₽</label>
        <input id="df-staffpay" type="number" inputmode="numeric" placeholder="2000" value="${d?.staffPay || ''}"></div>
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
  setTimeout(() => { const el = document.getElementById('df-title'); if (el) el.focus(); }, 50);
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
    staffName: document.getElementById('df-staff').value.trim(),
    staffPay: Number(document.getElementById('df-staffpay').value) || 0,
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
      openModal(`
      <div class="modal-head"><h2>Импорт данных</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <p>В файле: <b>${data.clients.length}</b> клиентов, <b>${data.deals.length}</b> сделок.<br>
      Сейчас в CRM: ${state.clients.length} клиентов, ${state.deals.length} сделок.</p>
      <div class="btn-row" style="flex-direction:column;margin-top:14px">
        <button class="btn btn-primary" style="justify-content:center;padding:13px" id="imp-merge">➕ Объединить — добавить новых, без дублей (рекомендуется)</button>
        <button class="btn" style="justify-content:center;padding:13px" id="imp-replace">♻️ Заменить всё содержимое CRM данными из файла</button>
      </div>`);
      document.getElementById('imp-merge').addEventListener('click', () => {
        const res = mergeData(data);
        closeModal(); render();
        toast(`Объединено: +${res.addedClients} клиентов, +${res.addedDeals} сделок ✅`, 'success');
      });
      document.getElementById('imp-replace').addEventListener('click', () => {
        if (!confirm('Точно заменить ВСЁ? Текущие данные будут удалены.')) return;
        state = data;
        state.campaigns = state.campaigns || [];
        state.activeCampaign = state.activeCampaign || null;
        save(); closeModal(); render();
        toast('Данные восстановлены ✅', 'success');
      });
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

/* ================= СТАТИСТИКА ================= */
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function fillStatsFilters() {
  const yearSel = document.getElementById('stats-year');
  if (yearSel.dataset.filled) return;
  yearSel.dataset.filled = '1';
  const years = [...new Set(state.deals.map(d => (d.date || '').slice(0, 4)).filter(y => y.length === 4))]
    .sort().reverse();
  yearSel.innerHTML = '<option value="">Все годы</option>' +
    years.map(y => `<option value="${y}">${y}</option>`).join('');
  document.getElementById('stats-month').innerHTML = '<option value="">Все месяцы</option>' +
    MONTHS_RU.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}">${m}</option>`).join('');
  document.getElementById('stats-service').innerHTML = '<option value="">Все услуги</option>' +
    Object.entries(SERVICES).map(([k, s]) => `<option value="${k}">${s.emoji} ${s.name}</option>`).join('');
}

function renderStats() {
  fillStatsFilters();
  const year = document.getElementById('stats-year').value;
  const month = document.getElementById('stats-month').value;
  const svc = document.getElementById('stats-service').value;

  const rows = state.deals.filter(d =>
    d.stage === 'done' && d.date &&
    (!year || d.date.startsWith(year)) &&
    (!month || d.date.slice(5, 7) === month) &&
    (!svc || d.service === svc));

  const gross = rows.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const staff = rows.reduce((s, d) => s + (Number(d.staffPay) || 0), 0);
  document.getElementById('stats-tiles').innerHTML = `
    <div class="kpi"><div class="kpi-num">${fmtMoney(gross)}</div><div class="kpi-label">выручка (выполнено)</div></div>
    <div class="kpi warn"><div class="kpi-num">${staff ? '−' + fmtMoney(staff) : '0 ₽'}</div><div class="kpi-label">выплачено сотрудникам</div></div>
    <div class="kpi"><div class="kpi-num" style="color:var(--success)">${fmtMoney(gross - staff)}</div><div class="kpi-label">чистыми вам</div></div>
    <div class="kpi"><div class="kpi-num">${rows.length}</div><div class="kpi-label">сделок выполнено</div></div>`;

  // по месяцам
  const byMonth = {};
  for (const d of rows) {
    const key = d.date.slice(0, 7);
    byMonth[key] = byMonth[key] || { gross: 0, staff: 0, count: 0 };
    byMonth[key].gross += Number(d.amount) || 0;
    byMonth[key].staff += Number(d.staffPay) || 0;
    byMonth[key].count++;
  }
  const monthKeys = Object.keys(byMonth).sort().reverse();
  document.getElementById('stats-months').innerHTML =
    '<tr><th>Месяц</th><th>Сделок</th><th>Выручка</th><th>Сотрудникам</th><th>Чистыми</th></tr>' +
    (monthKeys.map(k => {
      const m = byMonth[k];
      const label = MONTHS_RU[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4);
      return `<tr><td><b>${label}</b></td><td>${m.count}</td><td>${fmtMoney(m.gross)}</td>
        <td>${m.staff ? '−' + fmtMoney(m.staff) : '—'}</td><td><b>${fmtMoney(m.gross - m.staff)}</b></td></tr>`;
    }).join('') || '<tr><td colspan="5">Нет выполненных сделок за выбранный период.</td></tr>');

  // по услугам
  const bySvc = {};
  for (const d of rows) {
    bySvc[d.service] = bySvc[d.service] || { gross: 0, staff: 0, count: 0 };
    bySvc[d.service].gross += Number(d.amount) || 0;
    bySvc[d.service].staff += Number(d.staffPay) || 0;
    bySvc[d.service].count++;
  }
  document.getElementById('stats-services').innerHTML =
    '<tr><th>Услуга</th><th>Сделок</th><th>Выручка</th><th>Сотрудникам</th><th>Чистыми</th></tr>' +
    (Object.entries(bySvc).sort((a, b) => b[1].gross - a[1].gross).map(([k, m]) => {
      const s = SERVICES[k] || SERVICES.other;
      return `<tr><td><b>${s.emoji} ${s.name}</b></td><td>${m.count}</td><td>${fmtMoney(m.gross)}</td>
        <td>${m.staff ? '−' + fmtMoney(m.staff) : '—'}</td><td><b>${fmtMoney(m.gross - m.staff)}</b></td></tr>`;
    }).join('') || '<tr><td colspan="5">Нет данных.</td></tr>');

  // по сотрудникам
  const byStaff = {};
  for (const d of rows) {
    if (!d.staffName) continue;
    const key = String(d.staffName).trim();
    if (!key) continue;
    byStaff[key] = byStaff[key] || { pay: 0, count: 0 };
    byStaff[key].pay += Number(d.staffPay) || 0;
    byStaff[key].count++;
  }
  document.getElementById('stats-staff').innerHTML =
    '<tr><th>Сотрудник</th><th>Заказов</th><th>Выплачено</th></tr>' +
    (Object.entries(byStaff).sort((a, b) => b[1].pay - a[1].pay).map(([nm, m]) =>
      `<tr><td><b>${esc(nm)}</b></td><td>${m.count}</td><td>${fmtMoney(m.pay)}</td></tr>`).join('')
      || '<tr><td colspan="3">Пока ни в одной сделке не указан сотрудник. Откройте сделку и заполните поля «Кто работал» и «Выплата сотруднику».</td></tr>');
}

/* ================= РАССЫЛКА ================= */
function normPhoneDigits(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10 && d[0] === '9') d = '7' + d;
  return d;
}
function firstName(name) {
  const w = String(name || '').trim().split(/[\s(,]+/)[0];
  return w || 'друг';
}
function ensureCampaign() {
  if (!state.activeCampaign) {
    state.activeCampaign = {
      id: uid(), startedAt: Date.now(),
      text: MAIL_PRESETS[0].text,
      recipientIds: [], sentIds: [],
    };
  }
  return state.activeCampaign;
}
function personalize(template, client) {
  const nh = clientNextHoliday(client);
  return template
    .replace(/\{имя\}/gi, firstName(client.name))
    .replace(/\{праздник\}/gi, nh ? nh.h.title.toLowerCase() : 'праздник')
    .replace(/\{дата\}/gi, nh ? fmtDate(`${nh.occ.getFullYear()}-${String(nh.occ.getMonth() + 1).padStart(2, '0')}-${String(nh.occ.getDate()).padStart(2, '0')}`, false) : '');
}
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent); }

function renderMailing() {
  const camp = ensureCampaign();
  const withPhone = state.clients.filter(c => normPhoneDigits(c.phone).length === 11);

  // 1. получатели
  const rw = document.getElementById('mail-recipients');
  rw.innerHTML = withPhone.length ? withPhone.map(c => {
    const nh = clientNextHoliday(c);
    const du = nh ? daysUntil(nh.occ) : null;
    const checked = camp.recipientIds.includes(c.id);
    return `
    <label class="list-item" style="cursor:pointer">
      <input type="checkbox" class="mail-check" data-id="${c.id}" ${checked ? 'checked' : ''}>
      <div class="li-body">
        <div class="li-title">${esc(c.name)}</div>
        <div class="li-sub">${esc(c.phone)}${nh ? ' · 🎂 ' + esc(nh.h.title) : ''}</div>
      </div>
      <div class="li-right">${du !== null ? daysBadge(du) : ''}</div>
    </label>`;
  }).join('') : '<div class="list-empty">Нет клиентов с телефонами. Добавьте телефоны клиентам или импортируйте базу.</div>';
  document.getElementById('mail-count-hint').textContent =
    `выбрано ${camp.recipientIds.length} из ${withPhone.length}`;

  rw.querySelectorAll('.mail-check').forEach(cb => cb.addEventListener('change', () => {
    const id = cb.dataset.id;
    if (cb.checked) { if (!camp.recipientIds.includes(id)) camp.recipientIds.push(id); }
    else camp.recipientIds = camp.recipientIds.filter(x => x !== id);
    save(); renderMailing();
  }));

  // 2. шаблоны
  const pw = document.getElementById('mail-presets');
  pw.innerHTML = MAIL_PRESETS.map((p, i) =>
    `<button class="btn btn-sm" data-preset="${i}">${p.name}</button>`).join('');
  pw.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    camp.text = MAIL_PRESETS[Number(b.dataset.preset)].text;
    document.getElementById('mail-text').value = camp.text;
    save(); renderMailSendList();
  }));
  const ta = document.getElementById('mail-text');
  if (ta.value !== camp.text) ta.value = camp.text;
  ta.oninput = () => { camp.text = ta.value; save(); renderMailSendList(); };

  renderMailSendList();
  renderMailHistory();
}

function renderMailSendList() {
  const camp = ensureCampaign();
  const wrap = document.getElementById('mail-send-list');
  const recipients = camp.recipientIds.map(getClient).filter(Boolean);
  if (!recipients.length) {
    wrap.innerHTML = '<div class="list-empty">Отметьте получателей в списке выше.</div>';
    return;
  }
  wrap.innerHTML = recipients.map(c => {
    const msg = personalize(camp.text, c);
    const digits = normPhoneDigits(c.phone);
    const wa = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    const sms = `sms:+${digits}${isIOS() ? '&' : '?'}body=${encodeURIComponent(msg)}`;
    const sent = camp.sentIds.includes(c.id);
    return `
    <div class="list-item" style="cursor:default;${sent ? 'opacity:.55' : ''}">
      <div class="li-emoji">${sent ? '✅' : '✉️'}</div>
      <div class="li-body">
        <div class="li-title">${esc(c.name)}</div>
        <div class="li-sub" title="${esc(msg)}">${esc(msg.slice(0, 70))}…</div>
      </div>
      <div class="li-right btn-row" style="flex-wrap:nowrap">
        <a class="btn btn-sm btn-primary" href="${wa}" target="_blank" rel="noopener" onclick="markSent('${c.id}')">WhatsApp</a>
        <a class="btn btn-sm" href="${sms}" onclick="markSent('${c.id}')">SMS</a>
      </div>
    </div>`;
  }).join('');
  const sentCount = camp.sentIds.filter(id => camp.recipientIds.includes(id)).length;
  document.getElementById('mail-finish').textContent =
    `🏁 Завершить рассылку (отправлено ${sentCount} из ${camp.recipientIds.length})`;
}

function markSent(clientId) {
  const camp = ensureCampaign();
  if (!camp.sentIds.includes(clientId)) camp.sentIds.push(clientId);
  const c = getClient(clientId);
  if (c) c.lastMailedAt = todayStr();
  save();
  setTimeout(renderMailSendList, 300);
}

function finishCampaign() {
  const camp = state.activeCampaign;
  if (!camp || !camp.sentIds.length) { toast('Ещё никому не отправлено', 'error'); return; }
  state.campaigns.unshift({
    id: camp.id, date: todayStr(), text: camp.text,
    total: camp.recipientIds.length, sent: camp.sentIds.length,
  });
  state.activeCampaign = null;
  save(); renderMailing();
  toast('Рассылка сохранена в историю ✅', 'success');
}

function renderMailHistory() {
  const wrap = document.getElementById('mail-history');
  wrap.innerHTML = (state.campaigns || []).length ? state.campaigns.map(c => `
    <div class="list-item" style="cursor:default">
      <div class="li-emoji">📮</div>
      <div class="li-body">
        <div class="li-title">${fmtDate(c.date)} — отправлено ${c.sent} из ${c.total}</div>
        <div class="li-sub">${esc(c.text.slice(0, 80))}…</div>
      </div>
    </div>`).join('') : '<div class="list-empty">Рассылок пока не было.</div>';
}

/* ================= ОБЪЕДИНЕНИЕ ДАННЫХ (merge) ================= */
function mergeData(incoming) {
  const res = { addedClients: 0, updatedClients: 0, addedDeals: 0, updatedDeals: 0 };
  const idMap = {}; // id клиента из файла → id в базе

  for (const inc of (incoming.clients || [])) {
    const incPhone = normPhoneDigits(inc.phone);
    let existing = incPhone.length === 11
      ? state.clients.find(c => normPhoneDigits(c.phone) === incPhone)
      : null;
    if (!existing) {
      existing = state.clients.find(c =>
        c.name.trim().toLowerCase() === String(inc.name || '').trim().toLowerCase());
    }
    if (existing) {
      if (inc.phone && !existing.phone) existing.phone = inc.phone;
      if (inc.address && !existing.address) existing.address = inc.address;
      if (inc.source && !existing.source) existing.source = inc.source;
      if (inc.notes && !(existing.notes || '').includes(inc.notes)) {
        existing.notes = existing.notes ? existing.notes + '\n' + inc.notes : inc.notes;
      }
      for (const t of (inc.tags || [])) {
        existing.tags = existing.tags || [];
        if (!existing.tags.includes(t)) existing.tags.push(t);
      }
      for (const h of (inc.holidays || [])) {
        existing.holidays = existing.holidays || [];
        const hd = (h.date || '').slice(5); // месяц-день
        if (!existing.holidays.some(x => (x.date || '').slice(5) === hd)) {
          existing.holidays.push({ ...h, id: uid() });
        }
      }
      idMap[inc.id] = existing.id;
      res.updatedClients++;
    } else {
      const copy = { ...inc, id: uid(), createdAt: inc.createdAt || Date.now() };
      copy.holidays = (inc.holidays || []).map(h => ({ ...h, id: uid() }));
      state.clients.push(copy);
      idMap[inc.id] = copy.id;
      res.addedClients++;
    }
  }

  for (const inc of (incoming.deals || [])) {
    let existing = inc.icsUid ? state.deals.find(d => d.icsUid === inc.icsUid) : null;
    if (!existing && inc.date) {
      existing = state.deals.find(d => d.date === inc.date && d.service === inc.service && !d.icsUid);
    }
    if (existing) {
      if (inc.icsUid) existing.icsUid = inc.icsUid;
      if (inc.amount && !existing.amount) existing.amount = inc.amount;
      if (inc.prepaid && !existing.prepaid) existing.prepaid = inc.prepaid;
      if (inc.address && !existing.address) existing.address = inc.address;
      if (inc.time && !existing.time) existing.time = inc.time;
      if (!existing.clientId && inc.clientId && idMap[inc.clientId]) existing.clientId = idMap[inc.clientId];
      res.updatedDeals++;
    } else {
      state.deals.push({
        ...inc, id: uid(),
        clientId: inc.clientId ? (idMap[inc.clientId] || null) : null,
        createdAt: inc.createdAt || Date.now(),
      });
      res.addedDeals++;
    }
  }
  save();
  return res;
}

/* ================= ИМПОРТ .ICS (Google Календарь) ================= */
function unfoldICS(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}
function icsProp(block, name) {
  const re = new RegExp('^' + name + '[^:\\n]*:(.*)$', 'mi');
  const m = block.match(re);
  return m ? m[1].replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').trim() : '';
}
function icsDate(block) {
  const m = block.match(/^DTSTART[^:\n]*:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/mi);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : '' };
}

let icsParsed = null;

function handleIcsFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = unfoldICS(String(reader.result));
      const blocks = text.split('BEGIN:VEVENT').slice(1).map(b => b.split('END:VEVENT')[0]);
      const seenUids = new Set(state.deals.map(d => d.icsUid).filter(Boolean));
      const rows = [];
      for (const b of blocks) {
        const summary = icsProp(b, 'SUMMARY');
        if (!summary) continue;
        const dt = icsDate(b);
        if (!dt) continue;
        const uidStr = icsProp(b, 'UID') || (dt.date + summary.slice(0, 20));
        if (seenUids.has(uidStr)) continue; // уже импортирован
        const parsed = OrderParser.parseOrderSummary(summary);
        if (!parsed.hasServiceKeyword && !parsed.phone && !parsed.price) continue; // не заказ
        rows.push({
          uid: uidStr, summary, location: icsProp(b, 'LOCATION'),
          date: dt.date, time: dt.time, parsed,
          checked: parsed.hasServiceKeyword || (!!parsed.phone && parsed.price > 0),
        });
      }
      rows.sort((a, b) => a.date.localeCompare(b.date));
      if (!rows.length) { toast('Новых заказов в файле не найдено', 'error'); return; }
      icsParsed = { rows, fileName: file.name };
      renderIcsPreview();
    } catch (e) {
      console.error(e);
      toast('Не удалось прочитать файл календаря', 'error');
    }
  };
  reader.readAsText(file);
}

function renderIcsPreview() {
  const wrap = document.getElementById('ics-preview');
  if (!icsParsed) { wrap.innerHTML = ''; return; }
  const rows = icsParsed.rows;
  wrap.innerHTML = `
    <p style="margin:12px 0 4px"><b>${esc(icsParsed.fileName)}</b> — найдено похожих на заказы: ${rows.length}. Снимите галочки с лишних:</p>
    <div class="import-table-wrap"><table class="import-table">
      <tr><th></th><th>Дата</th><th>Заказ</th><th>Услуга</th><th>Цена</th><th>Клиент</th><th>Телефон</th></tr>
      ${rows.map((r, i) => {
        const s = SERVICES[r.parsed.service] || SERVICES.other;
        return `<tr>
          <td><input type="checkbox" data-ics-row="${i}" ${r.checked ? 'checked' : ''}></td>
          <td>${fmtDate(r.date)}</td>
          <td title="${esc(r.summary)}">${esc(r.parsed.title.slice(0, 38))}</td>
          <td>${s.emoji} ${s.name}</td>
          <td>${r.parsed.price ? fmtMoney(r.parsed.price) : '—'}</td>
          <td>${esc(r.parsed.name || '—')}</td>
          <td>${esc(r.parsed.phone || '—')}</td>
        </tr>`;
      }).join('')}
    </table></div>
    <div class="btn-row">
      <button class="btn btn-primary" onclick="confirmIcsImport()">✅ Импортировать отмеченные</button>
      <button class="btn" onclick="icsParsed=null;renderIcsPreview()">Отмена</button>
    </div>`;
  wrap.querySelectorAll('[data-ics-row]').forEach(cb => cb.addEventListener('change', () => {
    icsParsed.rows[Number(cb.dataset.icsRow)].checked = cb.checked;
  }));
}

function buildFromCalendarRow(r, clientsAcc, clientKeyMap) {
  const p = r.parsed;
  const today = todayStr();
  let clientId = null;
  if (p.phone || p.name) {
    const key = p.phone ? normPhoneDigits(p.phone) : 'name:' + p.name.toLowerCase();
    if (clientKeyMap[key]) clientId = clientKeyMap[key];
    else {
      const holidays = [];
      if (p.occasion) {
        holidays.push({ id: uid(), title: p.occasion.title, date: r.date, yearly: true });
      } else if (p.service === 'dm') {
        holidays.push({ id: uid(), title: 'Новый год (заказ ДМ+СГ)', date: r.date, yearly: true });
      }
      const client = {
        id: uid(), type: 'person',
        name: p.name || ('Клиент ' + p.phone),
        phone: p.phone, address: r.location || '',
        source: 'Google Календарь', notes: p.occasion ? `Возраст на празднике: ${p.occasion.age}` : '',
        tags: [], holidays, createdAt: Date.now(),
      };
      clientsAcc.push(client);
      clientKeyMap[key] = client.id;
      clientId = client.id;
    }
  }
  return {
    id: uid(), icsUid: r.uid, clientId,
    service: p.service, title: p.title,
    date: r.date, time: r.time,
    amount: p.price, prepaid: p.prepaid,
    address: r.location || '', note: r.summary === p.title ? '' : r.summary,
    stage: r.date < today ? 'done' : 'confirmed',
    createdAt: Date.now(),
  };
}

function confirmIcsImport() {
  if (!icsParsed) return;
  const selected = icsParsed.rows.filter(r => r.checked);
  if (!selected.length) { toast('Ничего не отмечено', 'error'); return; }
  const clients = [], deals = [], keyMap = {};
  for (const r of selected) deals.push(buildFromCalendarRow(r, clients, keyMap));
  const res = mergeData({ clients, deals });
  icsParsed = null;
  render(); renderIcsPreview();
  toast(`Календарь загружен: +${res.addedDeals} заказов, +${res.addedClients} клиентов ✅`, 'success');
}

/* ---------------- init ---------------- */
let uiStarted = false;

function startApp(loaded) {
  applyLoadedState(loaded);
  bindEvents();
  uiStarted = true;
  showView('dashboard');
}

function init() {
  if (Cloud.isConfigured()) {
    Cloud.begin({
      onReady: startApp,
      // изменения, пришедшие с других устройств команды
      applyRemote: remote => {
        state.clients = remote.clients;
        state.deals = remote.deals;
        state.campaigns = remote.campaigns;
        if (uiStarted) render();
      },
    });
  } else {
    Auth.begin(startApp);
  }
}

function bindEvents() {
  // навигация
  document.querySelectorAll('.nav-item, .tab-item[data-view]').forEach(b =>
    b.addEventListener('click', () => showView(b.dataset.view)));
  document.getElementById('btn-settings-mobile').addEventListener('click', () => showView('settings'));
  document.getElementById('btn-mailing-mobile').addEventListener('click', () => showView('mailing'));
  document.getElementById('btn-stats-mobile').addEventListener('click', () => showView('stats'));

  // статистика
  ['stats-year', 'stats-month', 'stats-service'].forEach(id =>
    document.getElementById(id).addEventListener('change', renderStats));

  // рассылка
  document.querySelectorAll('[data-mailfilter]').forEach(b => b.addEventListener('click', () => {
    const camp = ensureCampaign();
    const mode = b.dataset.mailfilter;
    const withPhone = state.clients.filter(c => normPhoneDigits(c.phone).length === 11);
    if (mode === 'all') camp.recipientIds = withPhone.map(c => c.id);
    else if (mode === 'none') camp.recipientIds = [];
    else {
      const days = mode === 'holiday30' ? 30 : 60;
      camp.recipientIds = withPhone.filter(c => {
        const nh = clientNextHoliday(c);
        return nh && daysUntil(nh.occ) <= days;
      }).map(c => c.id);
    }
    save(); renderMailing();
  }));
  document.getElementById('mail-finish').addEventListener('click', finishCampaign);
  // рассылка по услуге («заказывали пену» и т.п.)
  document.querySelectorAll('[data-mailservice]').forEach(b => b.addEventListener('click', () => {
    const camp = ensureCampaign();
    const svc = b.dataset.mailservice;
    camp.recipientIds = state.clients
      .filter(c => normPhoneDigits(c.phone).length === 11 && clientServices(c.id).has(svc))
      .map(c => c.id);
    save(); renderMailing();
    const s = SERVICES[svc];
    toast(`Выбраны клиенты: ${s.emoji} ${s.name} — ${camp.recipientIds.length} чел.`);
  }));

  // импорт календаря
  document.getElementById('import-ics').addEventListener('change', e => {
    if (e.target.files[0]) handleIcsFile(e.target.files[0]);
    e.target.value = '';
  });

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
  const svcSelect = document.getElementById('clients-service');
  svcSelect.innerHTML = '<option value="">Заказывали: любую услугу</option>' +
    Object.entries(SERVICES).map(([k, s]) => `<option value="${k}">Заказывали: ${s.emoji} ${s.name}</option>`).join('');
  svcSelect.addEventListener('change', renderClients);

  // сделки
  document.getElementById('deals-filter-service').addEventListener('change', renderKanban);
  document.getElementById('deals-show-closed').addEventListener('change', renderKanban);
  document.getElementById('deals-search').addEventListener('input', renderKanban);
  document.getElementById('deals-period').addEventListener('change', renderKanban);

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
    state = { clients: [], deals: [], seeded: true, campaigns: [], activeCampaign: null };
    save(); render();
    toast('Все данные удалены');
  });

  // доступ
  document.getElementById('btn-lock').addEventListener('click', () =>
    Cloud.active() ? Cloud.logout() : Auth.logout());
  document.getElementById('btn-change-pass').addEventListener('click', () => {
    if (Cloud.active()) {
      Cloud.resetPassword()
        .then(() => toast('📧 Письмо для смены пароля отправлено на ' + Cloud.userEmail(), 'success'))
        .catch(() => toast('Не удалось отправить письмо', 'error'));
    } else openChangePassword();
  });

  // Esc закрывает модалку
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

function openChangePassword() {
  openModal(`
  <div class="modal-head"><h2>🔐 Смена пароля</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="form-grid">
    <div class="field"><label>Текущий пароль</label><input id="cp-old" type="password" autocomplete="current-password"></div>
    <div class="field"><label>Новый пароль</label><input id="cp-new" type="password" minlength="4" autocomplete="new-password"></div>
    <div class="field"><label>Новый пароль ещё раз</label><input id="cp-new2" type="password" minlength="4" autocomplete="new-password"></div>
  </div>
  <div class="modal-actions">
    <button class="btn" onclick="closeModal()">Отмена</button>
    <button class="btn btn-primary" id="cp-save">Сменить</button>
  </div>`);
  document.getElementById('cp-save').addEventListener('click', async () => {
    const oldP = document.getElementById('cp-old').value;
    const n1 = document.getElementById('cp-new').value;
    const n2 = document.getElementById('cp-new2').value;
    if (n1.length < 4) { toast('Пароль слишком короткий', 'error'); return; }
    if (n1 !== n2) { toast('Новые пароли не совпадают', 'error'); return; }
    try {
      await Auth.changePassword(oldP, n1);
      closeModal();
      toast('Пароль изменён ✅', 'success');
    } catch (e) {
      toast('Текущий пароль неверный', 'error');
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
