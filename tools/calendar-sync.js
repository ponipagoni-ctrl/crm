#!/usr/bin/env node
/*
 * Календарь Google → MakeDay CRM (Firestore REST) + зеркало ближайших заказов
 * в приложение «Аниматор Про» (коллекция assignments).
 *
 * Запуск:
 *   ROBOT_EMAIL=… ROBOT_PASSWORD=… node tools/calendar-sync.js events.json [--dry]
 *
 * events.json — массив событий календаря: [{id, summary, location, start}],
 * где start — ISO-время с часовым поясом (как отдаёт Google Calendar).
 * Пароль робота в репозиторий не кладём: он передаётся через окружение.
 *
 * Логика разбора — js/parse-order.js (та же, что в CRM): услуга, телефон,
 * цена, предоплата, имя, повод («девочке 9» → «День рождения дочки»).
 * Новое событие = его id нет среди icsUid сделок. Клиент ищется по телефону.
 * --dry — только показать, что было бы добавлено.
 */
'use strict';
const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const { parseOrderSummary, looksLikeOrder } = require(path.join(__dirname, '..', 'js', 'parse-order.js'));

const API_KEY = 'AIzaSyDPjkBJNawCeR_M1iDN8OD3v_fo3cRWu84'; // публичный ключ веб-приложения
const PROJECT = 'makeday-crm';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const CA = process.env.NODE_EXTRA_CA_CERTS || '/root/.ccr/ca-bundle.crt';
const caOpt = fs.existsSync(CA) ? { ca: fs.readFileSync(CA) } : {};

// личные события — не заказы
const SKIP = /заряд|массаж|мфц|врач|стоматолог|зубн|маник|педикюр|тренир|спортзал|стрижк|парикмах|баня|сауна|совещан|планёрк|планерк|созвон|вакансии|магнит|стратегическ|день рожден(?!ия (?:доч|сын|реб))/i;

function req(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) headers['Content-Length'] = data.length;
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers, ...caOpt }, res => {
      let out = '';
      res.on('data', c => (out += c));
      res.on('end', () => {
        let j; try { j = JSON.parse(out); } catch { j = out; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(j);
        else reject(new Error(res.statusCode + ' ' + String(out).slice(0, 300)));
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ── Firestore значения ──
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
  return { stringValue: String(v) };
}
function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return null;
}
async function listAll(col, token) {
  const out = [];
  let pageToken = '';
  do {
    const j = await req('GET', `${BASE}/${col}?pageSize=300${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`, null, token);
    for (const d of j.documents || []) out.push({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)])) });
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}
const uid = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex').slice(0, 6);
const normPhone = p => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); if (d.length === 10) d = '7' + d; return d; };

// дата/время события в часовом поясе события (Екатеринбург)
function localParts(start) {
  const m = String(start).match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  return { date: m ? m[1] : '', time: m && m[2] ? m[2] : '' };
}

