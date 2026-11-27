"""
Бот салона маникюра с маскотом бренда — мастером Машей.

Маскот (персонаж, созданный в нейросети) сопровождает клиента на каждом шаге:
  👋 приветствует  →  💅 «Вы записаны на маникюр»  →  👌 «Ваша запись подтверждена»
  →  🙏 «Благодарим вас за визит» + просьба оценить салон.

Картинки маскота положите в папку images/ рядом с bot.py:
  hello.png      — Маша машет рукой (приветствие)
  booked.png     — Маша с пилочкой и лаком («Вы записаны на маникюр»)
  confirmed.png  — Маша показывает «ОК» («Ваша запись подтверждена»)
  thanks.png     — Маша складывает ладони («Благодарим вас за визит»)
  sad.png        — Маша грустит (отмена записи)
Если картинки нет, бот просто отправит текст.

Запуск:
  pip install -r requirements.txt
  export BOT_TOKEN="токен_от_BotFather"
  export ADMIN_ID="ваш_telegram_id"   (необязательно: сюда придут заявки; узнать id — @userinfobot)
  python bot.py

Администратор после визита клиента отправляет команду /visit <номер записи> —
клиенту приходит благодарность от Маши и просьба поставить оценку.
"""

import asyncio
import json
import logging
import os
from datetime import date, timedelta
from pathlib import Path

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery,
    FSInputFile,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)

BOT_TOKEN = os.getenv("BOT_TOKEN", "ВСТАВЬТЕ_СЮДА_ТОКЕН")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))

BRAND = "Студия маникюра «Ноготок»"
MASCOT = "Маша"
ADDRESS = "ул. Ленина, 1"  # поменяйте на свой адрес
PHONE = "+7 (900) 000-00-00"

BASE = Path(__file__).parent
IMAGES = BASE / "images"
DATA_FILE = BASE / "bookings.json"

SERVICES = {
    "classic": ("Классический маникюр", 800),
    "gel": ("Маникюр + гель-лак", 1500),
    "design": ("Гель-лак + дизайн", 1900),
    "ext": ("Наращивание ногтей", 2500),
    "pedi": ("Педикюр", 1800),
}
TIMES = ["10:00", "12:00", "14:00", "16:00", "18:00"]
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

router = Router()

# ---------------------------------------------------------------- хранилище

def load() -> dict:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return {"next_id": 1, "bookings": {}}


def save() -> None:
    DATA_FILE.write_text(json.dumps(DB, ensure_ascii=False, indent=2), encoding="utf-8")


DB = load()


def busy_times(day: str) -> set[str]:
    return {b["time"] for b in DB["bookings"].values() if b["date"] == day and b["status"] == "active"}


# ---------------------------------------------------------------- маскот

async def mascot(target: Message, image: str, text: str, kb=None):
    """Отправляет картинку маскота с подписью, либо просто текст, если картинки нет."""
    path = IMAGES / image
    if path.exists():
        await target.answer_photo(FSInputFile(path), caption=text, reply_markup=kb)
    else:
        await target.answer(text, reply_markup=kb)


async def mascot_to(bot: Bot, chat_id: int, image: str, text: str, kb=None):
    path = IMAGES / image
    if path.exists():
        await bot.send_photo(chat_id, FSInputFile(path), caption=text, reply_markup=kb)
    else:
        await bot.send_message(chat_id, text, reply_markup=kb)


# ---------------------------------------------------------------- клавиатуры

MAIN_KB = ReplyKeyboardMarkup(resize_keyboard=True, keyboard=[
    [KeyboardButton(text="💅 Записаться")],
    [KeyboardButton(text="💰 Услуги и цены"), KeyboardButton(text="📋 Мои записи")],
    [KeyboardButton(text="📍 Контакты"), KeyboardButton(text="💬 Спросить Машу")],
])


def ikb(rows):
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=t, callback_data=d) for t, d in r]
                                                 for r in rows])


def services_kb():
    return ikb([[(f"{name} — {price} ₽", f"svc:{key}")] for key, (name, price) in SERVICES.items()])


