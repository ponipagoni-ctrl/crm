#!/usr/bin/env python3
"""Монитор запросов «ищу Деда Мороза».

Читает открытые Telegram-каналы из sources.json (через t.me/s/<username>),
находит запросы клиентов по ключевым словам и шлёт их в Telegram-бот
с готовым черновиком ответа.

Переменные окружения (секреты GitHub):
  TELEGRAM_BOT_TOKEN — токен бота от @BotFather
  TELEGRAM_CHAT_ID   — куда слать находки (ваш chat id)
  SEEN_FILE          — файл с уже отправленными постами (кэш между запусками)
  MAX_AGE_DAYS       — не старше скольких дней брать посты (по умолчанию 3)
"""
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, 'sources.json')
CALC_URL = 'https://ponipagoni-ctrl.github.io/crm/calculator/'
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
    t = norm(text)
    if not any(norm(w) in t for w in kw['search_phrases']):
        return None
    if any(norm(w) in t for w in kw['negative']):
        return None
    if any(norm(w) in t for w in kw['hot']):
        return 'hot'
    if any(norm(w) in t for w in kw['warm']):
        return 'warm'
    return None


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
        f"🔗 {lead['url']}\n\n"
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
            if p['post'] in seen:
                continue
            level = classify(p['text'], kw)
            if not level:
                continue
            d = details(p['text'])
            leads.append({
                'level': level,
                'source': f'@{name}',
                'url': f"https://t.me/{p['post']}",
                'post': p['post'],
                'text': p['text'],
                'date_h': date.astimezone(timezone(timedelta(hours=5))).strftime('%d.%m %H:%M'),
                'draft': draft_reply(d),
            })
        report.append(f"{'✓' if posts else '·'} @{name}: постов {len(posts)}, свежих {fresh}")

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
