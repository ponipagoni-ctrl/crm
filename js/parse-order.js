/* ============================================================
   Разбор текста заказа из Google Календаря.
   Понимает формат Влада: «Чебурашка 4500 Виталий 89536004621 девочке 9»
   Используется и в браузере (импорт .ics), и в Node (генерация базы).
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OrderParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SERVICE_KEYWORDS = [
    { service: 'dm',     re: /дед\s*мороз|снегурочк/i },
    { service: 'doll',   re: /мишк|медвед|панд|чебурашк|горилл|ростов/i },
    { service: 'foam',   re: /пен(?:а|ы|у|ой|ная)(?![а-яё])|бочк/i },
    { service: 'cotton', re: /(?:^|[^а-яё])ват(?:а|ы|у|ой)(?![а-яё])|сахарн/i },
    { service: 'other',  re: /фокус|аниматор|робот|шарик|челлендж|квест/i },
  ];

  // частые русские/СНГ имена (в нижнем регистре)
  const NAMES = new Set(('александр,александра,алексей,алёна,алена,алина,алиса,алла,анастасия,анатолий,ангелина,андрей,анна,антон,'
    + 'арина,артём,артем,артур,валентина,валерий,валерия,варвара,василий,вероника,виктор,виктория,виталий,влад,владимир,'
    + 'владислав,всеволод,вячеслав,галина,гульнара,даниил,данил,дарья,денис,диана,дмитрий,ева,евгений,евгения,егор,екатерина,'
    + 'елена,елизавета,жанна,иван,игорь,илья,инна,ирина,карина,каролина,кира,кирилл,константин,кристина,ксения,лариса,'
    + 'лев,лидия,лилия,лиля,любовь,людмила,майя,маргарита,марина,мария,марк,матвей,милана,мила,михаил,надежда,наталья,наталия,'
    + 'ника,никита,николай,нина,оксана,олег,ольга,ованес,павел,полина,раиса,регина,роман,руслан,светлана,семён,семен,сергей,'
    + 'снежана,софия,софья,станислав,степан,таисия,тамара,татьяна,тимофей,тимур,ульяна,фёдор,федор,эльвира,эмилия,юлия,юрий,'
    + 'яна,ярослав,газан,хабиб,динара,айгуль,венера,розалия,эльза,расул,рустам,марат,дамир,ильдар,альбина,лейла,зарина')
    .split(',').map(s => s.trim()).filter(Boolean));

  const PHONE_RE = /(?:\+?7|8)?[\s\-–—.()]*(9\d{2})[\s\-–—.()]*(\d{3})[\s\-–—.()]*(\d{2})[\s\-–—.()]*(\d{2})/g;

  function extractPhones(text) {
    const phones = [];
    let m;
    PHONE_RE.lastIndex = 0;
    while ((m = PHONE_RE.exec(text)) !== null) {
      phones.push('+7' + m[1] + m[2] + m[3] + m[4]);
    }
    return [...new Set(phones)];
  }
  function stripPhones(text) { return text.replace(PHONE_RE, ' '); }

  function detectService(text) {
    for (const k of SERVICE_KEYWORDS) if (k.re.test(text)) return k.service;
    return '';
  }

  function extractPrice(textNoPhones) {
    const nums = (textNoPhones.match(/\d{3,6}/g) || []).map(Number)
      .filter(n => n >= 900 && n <= 300000);
    return nums.length ? Math.max(...nums) : 0;
  }
  function extractPrepaid(textNoPhones) {
    const m = textNoPhones.match(/предоплат\w*\D{0,5}(\d{3,6})/i);
    return m ? Number(m[1]) : 0;
  }

  function extractName(textNoPhones) {
    const words = textNoPhones.split(/[^А-Яа-яЁё]+/).filter(w => w.length >= 3);
    for (const w of words) {
      const lw = w.toLowerCase();
      if (NAMES.has(lw)) return w[0].toUpperCase() + lw.slice(1);
      // падежи: Ольге → Ольга, Марии → Мария, Милане → Милана
      if (lw.length > 3) {
        const base = lw.slice(0, -1);
        for (const end of ['а', 'я']) {
          if (NAMES.has(base + end)) {
            const nm = base + end;
            return nm[0].toUpperCase() + nm.slice(1);
          }
        }
      }
    }
    return '';
  }

  // «девочке 9», «мальчику 4», «дочери 25», «женщине 50», «ребенку 3» → повод для праздника
  function extractOccasion(textNoPhones) {
    const m = textNoPhones.match(/(девочк|мальчик|девушк|женщин|мужчин|ребенк|ребёнк|сын|доч(?:ери|ке|ка|ь)?)[а-яё]*\s*[—\-–:]?\s*(\d{1,2})(?!\d)/i);
    if (!m) return null;
    const kind = m[1].toLowerCase();
    let who = 'ребёнка';
    if (kind.startsWith('девочк')) who = 'дочки';
    else if (kind.startsWith('мальчик')) who = 'сына';
    else if (kind.startsWith('сын')) who = 'сына';
    else if (kind.startsWith('доч')) who = 'дочки';
    else if (kind.startsWith('девушк')) who = 'девушки';
    else if (kind.startsWith('женщин')) who = 'юбиляра';
    else if (kind.startsWith('мужчин')) who = 'юбиляра';
    return { title: 'День рождения ' + who, age: Number(m[2]) };
  }

  function cleanTitle(summary) {
    return stripPhones(summary)
      .replace(/\s+/g, ' ')
      .replace(/\s([.,])/g, '$1')
      .trim()
      .slice(0, 80);
  }

  /* Главная функция: текст события → структура заказа */
  function parseOrderSummary(summary) {
    const text = String(summary || '');
    const noPhones = stripPhones(text);
    const service = detectService(text);
    const phones = extractPhones(text);
    const price = extractPrice(noPhones);
    return {
      service: service || 'other',
      hasServiceKeyword: !!service,
      phones,
      phone: phones[0] || '',
      price,
      prepaid: extractPrepaid(noPhones),
      name: extractName(noPhones),
      occasion: extractOccasion(noPhones),
      title: cleanTitle(text),
    };
  }

  /* Похоже ли событие календаря на заказ? */
  function looksLikeOrder(summary) {
    const p = parseOrderSummary(summary);
    return p.hasServiceKeyword || (p.phone && p.price > 0) || !!p.phone;
  }

  return { parseOrderSummary, looksLikeOrder, extractPhones, detectService };
});