def dates_kb():
    rows, row = [], []
    for i in range(1, 8):
        d = date.today() + timedelta(days=i)
        row.append((f"{WEEKDAYS[d.weekday()]} {d:%d.%m}", f"day:{d.isoformat()}"))
        if len(row) == 3:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([("⬅️ Назад", "back:svc")])
    return ikb(rows)


def times_kb(day: str):
    busy = busy_times(day)
    free = [t for t in TIMES if t not in busy]
    rows = [[(t, f"time:{t}") for t in free[i:i + 3]] for i in range(0, len(free), 3)]
    rows.append([("⬅️ Другая дата", "back:day")])
    return ikb(rows), bool(free)


class Book(StatesGroup):
    service = State()
    day = State()
    time = State()
    name = State()
    phone = State()
    confirm = State()


class Ask(StatesGroup):
    question = State()


# ---------------------------------------------------------------- старт

@router.message(CommandStart())
async def start(m: Message, state: FSMContext):
    await state.clear()
    await mascot(
        m, "hello.png",
        f"Привет, {m.from_user.first_name}! Я {MASCOT} 💖\n"
        f"Добро пожаловать: {BRAND}!\n\n"
        "Помогу записаться на маникюр, расскажу о ценах и напомню о визите.\n"
        "Что делаем?",
        MAIN_KB,
    )


@router.message(Command("cancel"))
async def cancel(m: Message, state: FSMContext):
    await state.clear()
    await m.answer("Хорошо, отменила 🙂", reply_markup=MAIN_KB)


@router.message(F.text == "💰 Услуги и цены")
async def prices(m: Message):
    text = "\n".join(f"• {n} — <b>{p} ₽</b>" for n, p in SERVICES.values())
    await m.answer(f"<b>Наши услуги:</b>\n\n{text}\n\nЗаписаться — кнопка «💅 Записаться»")


@router.message(F.text == "📍 Контакты")
async def contacts(m: Message):
    await m.answer(f"<b>{BRAND}</b>\n📍 {ADDRESS}\n📞 {PHONE}\n🕙 Ежедневно 10:00–20:00")


# ---------------------------------------------------------------- запись

@router.message(F.text == "💅 Записаться")
async def book_start(m: Message, state: FSMContext):
    await state.clear()
    await state.set_state(Book.service)
    await m.answer("Выберите услугу 💅", reply_markup=services_kb())


@router.callback_query(Book.service, F.data.startswith("svc:"))
async def book_service(c: CallbackQuery, state: FSMContext):
    await state.update_data(service=c.data.split(":")[1])
    await state.set_state(Book.day)
    await c.message.edit_text("На какой день записать? 📅", reply_markup=dates_kb())
    await c.answer()


@router.callback_query(F.data == "back:svc")
async def back_svc(c: CallbackQuery, state: FSMContext):
    await state.set_state(Book.service)
    await c.message.edit_text("Выберите услугу 💅", reply_markup=services_kb())
    await c.answer()


@router.callback_query(Book.day, F.data.startswith("day:"))
async def book_day(c: CallbackQuery, state: FSMContext):
    day = c.data.split(":", 1)[1]
    kb, has_free = times_kb(day)
    if not has_free:
        await c.answer("На этот день всё занято 😔 Выберите другой", show_alert=True)
        return
    await state.update_data(day=day)
    await state.set_state(Book.time)
    await c.message.edit_text(f"{date.fromisoformat(day):%d.%m} — выберите время ⏰", reply_markup=kb)
    await c.answer()


@router.callback_query(F.data == "back:day")
async def back_day(c: CallbackQuery, state: FSMContext):
    await state.set_state(Book.day)
    await c.message.edit_text("На какой день записать? 📅", reply_markup=dates_kb())
    await c.answer()


@router.callback_query(Book.time, F.data.startswith("time:"))
async def book_time(c: CallbackQuery, state: FSMContext):
    await state.update_data(time=c.data.split(":", 1)[1])
    await state.set_state(Book.name)
    await c.message.edit_text("Как к вам обращаться? Напишите имя ✍️")
    await c.answer()


@router.message(Book.name)
async def book_name(m: Message, state: FSMContext):
    await state.update_data(name=(m.text or "").strip()[:50])
    await state.set_state(Book.phone)
    kb = ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True, keyboard=[
        [KeyboardButton(text="📱 Отправить мой номер", request_contact=True)]])
    await m.answer("Оставьте номер телефона — нажмите кнопку или напишите вручную", reply_markup=kb)