async function main() {
  const file = process.argv[2];
  const dry = process.argv.includes('--dry');
  const email = process.env.ROBOT_EMAIL, password = process.env.ROBOT_PASSWORD;
  if (!file || !email || !password) {
    console.error('Нужно: ROBOT_EMAIL, ROBOT_PASSWORD и путь к events.json'); process.exit(2);
  }
  const events = JSON.parse(fs.readFileSync(file, 'utf8'));
  const auth = await req('POST', `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, { email, password, returnSecureToken: true });
  const token = auth.idToken;

  let deals, clients;
  try {
    [deals, clients] = await Promise.all([listAll('deals', token), listAll('clients', token)]);
  } catch (e) {
    if (/PERMISSION_DENIED|403/.test(e.message)) { console.log('PERMISSION_DENIED: робот не одобрен в CRM (Настройки → Команда)'); return; }
    throw e;
  }
  const known = new Set(deals.map(d => d.icsUid).filter(Boolean));
  const byPhone = new Map(clients.filter(c => c.phone).map(c => [normPhone(c.phone), c]));
  console.log(`база: сделок с uid ${known.size} | клиентов с тел. ${byPhone.size}`);

  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  const fresh = events.filter(e => e.id && e.summary && !known.has(e.id) && !SKIP.test(e.summary) && looksLikeOrder(e.summary));
  console.log('новых кандидатов:', fresh.length);
  let addedDeals = 0, addedClients = 0, sum = 0;

  for (const e of fresh) {
    const p = parseOrderSummary(e.summary);
    const { date, time } = localParts(e.start);
    let client = p.phone ? byPhone.get(normPhone(p.phone)) : null;
    if (!client && p.phone) {
      const holidays = [];
      const y = (date || today).slice(0, 4);
      if (p.occasion) holidays.push({ id: uid(), title: p.occasion.title, date: `${y}${date.slice(4)}`, yearly: true });
      else if (p.service === 'dm') holidays.push({ id: uid(), title: 'Новый год (заказ ДМ+СГ)', date: `${y}-12-31`, yearly: true });
      client = {
        id: uid(), name: p.name || ('Клиент ' + p.phone.slice(-4)), phone: p.phone, type: 'person',
        address: e.location || '', source: 'Google Календарь (авто)', notes: '', tags: [], holidays, createdAt: Date.now(),
      };
      if (!dry) {
        const { id, ...fields } = client;
        await req('PATCH', `${BASE}/clients/${id}`, { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }, token);
      }
      byPhone.set(normPhone(p.phone), client);
      addedClients++;
    }
    const deal = {
      icsUid: e.id, clientId: client ? client.id : '', service: p.service, title: p.title,
      date, time, amount: p.price || 0, prepaid: p.prepaid || 0, address: e.location || '',
      note: e.summary, stage: date && date < today ? 'done' : 'confirmed', createdAt: Date.now(),
    };
    const id = uid();
    if (!dry) await req('PATCH', `${BASE}/deals/${id}`, { fields: Object.fromEntries(Object.entries(deal).map(([k, v]) => [k, enc(v)])) }, token);
    deals.push({ id, ...deal });
    addedDeals++; sum += deal.amount;
    console.log(`${dry ? '[dry] ' : ''}+ ${date} ${time} ${p.service} ${deal.amount}₽ ${p.title}`);
  }
  console.log(`ИТОГО: +${addedDeals} сделок на ${sum} ₽, +${addedClients} клиентов`);

  // ── Зеркало ближайших заказов в «Аниматор Про» (только инфо о заказе, merge) ──
  const cById = new Map(clients.map(c => [c.id, c]));
  const upcoming = deals.filter(d => d.date && d.date >= today && d.stage !== 'cancelled');
  if (!dry) {
    for (const d of upcoming) {
      const c = d.clientId ? cById.get(d.clientId) || [...byPhone.values()].find(x => x.id === d.clientId) : null;
      const info = {
        childName: d.title || 'Заказ', childAge: 0, wishes: '',
        date: d.date || '', time: d.time || '', address: d.address || '',
        payment: Number(d.amount) || 0,
        notes: [d.note, c ? 'Клиент: ' + c.name + (c.phone ? ', ' + c.phone : '') : ''].filter(Boolean).join('\n'),
        status: d.stage === 'done' ? 'done' : 'upcoming',
        dealId: d.id, source: 'crm', updatedAt: new Date().toISOString(),
      };
      const mask = Object.keys(info).map(k => 'updateMask.fieldPaths=' + k).join('&');
      await req('PATCH', `${BASE}/assignments/deal_${d.id}?${mask}`, { fields: Object.fromEntries(Object.entries(info).map(([k, v]) => [k, enc(v)])) }, token);
    }
  }
  console.log(`предстоящих заказов ${dry ? 'к зеркалированию' : 'зеркалировано в приложение'}: ${upcoming.length}`);
}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
