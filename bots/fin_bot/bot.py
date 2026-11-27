"""
Финансовый консультант — Telegram-бот.

Что умеет:
  • 🔔 Напоминать о предстоящих платежах (кредит, коммуналка, подписки):
       «За сколько напомнить?» → «Как часто?» → «Напишите дату» → «Как назвать платёж?»
  • 🎂 Напоминать о днях рождения близких (чтобы заранее отложить деньги на подарок)
  • 🛡 Напоминать о продлении страховки
  • 💸 Вести учёт расходов по категориям и показывать итог за месяц
  • 📊 Считать бюджет по правилу 50/30/20 и давать советы
  • 📋 Показывать и удалять свои напоминания

Запуск:
  pip install -r requirements.txt
  export BOT_TOKEN="токен_от_BotFather"      (Windows: set BOT_TOKEN=...)
  python bot.py
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
)

BOT_TOKEN = os.getenv("BOT_TOKEN", "ВСТАВЬТЕ_СЮДА_ТОКЕН")
DATA_FILE = Path(__file__).with_name("fin_data.json")

router = Router()

# ---------------------------------------------------------------- хранилище

def load_data() -> dict:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return {}


def save_data(data: dict) -> None:
    DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


DATA = load_data()


def user(uid: int) -> dict:
    u = DATA.setdefault(str(uid), {})
    u.setdefault("reminders", [])
    u.setdefault("expenses", [])
    return u


# ---------------------------------------------------------------- клавиатуры

MAIN_KB = ReplyKeyboardMarkup(
    resize_keyboard=True,
    keyboard=[
        [KeyboardButton(text="🔔 Напомнить о платеже"), KeyboardButton(text="🎂 Дни рождения близких")],
        [KeyboardButton(text="🛡 Страховка"), KeyboardButton(text="💸 Учёт расходов")],
        [KeyboardButton(text="📊 Бюджет 50/30/20"), KeyboardButton(text="📋 Мои напоминания")],
    ],
)


def ikb(rows: list[list[tuple[str, str]]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=t, callback_data=d) for t, d in row] for row in rows]
    )


KIND_TITLES = {"pay": "платёж", "bday": "день рождения", "ins": "страховка"}

ADVANCE_KB = ikb([
    [("В тот же день", "adv:0"), ("За 1 день", "adv:1")],
    [("За 3 дня", "adv:3"), ("За неделю", "adv:7")],
])

REPEAT = {
    "once": "Один раз",
    "month": "Ежемесячно",
    "3month": "Каждые три месяца",
    "6month": "Каждые полгода",
    "year": "Ежегодно",
}


def repeat_kb(kind: str) -> InlineKeyboardMarkup:
    if kind == "bday":
        return ikb([[("Ежегодно", "rep:year")]])
    if kind == "ins":
        return ikb([[("Каждый месяц", "rep:month"), ("Каждые полгода", "rep:6month")],
                    [("Раз в год", "rep:year")]])
    return ikb([[("Один раз", "rep:once"), ("Ежемесячно", "rep:month")],
                [("Каждые три месяца", "rep:3month"), ("Ежегодно", "rep:year")]])


EXP_CATEGORIES = ["🍔 Еда", "🏠 Жильё", "🚌 Транспорт", "🎉 Развлечения", "👕 Одежда", "💊 Здоровье", "📦 Другое"]
EXP_KB = ikb([
    [(c, f"cat:{i}") for i, c in enumerate(EXP_CATEGORIES[:3])],
    [(c, f"cat:{i}") for i, c in enumerate(EXP_CATEGORIES[3:6], start=3)],
    [(EXP_CATEGORIES[6], "cat:6")],
])

# ---------------------------------------------------------------- состояния

class Remind(StatesGroup):
    advance = State()
    repeat = State()
    date = State()
    title = State()


class Expense(StatesGroup):
    amount = State()


class Budget(StatesGroup):
    income = State()


# ---------------------------------------------------------------- утилиты дат

def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    days_in_month = [31, 29 if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else 28,
                     31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return date(y, m, min(d.day, days_in_month))


STEP = {"month": 1, "3month": 3, "6month": 6, "year": 12}


def next_due(d: date, repeat: str) -> date | None:
    return None if repeat == "once" else add_months(d, STEP[repeat])


def parse_date(text: str) -> date | None:
    for fmt in ("%d.%m.%Y", "%d.%m.%y", "%d.%m"):
        try:
            d = datetime.strptime(text.strip(), fmt).date()
            if fmt == "%d.%m":
                d = d.replace(year=date.today().year)
                if d < date.today():
                    d = d.replace(year=d.year + 1)
            return d
        except ValueError:
            continue
    return None


def fmt_money(x: float) -> str:
    return f"{x:,.0f} ₽".replace(",", " ")


# ---------------------------------------------------------------- старт

@router.message(CommandStart())
@router.message(F.text == "Начать работу")
async def start(m: Message, state: FSMContext):
    await state.clear()
    user(m.from_user.id)
    save_data(DATA)
    await m.answer(
        f"Добрый день, {m.from_user.first_name}! 👋\n"
        "Я ваш <b>финансовый консультант</b>.\n\n"
        "Я напомню о платежах, днях рождения близких и страховке, "
        "помогу вести учёт расходов и распределить бюджет.\n\n"
        "<b>Что вас интересует?</b>",
        reply_markup=MAIN_KB,
    )


@router.message(Command("help"))
async def help_cmd(m: Message):
    await m.answer(
        "/start — главное меню\n"
        "/cancel — отменить текущее действие\n"
        "/help — помощь\n\nПросто нажимайте кнопки меню 👇",
        reply_markup=MAIN_KB,
    )


@router.message(Command("cancel"))
async def cancel(m: Message, state: FSMContext):
    await state.clear()
    await m.answer("Отменено. Что вас интересует?", reply_markup=MAIN_KB)


# ---------------------------------------------------------------- напоминания

async def begin_reminder(m: Message, state: FSMContext, kind: str, intro: str):
    await state.clear()
    await state.update_data(kind=kind)
    await state.set_state(Remind.advance)
    await m.answer(f"{intro}\n\n<b>За сколько напомнить?</b>", reply_markup=ADVANCE_KB)


@router.message(F.text == "🔔 Напомнить о платеже")
async def r_pay(m: Message, state: FSMContext):
    await begin_reminder(m, state, "pay", "Хорошо! Напомню о предстоящем платеже 💳")


@router.message(F.text == "🎂 Дни рождения близких")
async def r_bday(m: Message, state: FSMContext):
    await begin_reminder(m, state, "bday",
                         "Напомню о дне рождения заранее, чтобы вы успели отложить деньги на подарок 🎁")


@router.message(F.text == "🛡 Страховка")
async def r_ins(m: Message, state: FSMContext):
    await begin_reminder(m, state, "ins", "Напомню о продлении или оплате страховки 🛡")


@router.callback_query(Remind.advance, F.data.startswith("adv:"))
async def r_advance(c: CallbackQuery, state: FSMContext):
    await state.update_data(advance=int(c.data.split(":")[1]))
    data = await state.get_data()
    await state.set_state(Remind.repeat)
    await c.message.edit_text("<b>Как часто напоминать?</b>", reply_markup=repeat_kb(data["kind"]))
    await c.answer()


@router.callback_query(Remind.repeat, F.data.startswith("rep:"))
async def r_repeat(c: CallbackQuery, state: FSMContext):
    await state.update_data(repeat=c.data.split(":")[1])
    data = await state.get_data()
    await state.set_state(Remind.date)
    what = "день рождения" if data["kind"] == "bday" else "дату платежа"
    await c.message.edit_text(f"<b>Напишите {what}</b> в формате ДД.ММ.ГГГГ (или просто ДД.ММ)\n"
                              "Например: 25.12.2026")
    await c.answer()


@router.message(Remind.date)
async def r_date(m: Message, state: FSMContext):
    d = parse_date(m.text or "")
    if not d:
        await m.answer("Не понял дату 🤔 Напишите, пожалуйста, так: 25.12.2026")
        return
    data = await state.get_data()
    # для повторяющихся — сдвигаем дату в будущее
    while d < date.today() and data["repeat"] != "once":
        d = next_due(d, data["repeat"])
    if d < date.today():
        await m.answer("Эта дата уже прошла. Напишите будущую дату:")
        return
    await state.update_data(due=d.isoformat())
    await state.set_state(Remind.title)
    question = {
        "pay": "Как назвать платёж? Например: «Кредит Сбер 12 500 ₽» или «Коммуналка»",
        "bday": "Чей день рождения? Например: «Мама» или «Друг Паша»",
        "ins": "Что за страховка? Например: «ОСАГО» или «Страховка квартиры»",
    }[data["kind"]]
    await m.answer(question)


@router.message(Remind.title)
async def r_title(m: Message, state: FSMContext):
    data = await state.get_data()
    rem = {
        "id": uuid.uuid4().hex[:8],
        "kind": data["kind"],
        "title": (m.text or "").strip()[:100],
        "due": data["due"],
        "advance": data["advance"],
        "repeat": data["repeat"],
        "notified_for": None,
    }
    user(m.from_user.id)["reminders"].append(rem)
    save_data(DATA)
    await state.clear()
    due = date.fromisoformat(rem["due"])
    adv = "в тот же день" if rem["advance"] == 0 else f"за {rem['advance']} дн."
    await m.answer(
        "✅ <b>Готово! Напоминание сохранено.</b>\n\n"
        f"📌 {rem['title']}\n"
        f"📅 Дата: {due:%d.%m.%Y}\n"
        f"⏰ Напомню: {adv}\n"
        f"🔁 Повтор: {REPEAT[rem['repeat']]}",
        reply_markup=MAIN_KB,
    )


@router.message(F.text == "📋 Мои напоминания")
async def r_list(m: Message):
    rems = sorted(user(m.from_user.id)["reminders"], key=lambda r: r["due"])
    if not rems:
        await m.answer("У вас пока нет напоминаний. Нажмите «🔔 Напомнить о платеже», чтобы добавить.")
        return
    icons = {"pay": "💳", "bday": "🎂", "ins": "🛡"}
    lines, rows = [], []
    for i, r in enumerate(rems, 1):
        lines.append(f"{i}. {icons[r['kind']]} {r['title']} — {date.fromisoformat(r['due']):%d.%m.%Y} "
                     f"({REPEAT[r['repeat']].lower()})")
        rows.append([(f"🗑 Удалить {i}", f"del:{r['id']}")])
    await m.answer("<b>Ваши напоминания:</b>\n\n" + "\n".join(lines), reply_markup=ikb(rows))


@router.callback_query(F.data.startswith("del:"))
async def r_delete(c: CallbackQuery):
    rid = c.data.split(":")[1]
    u = user(c.from_user.id)
    u["reminders"] = [r for r in u["reminders"] if r["id"] != rid]
    save_data(DATA)
    await c.answer("Удалено")
    await c.message.edit_text("Напоминание удалено ✅ Откройте «📋 Мои напоминания», чтобы увидеть список.")


async def reminder_loop(bot: Bot):
    """Раз в минуту проверяет, кому пора отправить напоминание."""
    while True:
        today = date.today()
        changed = False
        for uid, u in DATA.items():
            for r in list(u.get("reminders", [])):
                due = date.fromisoformat(r["due"])
                notify_day = due - timedelta(days=r["advance"])
                if today >= notify_day and r.get("notified_for") != r["due"]:
                    days_left = (due - today).days
                    when = "сегодня" if days_left <= 0 else f"через {days_left} дн. ({due:%d.%m})"
                    text = {
                        "pay": f"🔔 <b>Напоминание о платеже</b>\n«{r['title']}» — {when}.\n"
                               "Проверьте, что на карте достаточно денег 💳",
                        "bday": f"🎂 <b>День рождения</b>\n{r['title']} — {when}.\n"
                                "Не забудьте отложить деньги на подарок 🎁",
                        "ins": f"🛡 <b>Страховка</b>\n«{r['title']}» — {when}.\n"
                               "Пора оплатить или продлить полис.",
                    }[r["kind"]]
                    try:
                        await bot.send_message(int(uid), text)
                    except Exception as e:  # пользователь заблокировал бота и т.п.
                        logging.warning("Не удалось отправить %s: %s", uid, e)
                    r["notified_for"] = r["due"]
                    changed = True
                # дата прошла — переносим повторяющееся или удаляем разовое
                if today > due:
                    nd = next_due(due, r["repeat"])
                    if nd:
                        r["due"] = nd.isoformat()
                    else:
                        u["reminders"].remove(r)
                    changed = True
        if changed:
            save_data(DATA)
        await asyncio.sleep(60)


# ---------------------------------------------------------------- расходы

@router.message(F.text == "💸 Учёт расходов")
async def exp_menu(m: Message, state: FSMContext):
    await state.clear()
    await m.answer("<b>Учёт расходов.</b> Что сделать?", reply_markup=ikb([
        [("➕ Добавить расход", "exp:add")],
        [("📈 Итоги за месяц", "exp:stats")],
        [("🧹 Очистить расходы", "exp:clear")],
    ]))


@router.callback_query(F.data == "exp:add")
async def exp_add(c: CallbackQuery):
    await c.message.edit_text("<b>Выберите категорию:</b>", reply_markup=EXP_KB)
    await c.answer()


@router.callback_query(F.data.startswith("cat:"))
async def exp_cat(c: CallbackQuery, state: FSMContext):
    cat = EXP_CATEGORIES[int(c.data.split(":")[1])]
    await state.update_data(cat=cat)
    await state.set_state(Expense.amount)
    await c.message.edit_text(f"{cat}\n<b>Напишите сумму</b> в рублях, например: 450")
    await c.answer()


@router.message(Expense.amount)
async def exp_amount(m: Message, state: FSMContext):
    try:
        amount = float((m.text or "").replace(" ", "").replace(",", "."))
        assert amount > 0
    except (ValueError, AssertionError):
        await m.answer("Нужна сумма числом, например: 450")
        return
    data = await state.get_data()
    user(m.from_user.id)["expenses"].append(
        {"cat": data["cat"], "amount": amount, "date": date.today().isoformat()})
    save_data(DATA)
    await state.clear()
    await m.answer(f"✅ Записал: {data['cat']} — {fmt_money(amount)}", reply_markup=ikb([
        [("➕ Ещё расход", "exp:add"), ("📈 Итоги", "exp:stats")],
    ]))


@router.callback_query(F.data == "exp:stats")
async def exp_stats(c: CallbackQuery):
    month = date.today().strftime("%Y-%m")
    items = [e for e in user(c.from_user.id)["expenses"] if e["date"].startswith(month)]
    if not items:
        await c.message.edit_text("В этом месяце расходов пока нет.")
        await c.answer()
        return
    by_cat: dict[str, float] = {}
    for e in items:
        by_cat[e["cat"]] = by_cat.get(e["cat"], 0) + e["amount"]
    total = sum(by_cat.values())
    lines = [f"{cat}: {fmt_money(s)} ({s / total:.0%})" for cat, s in sorted(by_cat.items(), key=lambda x: -x[1])]
    top = max(by_cat, key=by_cat.get)
    await c.message.edit_text(
        f"<b>Расходы за {date.today():%m.%Y}</b>\n\n" + "\n".join(lines) +
        f"\n\n<b>Всего: {fmt_money(total)}</b>\n\n💡 Больше всего уходит на «{top}». "
        "Попробуйте установить лимит на эту категорию."
    )
    await c.answer()


@router.callback_query(F.data == "exp:clear")
async def exp_clear(c: CallbackQuery):
    user(c.from_user.id)["expenses"] = []
    save_data(DATA)
    await c.message.edit_text("Все расходы удалены 🧹")
    await c.answer()


# ---------------------------------------------------------------- бюджет

@router.message(F.text == "📊 Бюджет 50/30/20")
async def budget(m: Message, state: FSMContext):
    await state.set_state(Budget.income)
    await m.answer("Правило <b>50/30/20</b>: 50% дохода — на необходимое, 30% — на желания, "
                   "20% — в накопления.\n\n<b>Напишите ваш доход за месяц</b>, например: 60000")


@router.message(Budget.income)
async def budget_income(m: Message, state: FSMContext):
    try:
        inc = float((m.text or "").replace(" ", "").replace(",", "."))
        assert inc > 0
    except (ValueError, AssertionError):
        await m.answer("Напишите доход числом, например: 60000")
        return
    await state.clear()
    await m.answer(
        f"Ваш доход: <b>{fmt_money(inc)}</b>\n\n"
        f"🏠 Необходимое (жильё, еда, транспорт, кредиты): <b>{fmt_money(inc * 0.5)}</b>\n"
        f"🎉 Желания (кафе, хобби, покупки): <b>{fmt_money(inc * 0.3)}</b>\n"
        f"🏦 Накопления и подушка безопасности: <b>{fmt_money(inc * 0.2)}</b>\n\n"
        f"💡 Подушка безопасности = 3–6 месячных расходов, то есть примерно "
        f"{fmt_money(inc * 0.8 * 3)} – {fmt_money(inc * 0.8 * 6)}.\n"
        f"Откладывая 20%, вы соберёте её за {int(3 * 0.8 / 0.2)}–{int(6 * 0.8 / 0.2)} месяцев.",
        reply_markup=MAIN_KB,
    )


@router.message()
async def fallback(m: Message):
    await m.answer("Выберите, пожалуйста, пункт меню 👇", reply_markup=MAIN_KB)


# ---------------------------------------------------------------- запуск

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