@router.message(Book.phone)
async def book_phone(m: Message, state: FSMContext):
    phone = m.contact.phone_number if m.contact else (m.text or "").strip()
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 10:
        await m.answer("Кажется, в номере ошибка. Напишите, например: +7 900 123-45-67")
        return
    await state.update_data(phone=phone)
    d = await state.get_data()
    name, price = SERVICES[d["service"]]
    await state.set_state(Book.confirm)
    await m.answer("Почти готово!", reply_markup=ReplyKeyboardRemove())
    await mascot(
        m, "booked.png",
        "<b>Вы записаны на маникюр</b> 💅\n\n"
        f"Услуга: {name} — {price} ₽\n"
        f"Дата: {date.fromisoformat(d['day']):%d.%m.%Y}, {d['time']}\n"
        f"Имя: {d['name']}\nТелефон: {phone}\n\nВсё верно?",
        ikb([[("✅ Подтвердить", "ok"), ("❌ Отменить", "no")]]),
    )


@router.callback_query(Book.confirm, F.data == "no")
async def book_no(c: CallbackQuery, state: FSMContext):
    await state.clear()
    await c.message.delete()
    await mascot(c.message, "sad.png", "Жаль 😔 Буду ждать вас в другой раз!", MAIN_KB)
    await c.answer()


@router.callback_query(Book.confirm, F.data == "ok")
async def book_ok(c: CallbackQuery, state: FSMContext, bot: Bot):
    d = await state.get_data()
    await state.clear()
    if d["time"] in busy_times(d["day"]):
        await c.message.delete()
        await c.message.answer("Ой, это время только что заняли 😔 Попробуйте выбрать другое.",
                               reply_markup=MAIN_KB)
        await c.answer()
        return
    bid = str(DB["next_id"])
    DB["next_id"] += 1
    DB["bookings"][bid] = {
        "user_id": c.from_user.id, "service": d["service"], "date": d["day"], "time": d["time"],
        "name": d["name"], "phone": d["phone"], "status": "active", "reminded": False,
    }
    save()
    name, price = SERVICES[d["service"]]
    await c.message.delete()
    await mascot(
        c.message, "confirmed.png",
        f"<b>Ваша запись подтверждена!</b> 👌\n\n№{bid}: {name}\n"
        f"📅 {date.fromisoformat(d['day']):%d.%m.%Y} в {d['time']}\n📍 {ADDRESS}\n\n"
        "Накануне я пришлю напоминание. До встречи! 💖",
        MAIN_KB,
    )
    await c.answer()
    if ADMIN_ID:
        await bot.send_message(
            ADMIN_ID,
            f"🆕 Новая запись №{bid}\n{name} — {price} ₽\n"
            f"{date.fromisoformat(d['day']):%d.%m.%Y} {d['time']}\n{d['name']}, {d['phone']}\n\n"
            f"После визита отправьте: /visit {bid}",
        )


# ---------------------------------------------------------------- мои записи

@router.message(F.text == "📋 Мои записи")
async def my_bookings(m: Message):
    mine = [(bid, b) for bid, b in DB["bookings"].items()
            if b["user_id"] == m.from_user.id and b["status"] == "active"]
    if not mine:
        await m.answer("У вас нет активных записей. Нажмите «💅 Записаться» 🙂")
        return
    for bid, b in mine:
        await m.answer(
            f"№{bid}: {SERVICES[b['service']][0]}\n📅 {date.fromisoformat(b['date']):%d.%m.%Y} в {b['time']}",
            reply_markup=ikb([[("❌ Отменить запись", f"cancel:{bid}")]]),
        )


@router.callback_query(F.data.startswith("cancel:"))
async def cancel_booking(c: CallbackQuery, bot: Bot):
    bid = c.data.split(":")[1]
    b = DB["bookings"].get(bid)
    if not b or b["user_id"] != c.from_user.id:
        await c.answer("Запись не найдена")
        return
    b["status"] = "cancelled"
    save()
    await c.message.delete()
    await mascot(c.message, "sad.png", f"Запись №{bid} отменена 😔 Буду рада видеть вас снова!")
    await c.answer()
    if ADMIN_ID:
        await bot.send_message(ADMIN_ID, f"❌ Клиент отменил запись №{bid} ({b['date']} {b['time']})")


