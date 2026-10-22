#!/usr/bin/env python3
"""Монитор запросов «ищу Деда Мороза».

Каждый запуск (раз в 30 минут):
  • читает открытые Telegram-каналы (t.me/s/<username>) из sources.json
    и одобренные вами новые каналы;
  • ищет по всем открытым постам ВКонтакте (newsfeed.search), читает стены
    одобренных групп и комментарии под найденными постами;
  • отбирает запросы клиентов и шлёт их в Telegram-бот с черновиком ответа;
  • обрабатывает нажатия кнопок «Добавить / Не надо» под предложенными
    источниками.

Раз в 3 дня (или по кнопке запуска с digest=true) — сводка в бот:
  • заявки за 3 дня и состояние источников;
  • новые тендеры на утренники и новогодние представления (Свердловская обл.);
  • новые источники клиентов на согласование — с кнопками.

Переменные окружения (секреты GitHub):
  TELEGRAM_BOT_TOKEN — токен бота от @BotFather
  TELEGRAM_CHAT_ID   — куда слать находки (ваш chat id)
  VK_SERVICE_TOKEN   — сервисный ключ приложения ВКонтакте
  STATE_DIR          — папка с состоянием между запусками (кэш Actions)
  MAX_AGE_DAYS       — не старше скольких дней брать посты (по умолчанию 3)
  SEND_REPORT=1      — прислать отчёт о проверке источников
  FORCE_DIGEST=1     — прислать сводку раз-в-3-дня прямо сейчас
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, 'sources.json')
CALC_URL = 'https://ponipagoni-ctrl.github.io/crm/calculator/'
VK_API = 'https://api.vk.com/method/'
VK_VERSION = '5.199'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
EKB = timezone(timedelta(hours=5))
DIGEST_EVERY = timedelta(days=3)


# ─── Загрузка ─────────────────────────────────────────────────────────
def fetch(url, data=None, timeout=20):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


class TgPageParser(HTMLParser):
    """Достаёт посты из веб-превью канала t.me/s/<username>."""

    def __init__(self):
        super().__init__()
        self.posts = []
        self._cur = None
        self._text_depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get('class', '') or ''
        if tag == 'div' and 'tgme_widget_message ' in cls + ' ' and a.get('data-post'):
            self._cur = {'post': a['data-post'], 'text': '', 'date': None, 'fwd': None}
            self.posts.append(self._cur)
        elif self._cur is not None and tag == 'div' and 'tgme_widget_message_text' in cls:
            self._text_depth = 1
        elif self._text_depth:
            if tag == 'div':
                self._text_depth += 1
            if tag == 'br':
                self._cur['text'] += '\n'
        if self._cur is not None and tag == 'time' and a.get('datetime') and not self._cur['date']:
            self._cur['date'] = a['datetime']
        # «Переслано из …» — так находим соседние каналы
        if self._cur is not None and tag == 'a' and 'tgme_widget_message_forwarded_from_name' in cls:
            m = re.match(r'https://t\.me/([A-Za-z0-9_]{4,})', a.get('href', ''))
            if m:
                self._cur['fwd'] = m.group(1)

    def handle_endtag(self, tag):
        if self._text_depth and tag == 'div':
            self._text_depth -= 1

    def handle_data(self, data):
        if self._text_depth and self._cur is not None:
            self._cur['text'] += data


def parse_tg_page(page):
    p = TgPageParser()
    p.feed(page)
    for post in p.posts:
        post['text'] = html.unescape(post['text']).strip()
    return p.posts


# ─── Оценка «теплоты» ─────────────────────────────────────────────────
def norm(s):
    return s.lower().replace('ё', 'е')


def classify(text, kw):
    """'hot' / 'warm' / None.

    Запрос клиента — короткий пост без ссылок, где просьба («ищу»,
    «посоветуйте»…) стоит рядом с услугой («Деда Мороза»). Длинные посты
    со ссылками — почти всегда реклама туров, банкетов и конкурентов.
    """
    t = norm(text)
    if len(t) > kw.get('max_len', 600) or 'http' in t or 'vk.cc' in t:
        return None
    if any(norm(w) in t for w in kw['negative']):
        return None
    window = kw.get('window', 60)
    level = None
    for phrase in kw['search_phrases']:
        ph = norm(phrase)
        start = t.find(ph)
        while start != -1:
            near = t[max(0, start - window): start + len(ph) + window]
            if any(norm(w) in near for w in kw['hot']):
                return 'hot'
            if any(norm(w) in near for w in kw['warm']):
                level = 'warm'
            start = t.find(ph, start + 1)
    return level


def mentions_service(text, kw):
    t = norm(text)
    return any(norm(w) in t for w in kw['search_phrases'])


def details(text):
    """Дата / формат из текста запроса — для черновика и приоритета."""
    t = norm(text)
    d = {}
    m = re.search(r'\b([0-3]?\d)\s*(?:-?го\s*)?(декабр\w*|январ\w*)', t)
    if m:
        d['date'] = f"{m.group(1)} {m.group(2)}"
    if 'корпоратив' in t:
        d['fmt'] = 'корпоратив'
    elif any(w in t for w in ('садик', 'детский сад', 'утренник', 'школ')):
        d['fmt'] = 'утренник'
    elif 'на дом' in t or 'домой' in t:
        d['fmt'] = 'на дом'
    return d


def draft_reply(d):
    parts = ['Здравствуйте! Увидели ваш пост — мы Дед Мороз и Снегурочка в Екатеринбурге 🎅']
    if d.get('date'):
        parts.append(f"На {d['date']} подскажите, пожалуйста, район и удобное время — проверим, свободны ли мы.")
    else:
        parts.append('Напишите дату и район — подскажем свободное время.')
    parts.append(f'Костюмы и точную стоимость можно посмотреть здесь: {CALC_URL}')
    return ' '.join(parts)


# ─── Состояние между запусками ────────────────────────────────────────
def load_state(state_dir):
    path = os.path.join(state_dir, 'state.json')
    try:
        st = json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError):
        st = {}
    # совместимость: раньше отправленные посты лежали в seen.json
    if 'seen' not in st:
        try:
            st['seen'] = json.load(open(os.path.join(state_dir, 'seen.json')))
        except (OSError, ValueError):
            st['seen'] = []
    for k, v in (('approved', {}), ('rejected', []), ('candidates', {}), ('lead_log', []),
                 ('tenders_seen', []), ('tg_offset', 0), ('last_digest', None)):
        st.setdefault(k, v)
    return st


def save_state(state_dir, st):
    os.makedirs(state_dir, exist_ok=True)
    st['seen'] = st['seen'][-5000:]
    st['tenders_seen'] = st['tenders_seen'][-2000:]
    st['lead_log'] = st['lead_log'][-2000:]
    json.dump(st, open(os.path.join(state_dir, 'state.json'), 'w', encoding='utf-8'), ensure_ascii=False)


def note_candidate(st, key, name, url, post_key, members=None):
    """Копим кандидатов в новые источники между запусками."""
    if key in st['approved'] or key in st['rejected']:
        return
    c = st['candidates'].setdefault(key, {'name': name, 'url': url, 'posts': [], 'proposed': False})
    if members:
        c['members'] = members
    if post_key not in c['posts']:
        c['posts'] = (c['posts'] + [post_key])[-30:]


# ─── ВКонтакте ────────────────────────────────────────────────────────
def vk_call(token, method, **params):
    params.update(access_token=token, v=VK_VERSION)
    r = json.loads(fetch(VK_API + method + '?' + urllib.parse.urlencode(params)))
    time.sleep(0.4)  # лимит VK — 3 запроса в секунду
    if 'error' in r:
        raise RuntimeError(f"VK {r['error'].get('error_code')}: {r['error'].get('error_msg')}")
    return r['response']


def is_local(text, markers):
    t = norm(text)
    return any(norm(m) in t for m in markers)


def vk_item(it, source):
    author_id = it.get('signer_id') or it.get('from_id') or 0
    return {
        'key': f"vk:{it['owner_id']}_{it['id']}",
        'owner_id': it['owner_id'],
        'post_id': it['id'],
        'url': f"https://vk.com/wall{it['owner_id']}_{it['id']}",
        'text': it.get('text', ''),
        'date': datetime.fromtimestamp(it.get('date', 0), timezone.utc),
        'author': f'https://vk.com/id{author_id}' if author_id > 0 else None,
        'source': f'ВК · {source}',
        'comments': (it.get('comments') or {}).get('count', 0),
    }


def vk_collect(token, src, st, since, stats):
    """Посты из поиска по всему ВК (только Екатеринбург), со стен групп
    из базы и одобренных групп, плюс комментарии под ними."""
    vk, kw = src['vk'], src['keywords']
    posts = {}

    found = set()
    for q in vk['queries']:
        try:
            r = vk_call(token, 'newsfeed.search', q=q, count=200, extended=1,
                        fields='members_count', start_time=int(since.timestamp()))
        except Exception as e:
            stats['errors'].append(f'ВК поиск «{q}»: {e}')
            continue
        groups = {g['id']: g for g in r.get('groups', [])}
        for it in r.get('items', []):
            found.add((it['owner_id'], it['id']))
            g = groups.get(-it['owner_id'], {})
            place = f"{g.get('name', '')} {g.get('screen_name', '')}"
            if not is_local(it.get('text', '') + ' ' + place, vk['city_markers']):
                continue
            item = vk_item(it, g.get('name') or 'ВКонтакте')
            item['stat'] = 'ВК: поиск по всему ВК'
            posts[item['key']] = item
            if g and not looks_like_business(g.get('name', ''), vk):
                note_candidate(st, f"vk:{g['id']}", g.get('name', ''), f"https://vk.com/{g.get('screen_name') or 'club' + str(g['id'])}",
                               item['key'], g.get('members_count'))
    stats['vk_found'], stats['vk_local'] = len(found), len(posts)

    walls = [({'domain': g['id']}, g['name'])
             for g in vk.get('groups', []) if g.get('id') and g.get('status') != 'dead']
    # одобренные группы хранятся как 'vk:<id группы>'
    walls += [({'owner_id': -int(k[3:])}, a['name']) for k, a in st['approved'].items() if k.startswith('vk:')]
    for params, name in walls:
        try:
            r = vk_call(token, 'wall.get', count=30, **params)
        except Exception as e:
            stats['errors'].append(f'ВК {name}: {e}')
            continue
        fresh = [it for it in r.get('items', []) if it.get('date', 0) >= since.timestamp()]
        for it in fresh:
            item = vk_item(it, name)
            item['stat'] = f'ВК: {name}'
            posts[item['key']] = item
        stats['sources'][f'ВК: {name}'] = {'posts': len(fresh)}

    # Комментарии — под постами про Деда Мороза, где они есть
    comments = []
    with_comments = [p for p in posts.values() if p['comments'] and mentions_service(p['text'], kw)][:40]
    for p in with_comments:
        try:
            r = vk_call(token, 'wall.getComments', owner_id=p['owner_id'], post_id=p['post_id'],
                        count=100, sort='desc')
        except Exception as e:
            stats['errors'].append(f"ВК комментарии {p['url']}: {e}")
            continue
        for c in r.get('items', []):
            if not c.get('text') or c.get('date', 0) < since.timestamp():
                continue
            from_id = c.get('from_id', 0)
            comments.append({
                'key': f"vk:c:{p['owner_id']}_{p['post_id']}_{c['id']}",
                'url': f"{p['url']}?reply={c['id']}",
                'text': c['text'],
                'date': datetime.fromtimestamp(c['date'], timezone.utc),
                'author': f'https://vk.com/id{from_id}' if from_id > 0 else None,
                'source': p['source'] + ' · комментарий',
                'stat': 'ВК: комментарии',
            })
    stats['vk_comment_posts'] = len(with_comments)
    stats['vk_comments'] = len(comments)
    return list(posts.values()) + comments


def looks_like_business(name, vk):
    n = norm(name)
    return any(norm(w) in n for w in vk.get('business_words', []))


# ─── Тендеры ──────────────────────────────────────────────────────────
def tender_match(title, cfg):
    t = norm(title)
    return (any(re.search(p, t) for p in cfg['include'])
            and not any(norm(w) in t for w in cfg['exclude']))


def tenders_rostender(cfg, errors):
    out = []
    for page in (1, 2, 3):
        url = 'https://rostender.info/category/tendery-provedenie-novogo-goda' + (f'?page={page}' if page > 1 else '')
        try:
            body = fetch(url)
        except Exception as e:
            errors.append(f'РосТендер: {e}')
            break
        for href, title in re.findall(r'<a[^>]+href="([^"]*/region/sverdlovskaya-oblast/[^"]*?\d+-tender-[^"]*)"[^>]*>(.*?)</a>', body, re.S):
            title = html.unescape(re.sub(r'<[^>]+>', ' ', title)).strip()
            title = re.sub(r'\s+', ' ', title)
            if title and tender_match(title, cfg):
                link = href if href.startswith('http') else 'https://rostender.info' + href
                out.append({'id': link, 'title': title, 'url': link, 'site': 'РосТендер', 'extra': ''})
    return out


def tenders_eis(cfg, errors):
    """ЕИС zakupki.gov.ru, RSS расширенного поиска. Только активные закупки."""
    out = []
    for q in cfg['eis_queries']:
        url = ('https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?'
               + urllib.parse.urlencode({'searchString': q, 'morphology': 'on', 'af': 'on',
                                         'sortBy': 'UPDATE_DATE', 'sortDirection': 'false',
                                         'recordsPerPage': '_50'}))
        try:
            root = ET.fromstring(fetch(url, timeout=30))
        except ET.ParseError as e:
            errors.append(f'ЕИС «{q}»: ответ не похож на RSS ({e})')
            continue
        except Exception as e:
            errors.append(f'ЕИС: сайт не ответил ({e})')
            break  # сайт недоступен — остальные запросы тоже не пройдут
        for item in root.iter('item'):
            title = (item.findtext('title') or '').strip()
            link = (item.findtext('link') or '').strip()
            desc = html.unescape(re.sub(r'<[^>]+>', ' ', item.findtext('description') or ''))
            desc = re.sub(r'\s+', ' ', desc)
            if not link or not is_local(desc, cfg['region_markers']):
                continue
            if not tender_match(title + ' ' + desc, cfg):
                continue
            if link.startswith('/'):
                link = 'https://zakupki.gov.ru' + link
            price = re.search(r'Начальная цена[^0-9]*([\d\s.,]+)', desc)
            till = re.search(r'Окончани\w+ подачи заявок[^0-9]*([\d.]+)', desc)
            extra = ' · '.join(x for x in (
                f'цена {price.group(1).strip()} ₽' if price else '',
                f'заявки до {till.group(1)}' if till else '') if x)
            out.append({'id': link, 'title': desc[:200] or title, 'url': link, 'site': 'ЕИС', 'extra': extra})
    return out


# ─── Telegram-бот ─────────────────────────────────────────────────────
def tg_api(token, method, params):
    data = urllib.parse.urlencode(params).encode()
    return json.loads(fetch(f'https://api.telegram.org/bot{token}/{method}', data=data))


def send(token, chat_id, text, buttons=None):
    params = {'chat_id': chat_id, 'text': text[:4000], 'disable_web_page_preview': 'true'}
    if buttons:
        params['reply_markup'] = json.dumps({'inline_keyboard': buttons}, ensure_ascii=False)
    return tg_api(token, 'sendMessage', params)


def answer_start_commands(token):
    """Если chat id ещё не задан — отвечаем на /start, сообщая chat id."""
    try:
        upd = tg_api(token, 'getUpdates', {'timeout': 0})
    except Exception as e:
        print('getUpdates error:', e)
        return
    done = set()
    for u in upd.get('result', []):
        msg = u.get('message') or {}
        chat = msg.get('chat') or {}
        if chat.get('type') == 'private' and chat['id'] not in done:
            done.add(chat['id'])
            send(token, chat['id'], f"Ваш chat id: {chat['id']}\nДобавьте его в GitHub как секрет TELEGRAM_CHAT_ID.")
    print(f'answered /start in {len(done)} chat(s)')


def process_buttons(token, chat_id, st):
    """Нажатия «✅ Добавить / ❌ Не надо» под предложенными источниками."""
    try:
        upd = tg_api(token, 'getUpdates', {'offset': st['tg_offset'], 'timeout': 0,
                                           'allowed_updates': json.dumps(['message', 'callback_query'])})
    except Exception as e:
        print('getUpdates error:', e)
        return
    for u in upd.get('result', []):
        st['tg_offset'] = u['update_id'] + 1
        cq = u.get('callback_query')
        if not cq or str((cq.get('message') or {}).get('chat', {}).get('id')) != str(chat_id):
            continue
        action, _, key = (cq.get('data') or '').partition('|')
        cand = st['candidates'].pop(key, None) or {'name': key, 'url': ''}
        if action == 'add':
            st['approved'][key] = {'name': cand['name'], 'url': cand['url']}
            mark = '✅ Добавлено — читаю этот источник с ближайшего запуска'
        elif action == 'skip':
            if key not in st['rejected']:
                st['rejected'].append(key)
            mark = '❌ Не добавляем'
        else:
            continue
        msg = cq['message']
        try:
            tg_api(token, 'answerCallbackQuery', {'callback_query_id': cq['id'], 'text': mark})
        except Exception:
            pass  # кнопку нажали давно — подтверждение уже не нужно
        try:
            tg_api(token, 'editMessageText', {'chat_id': chat_id, 'message_id': msg['message_id'],
                                              'text': f"{msg.get('text', '')}\n\n{mark}",
                                              'disable_web_page_preview': 'true'})
        except Exception as e:
            print('editMessageText error:', e)


def notify(token, chat_id, lead):
    head = '🔥 Горячий запрос' if lead['level'] == 'hot' else '🙂 Тёплый запрос'
    text = lead['text'] if len(lead['text']) <= 700 else lead['text'][:700] + '…'
    body = (
        f"{head} · {lead['source']}\n"
        f"{lead['date_h']}\n\n"
        f"{text}\n\n"
        f"🔗 {lead['url']}\n"
        + (f"👤 Автор: {lead['author']}\n" if lead.get('author') else '')
        + "\n"
        f"✍️ Черновик ответа:\n{lead['draft']}"
    )
    send(token, chat_id, body)


def source_report(stats, new_leads):
    lines = []
    if 'vk_found' in stats:
        lines.append(f"ВК, поиск по всему ВК: постов со словами «Дед Мороз» и т.п. — {stats['vk_found']}, "
                     f"из Екатеринбурга — {stats['vk_local']}")
        lines.append(f"ВК, комментарии: проверено постов — {stats.get('vk_comment_posts', 0)}, "
                     f"свежих комментариев — {stats.get('vk_comments', 0)}")
    for name, s in stats['sources'].items():
        lines.append(f"{'✓' if s['posts'] else '·'} {name}: свежих постов — {s['posts']}")
    for e in stats['errors']:
        lines.append(f'✗ {e}')
    lines.append(f"\nНовых заявок клиентов в этом запуске: {new_leads}"
                 + ('' if new_leads else ' (реклама, туры и посты не по теме отсеяны)'))
    return '\n'.join(lines)


# ─── Сводка раз в 3 дня ───────────────────────────────────────────────
def digest(token, chat_id, src, st, stats, now):
    cfg = src['b2b_tenders']
    t_errors = []
    tenders = tenders_eis(cfg, t_errors) + tenders_rostender(cfg, t_errors)
    new_tenders = [t for t in {t['id']: t for t in tenders}.values() if t['id'] not in st['tenders_seen']]

    since = now - DIGEST_EVERY
    leads_3d = [x for x in st['lead_log'] if datetime.fromisoformat(x['at']) >= since]
    by_src = {}
    for x in leads_3d:
        by_src[x['source']] = by_src.get(x['source'], 0) + 1

    lines = [f"📊 Сводка за 3 дня ({since.astimezone(EKB):%d.%m}–{now.astimezone(EKB):%d.%m})", '',
             f"Заявок клиентов: {len(leads_3d)}"]
    lines += [f"  • {k}: {v}" for k, v in sorted(by_src.items(), key=lambda kv: -kv[1])]
    lines += ['', 'Источники сейчас:', source_report(stats, stats.get('new_leads', 0))]
    send(token, chat_id, '\n'.join(lines))

    if new_tenders:
        msg = ['📑 Новые тендеры по вашей нише (Свердловская область):', '']
        for t in new_tenders[:15]:
            msg.append(f"• {t['title']}" + (f"\n  {t['extra']}" if t['extra'] else '') + f"\n  {t['site']}: {t['url']}")
        send(token, chat_id, '\n'.join(msg))
    else:
        send(token, chat_id, '📑 Тендеры: новых закупок на утренники, Деда Мороза и новогодние представления '
                             'по Свердловской области не найдено.'
             + ('\n\nНе удалось проверить:\n' + '\n'.join(t_errors) if t_errors else ''))
    for t in new_tenders:
        st['tenders_seen'].append(t['id'])
    print(f'сводка: тендеров найдено {len(tenders)}, новых {len(new_tenders)}')
    for e in t_errors:
        print('  тендеры ✗', e)

    fresh = sorted(((k, c) for k, c in st['candidates'].items() if not c['proposed']),
                   key=lambda kc: -len(kc[1]['posts']))[:8]
    if fresh:
        send(token, chat_id, f'🔎 Новые источники клиентов на согласование: {len(fresh)}. '
                             'Нажмите под каждым «Добавить» или «Не надо» — ответ учту в течение 30 минут.')
        for key, c in fresh:
            kind = 'Группа ВК' if key.startswith('vk:') else 'Telegram-канал'
            members = ', подписчиков: ' + f"{c['members']:,}".replace(',', ' ') if c.get('members') else ''
            why = (f"постов про Деда Мороза из Екатеринбурга: {len(c['posts'])}" if key.startswith('vk:')
                   else f"из него пересылают посты в отслеживаемые каналы: {len(c['posts'])} раз")
            send(token, chat_id, f"{kind}: {c['name']}{members}\n{c['url']}\nПочему: {why}",
                 buttons=[[{'text': '✅ Добавить', 'callback_data': f'add|{key}'},
                           {'text': '❌ Не надо', 'callback_data': f'skip|{key}'}]])
            c['proposed'] = True
    else:
        send(token, chat_id, '🔎 Новых источников за 3 дня не нашлось.')
    print(f'сводка: предложено новых источников {len(fresh)}')

    st['last_digest'] = now.isoformat()


# ─── Основной проход ──────────────────────────────────────────────────
def main():
    src = json.load(open(SOURCES, encoding='utf-8'))
    kw = src['keywords']
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
    chat_id = os.environ.get('TELEGRAM_CHAT_ID', '').strip()
    vk_token = os.environ.get('VK_SERVICE_TOKEN', '').strip()
    state_dir = os.environ.get('STATE_DIR', os.path.join(HERE, 'state'))
    max_age = timedelta(days=int(os.environ.get('MAX_AGE_DAYS', '3')))
    now = datetime.now(timezone.utc)
    st = load_state(state_dir)
    seen = set(st['seen'])

    if token and chat_id:
        process_buttons(token, chat_id, st)

    leads = []
    stats = {'sources': {}, 'errors': []}

    def add_lead(key, url, text, date, source, stat, author=None):
        if key in seen:
            return
        level = classify(text, kw)
        if not level:
            return
        leads.append({
            'level': level, 'source': source, 'stat': stat, 'url': url, 'post': key,
            'author': author, 'text': text,
            'date_h': date.astimezone(EKB).strftime('%d.%m %H:%M'),
            'draft': draft_reply(details(text)),
        })

    # Telegram: каналы из базы + одобренные
    channels = [(s['username'], s['name']) for grp in ('channels', 'chats')
                for s in src['telegram'][grp] if s.get('username') and s.get('status') != 'dead']
    channels += [(k[3:], a['name']) for k, a in st['approved'].items() if k.startswith('tg:')]
    known_tg = {u.lower() for u, _ in channels}
    for name, title in channels:
        label = f'TG: @{name}'
        try:
            posts = parse_tg_page(fetch(f'https://t.me/s/{name}'))
        except Exception as e:
            stats['errors'].append(f'@{name}: {e}')
            continue
        fresh = 0
        for p in posts:
            date = datetime.fromisoformat(p['date']) if p['date'] else now
            if now - date > max_age:
                continue
            fresh += 1
            if p['fwd'] and p['fwd'].lower() not in known_tg:
                note_candidate(st, f"tg:{p['fwd']}", '@' + p['fwd'], f"https://t.me/{p['fwd']}", p['post'])
            if p['text']:
                add_lead(p['post'], f"https://t.me/{p['post']}", p['text'], date, f'@{name}', label)
        stats['sources'][label] = {'posts': fresh}

    # ВКонтакте
    if vk_token:
        for p in vk_collect(vk_token, src, st, now - max_age, stats):
            add_lead(p['key'], p['url'], p['text'], p['date'], p['source'], p['stat'], p['author'])
    else:
        stats['errors'].append('ВК: ключ VK_SERVICE_TOKEN не задан')
    stats['new_leads'] = len(leads)

    report = source_report(stats, len(leads))
    print(report)
    for lead in leads:
        print(f"  [{lead['level']}] {lead['url']}: {lead['text'][:80]!r}")

    if not token:
        print('TELEGRAM_BOT_TOKEN не задан — уведомления не отправлены')
    elif not chat_id:
        answer_start_commands(token)
    else:
        leads.sort(key=lambda x: x['level'] != 'hot')
        for lead in leads:
            try:
                notify(token, chat_id, lead)
                st['seen'].append(lead['post'])
                st['lead_log'].append({'at': now.isoformat(), 'source': lead['stat'], 'level': lead['level']})
            except Exception as e:
                print('sendMessage error:', e)
        if os.environ.get('SEND_REPORT') == '1':
            send(token, chat_id, '📋 Проверка источников\n\n' + report)
        last = st['last_digest'] and datetime.fromisoformat(st['last_digest'])
        if os.environ.get('FORCE_DIGEST') == '1' or not last or now - last >= DIGEST_EVERY:
            try:
                digest(token, chat_id, src, st, stats, now)
            except Exception as e:
                print('digest error:', e)

    save_state(state_dir, st)


if __name__ == '__main__':
    sys.exit(main())
