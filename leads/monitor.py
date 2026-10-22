#!/usr/bin/env python3
"""Монитор запросов «ищу Деда Мороза».

Читает открытые Telegram-каналы из sources.json (через t.me/s/<username>)
и ищет по всем открытым постам ВКонтакте (newsfeed.search), находит
запросы клиентов по ключевым словам и шлёт их в Telegram-бот
с готовым черновиком ответа.

Переменные окружения (секреты GitHub):
  TELEGRAM_BOT_TOKEN — токен бота от @BotFather
  TELEGRAM_CHAT_ID   — куда слать находки (ваш chat id)
  VK_SERVICE_TOKEN   — сервисный ключ приложения ВКонтакте
  SEEN_FILE          — файл с уже отправленными постами (кэш между запусками)
  MAX_AGE_DAYS       — не старше скольких дней брать посты (по умолчанию 3)
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, 'sources.json')
CALC_URL = 'https://ponipagoni-ctrl.github.io/crm/calculator/'
VK_API = 'https://api.vk.com/method/'
VK_VERSION = '5.199'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


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
            self._cur = {'post': a['data-post'], 'text': '', 'date': None}
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
    return [x for x in p.posts if x['text']]


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


def vk_posts(token, vk, since):
    """Посты из поиска по всему ВК (только Екатеринбург) и со стен групп из базы.

    Возвращает (posts, report): posts — dict с key/url/text/date/author/source.
    """
    posts, report = {}, []

    found = local = 0
    for q in vk['queries']:
        try:
            r = vk_call(token, 'newsfeed.search', q=q, count=200, extended=1, start_time=int(since.timestamp()))
        except Exception as e:
            report.append(f'✗ VK поиск «{q}»: {e}')
            continue
        groups = {g['id']: g for g in r.get('groups', [])}
        for it in r.get('items', []):
            found += 1
            g = groups.get(-it['owner_id'], {})
            place = f"{g.get('name', '')} {g.get('screen_name', '')}"
            if not is_local(it.get('text', '') + ' ' + place, vk['city_markers']):
                continue
            local += 1
            key = f"vk:{it['owner_id']}_{it['id']}"
            posts[key] = vk_item(it, key, g.get('name') or 'ВКонтакте')
    report.append(f'✓ VK поиск: постов {found}, из Екатеринбурга {local}')

    for grp in vk.get('groups', []):
        if not grp.get('id') or grp.get('status') == 'dead':
            continue
        try:
            r = vk_call(token, 'wall.get', domain=grp['id'], count=50)
        except Exception as e:
            report.append(f"✗ VK {grp['id']}: {e}")
            continue
        items = [it for it in r.get('items', []) if it.get('date', 0) >= since.timestamp()]
        for it in items:
            key = f"vk:{it['owner_id']}_{it['id']}"
            posts[key] = vk_item(it, key, grp['name'])
        report.append(f"✓ VK {grp['id']}: свежих постов {len(items)}")

    return list(posts.values()), report


def vk_item(it, key, source):
    author_id = it.get('signer_id') or it.get('from_id') or 0
    return {
        'key': key,
        'url': f"https://vk.com/wall{it['owner_id']}_{it['id']}",
        'text': it.get('text', ''),
        'date': datetime.fromtimestamp(it.get('date', 0), timezone.utc),
        'author': f'https://vk.com/id{author_id}' if author_id > 0 else None,
        'source': f'ВК · {source}',
    }


# ─── Telegram-бот ─────────────────────────────────────────────────────
def tg_api(token, method, params):
    data = urllib.parse.urlencode(params).encode()
    return json.loads(fetch(f'https://api.telegram.org/bot{token}/{method}', data=data))


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
            tg_api(token, 'sendMessage', {
                'chat_id': chat['id'],
                'text': f"Ваш chat id: {chat['id']}\nДобавьте его в GitHub как секрет TELEGRAM_CHAT_ID.",
            })
    print(f'answered /start in {len(done)} chat(s)')


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
    tg_api(token, 'sendMessage', {'chat_id': chat_id, 'text': body, 'disable_web_page_preview': 'true'})


# ─── Основной проход ──────────────────────────────────────────────────
def telegram_sources(src):
    for group in ('channels', 'chats'):
        for s in src['telegram'][group]:
            if s.get('username') and s.get('status') != 'dead':
                yield s


def main():
    src = json.load(open(SOURCES, encoding='utf-8'))
    kw = src['keywords']
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
    chat_id = os.environ.get('TELEGRAM_CHAT_ID', '').strip()
    seen_file = os.environ.get('SEEN_FILE', os.path.join(HERE, 'state', 'seen.json'))
    max_age = timedelta(days=int(os.environ.get('MAX_AGE_DAYS', '3')))
    now = datetime.now(timezone.utc)

    try:
        seen = set(json.load(open(seen_file)))
    except (OSError, ValueError):
        seen = set()

    leads, report = [], []

    def add_lead(key, url, text, date, source, author=None):
        if key in seen:
            return
        level = classify(text, kw)
        if not level:
            return
        leads.append({
            'level': level,
            'source': source,
            'url': url,
            'post': key,
            'author': author,
            'text': text,
            'date_h': date.astimezone(timezone(timedelta(hours=5))).strftime('%d.%m %H:%M'),
            'draft': draft_reply(details(text)),
        })

    for s in telegram_sources(src):
        name = s['username']
        try:
            posts = parse_tg_page(fetch(f'https://t.me/s/{name}'))
        except Exception as e:
            report.append(f'✗ @{name}: {e}')
            continue
        fresh = 0
        for p in posts:
            date = datetime.fromisoformat(p['date']) if p['date'] else now
            if now - date > max_age:
                continue
            fresh += 1
            add_lead(p['post'], f"https://t.me/{p['post']}", p['text'], date, f'@{name}')
        report.append(f"{'✓' if posts else '·'} @{name}: постов {len(posts)}, свежих {fresh}")

    vk_token = os.environ.get('VK_SERVICE_TOKEN', '').strip()
    if vk_token:
        vk_found, vk_report = vk_posts(vk_token, src['vk'], now - max_age)
        report += vk_report
        for p in vk_found:
            add_lead(p['key'], p['url'], p['text'], p['date'], p['source'], p['author'])
    else:
        report.append('· VK: ключ VK_SERVICE_TOKEN не задан')

    print('\n'.join(report))
    print(f'найдено новых запросов: {len(leads)}')
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
                seen.add(lead['post'])
            except Exception as e:
                print('sendMessage error:', e)
        if os.environ.get('SEND_REPORT') == '1':
            tg_api(token, 'sendMessage', {'chat_id': chat_id, 'text': 'Проверка источников:\n' + '\n'.join(report)})

    os.makedirs(os.path.dirname(seen_file), exist_ok=True)
    json.dump(sorted(seen)[-5000:], open(seen_file, 'w'))


if __name__ == '__main__':
    sys.exit(main())