# ---------------------------------------------------------------- вопрос мастеру

@router.message(F.text == "💬 Спросить Машу")
async def ask(m: Message, state: FSMContext):
    await state.set_state(Ask.question)
    await m.answer("Напишите ваш вопрос — я передам его администратору ✍️")


@router.message(Ask.question)
async def ask_send(m: Message, state: FSMContext, bot: Bot):
    await state.clear()
    if ADMIN_ID:
        await bot.send_message(ADMIN_ID, f"💬 Вопрос от {m.from_user.full_name} (id {m.from_user.id}):\n{m.text}\n\n"
                                         f"Ответить: /reply {m.from_user.id} текст")
    await m.answer("Спасибо! Ответим в ближайшее время 💖", reply_markup=MAIN_KB)


@router.message(Command("reply"))
async def admin_reply(m: Message, command: CommandObject, bot: Bot):
    if m.from_user.id != ADMIN_ID or not command.args or " " not in command.args:
        return
    uid, text = command.args.split(" ", 1)
    await bot.send_message(int(uid), f"💬 Ответ от {MASCOT}:\n{text}")
    await m.answer("Отправлено ✅")


# ---------------------------------------------------------------- после визита

@router.message(Command("visit"))
async def admin_visit(m: Message, command: CommandObject, bot: Bot):
    if m.from_user.id != ADMIN_ID:
        return
    b = DB["bookings"].get((command.args or "").strip())
    if not b:
        await m.answer("Укажите номер записи: /visit 5")
        return
    b["status"] = "done"
    save()
    await mascot_to(
        bot, b["user_id"], "thanks.png",
        f"<b>Благодарим вас за визит!</b> 🙏\n\n{b['name']}, надеюсь, вам понравился маникюр 💅\n"
        "Оцените, пожалуйста, нашу работу:",
        ikb([[("⭐" * i, f"rate:{i}") for i in range(1, 4)],
             [("⭐" * i, f"rate:{i}") for i in range(4, 6)]]),
    )
    await m.answer("Благодарность отправлена клиенту ✅")


@router.callback_query(F.data.startswith("rate:"))
async def rate(c: CallbackQuery, bot: Bot):
    stars = int(c.data.split(":")[1])
    await c.message.edit_reply_markup(reply_markup=None)
    if stars >= 4:
        text = "Ура, спасибо! 🥰 Ждём вас снова — запишитесь заранее, чтобы занять удобное время."
    else:
        text = "Спасибо за честность 🙏 Мы обязательно станем лучше. Напишите, что не понравилось, через «💬 Спросить Машу»."
    await c.message.answer(text, reply_markup=MAIN_KB)
    await c.answer()
    if ADMIN_ID:
        await bot.send_message(ADMIN_ID, f"⭐ Оценка от {c.from_user.full_name}: {stars}/5")


# ---------------------------------------------------------------- напоминания

async def reminder_loop(bot: Bot):
    """Раз в 10 минут: напоминает о записи на завтра."""
    while True:
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        changed = False
        for bid, b in DB["bookings"].items():
            if b["status"] == "active" and b["date"] == tomorrow and not b["reminded"]:
                try:
                    await mascot_to(
                        bot, b["user_id"], "booked.png",
                        f"Напоминаю: завтра в {b['time']} вы записаны на маникюр 💅\n"
                        f"{SERVICES[b['service']][0]}\n📍 {ADDRESS}\n\nЖду вас! — {MASCOT}",
                    )
                except Exception as e:
                    logging.warning("Не удалось напомнить %s: %s", bid, e)
                b["reminded"] = True
                changed = True
        if changed:
            save()
        await asyncio.sleep(600)


@router.message()
async def fallback(m: Message):
    await m.answer("Выберите пункт меню 👇", reply_markup=MAIN_KB)


async def main():
    from aiogram.client.default import DefaultBotProperties
    from aiogram.enums import ParseMode

    logging.basicConfig(level=logging.INFO)
    bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.include_router(router)
    asyncio.create_task(reminder_loop(bot))
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
