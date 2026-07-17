/* ============================================================
   Облачный режим MakeDay CRM (Firebase).

   - Вход/регистрация по email и паролю (Firebase Auth).
   - Новый сотрудник после регистрации ждёт одобрения администратора.
   - Общая база: коллекции clients / deals / campaigns в Firestore,
     живая синхронизация между всеми устройствами команды.
   - Права доступа проверяет сервер по правилам из firestore.rules.
   ============================================================ */
'use strict';

const Cloud = (() => {
  const SDK_FILES = [
    'js/vendor/firebase-app-compat.js',
    'js/vendor/firebase-auth-compat.js',
    'js/vendor/firebase-firestore-compat.js',
  ];
  const KINDS = ['clients', 'deals', 'campaigns'];

  let db = null, auth = null;
  let active = false;
  let handlers = null;               // { onReady, applyRemote }
  let ready = false;
  let docs = { clients: {}, deals: {}, campaigns: {} }; // id -> данные
  let mirror = { clients: {}, deals: {}, campaigns: {} }; // id -> JSON (что уже в облаке)
  let metaExists = false;
  let unsubscribers = [];

  const isConfigured = () => !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);
  const adminEmail = () => (window.CRM_ADMIN_EMAIL || '').toLowerCase();
  const isAdminUser = u => !!u && (u.email || '').toLowerCase() === adminEmail();

  /* ---------- загрузка SDK (пропускается, если firebase уже есть) ---------- */
  function loadSdk() {
    if (typeof firebase !== 'undefined') return Promise.resolve();
    return SDK_FILES.reduce((p, src) => p.then(() => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('SDK load failed: ' + src));
      document.head.appendChild(s);
    })), Promise.resolve());
  }

  /* ---------- экраны ---------- */
  const ERRORS = {
    'auth/invalid-email': 'Некорректный email',
    'auth/email-already-in-use': 'Такой email уже зарегистрирован — войдите',
    'auth/weak-password': 'Пароль слишком простой (минимум 6 символов)',
    'auth/invalid-credential': 'Неверный email или пароль',
    'auth/wrong-password': 'Неверный email или пароль',
    'auth/user-not-found': 'Такой пользователь не найден — зарегистрируйтесь',
    'auth/too-many-requests': 'Слишком много попыток, подождите пару минут',
    'auth/network-request-failed': 'Нет соединения с интернетом',
  };
  const errText = e => ERRORS[e && e.code] || 'Ошибка: ' + (e && e.message || e);

  function screen(html) {
    document.getElementById('lock-root').innerHTML =
      `<div class="lock-overlay"><div class="lock-card">${html}</div></div>`;
  }
  function hideScreen() { document.getElementById('lock-root').innerHTML = ''; }

  function showAuthScreen(mode, msg) {
    screen(`
      <div class="lock-logo">🎉</div>
      <h1>MakeDay CRM</h1>
      <p class="lock-sub">Общая база команды.<br>${mode === 'reg' ? 'Регистрация нового сотрудника.' : 'Войдите со своим email и паролем.'}</p>
      <div class="btn-row" style="justify-content:center;margin-bottom:14px">
        <button class="btn btn-sm ${mode === 'login' ? 'btn-primary' : ''}" id="cl-tab-login">Вход</button>
        <button class="btn btn-sm ${mode === 'reg' ? 'btn-primary' : ''}" id="cl-tab-reg">Регистрация</button>
      </div>
      ${msg ? `<div class="lock-error">${msg}</div>` : ''}
      <form id="cl-form" class="form-grid">
        ${mode === 'reg' ? `
        <div class="field"><label>Ваше имя</label>
          <input id="cl-name" type="text" required autocomplete="name" placeholder="Например: Таня"></div>` : ''}
        <div class="field"><label>Email</label>
          <input id="cl-email" type="email" required autocomplete="email" placeholder="you@mail.ru"></div>
        <div class="field"><label>Пароль</label>
          <input id="cl-pass" type="password" required minlength="6" autocomplete="${mode === 'reg' ? 'new-password' : 'current-password'}"></div>
        <button class="btn btn-primary" style="justify-content:center;padding:13px" type="submit">
          ${mode === 'reg' ? '📝 Зарегистрироваться' : '🔓 Войти'}</button>
      </form>
      ${mode === 'login' ? '<button class="lock-reset" id="cl-forgot">Забыли пароль?</button>' : ''}`);

    document.getElementById('cl-tab-login').onclick = () => showAuthScreen('login');
    document.getElementById('cl-tab-reg').onclick = () => showAuthScreen('reg');
    const forgot = document.getElementById('cl-forgot');
    if (forgot) forgot.onclick = async () => {
      const email = document.getElementById('cl-email').value.trim();
      if (!email) { showAuthScreen('login', 'Сначала введите email, затем нажмите «Забыли пароль?»'); return; }
      try {
        await auth.sendPasswordResetEmail(email);
        showAuthScreen('login', '📧 Письмо для смены пароля отправлено на ' + email);
      } catch (e) { showAuthScreen('login', errText(e)); }
    };
    document.getElementById('cl-form').onsubmit = async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = '…';
      const email = document.getElementById('cl-email').value.trim();
      const pass = document.getElementById('cl-pass').value;
      try {
        if (mode === 'reg') {
          const name = document.getElementById('cl-name').value.trim();
          const cred = await auth.createUserWithEmailAndPassword(email, pass);
          await db.collection('users').doc(cred.user.uid).set({
            email, name, approved: isAdminUser(cred.user), createdAt: Date.now(),
          });
        } else {
          await auth.signInWithEmailAndPassword(email, pass);
        }
        // дальше сработает onAuthStateChanged
      } catch (err) {
        showAuthScreen(mode, errText(err));
      }
    };
  }

  function showPendingScreen(user) {
    screen(`
      <div class="lock-logo">⏳</div>
      <h1>Ждём одобрения</h1>
      <p class="lock-sub">Аккаунт <b>${user.email}</b> создан.<br>
      Попросите Влада открыть CRM → Настройки → «Команда» и одобрить вас.<br>
      Эта страница обновится автоматически.</p>
      <button class="btn" id="cl-pending-logout">Выйти</button>`);
    document.getElementById('cl-pending-logout').onclick = () => logout();
    // как только одобрят — продолжаем
    const un = db.collection('users').doc(user.uid).onSnapshot(snap => {
      if (snap.exists && snap.data().approved) { un(); location.reload(); }
    }, () => {});
  }

  function showErrorScreen(message) {
    screen(`
      <div class="lock-logo">⚠️</div>
      <h1>Нет соединения</h1>
      <p class="lock-sub">${message}</p>
      <button class="btn btn-primary" onclick="location.reload()">Повторить</button>`);
  }

  /* ---------- синхронизация данных ---------- */
  function startSync(onFirstLoad) {
    let loadedKinds = 0;
    let firstDone = false;

    for (const kind of KINDS) {
      const un = db.collection(kind).onSnapshot(snap => {
        snap.docChanges().forEach(ch => {
          const id = ch.doc.id;
          if (ch.type === 'removed') { delete docs[kind][id]; delete mirror[kind][id]; }
          else { docs[kind][id] = ch.doc.data(); mirror[kind][id] = JSON.stringify(ch.doc.data()); }
        });
        if (!firstDone) {
          loadedKinds++;
          if (loadedKinds === KINDS.length + 1) { firstDone = true; onFirstLoad(); }
        } else if (handlers.applyRemote) {
          handlers.applyRemote(currentData());
        }
      }, err => {
        console.error('sync error', err);
        if (!firstDone) { firstDone = true; showErrorScreen('Не удалось загрузить базу: ' + errText(err)); }
      });
      unsubscribers.push(un);
    }
    const unMeta = db.collection('meta').doc('state').onSnapshot(snap => {
      metaExists = metaExists || snap.exists;
      if (!firstDone) {
        loadedKinds++;
        if (loadedKinds === KINDS.length + 1) { firstDone = true; onFirstLoad(); }
      }
    }, () => {});
    unsubscribers.push(unMeta);
  }

  function currentData() {
    return {
      clients: Object.values(docs.clients),
      deals: Object.values(docs.deals),
      campaigns: Object.values(docs.campaigns).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    };
  }

  /* отправка изменений: пишем только то, что реально поменялось */
  function persist(stateObj) {
    if (!active || !db) return;
    const writes = [];
    for (const kind of KINDS) {
      const arr = stateObj[kind] || [];
      const seen = new Set();
      for (const item of arr) {
        if (!item || !item.id) continue;
        seen.add(item.id);
        const json = JSON.stringify(item);
        if (mirror[kind][item.id] !== json) {
          mirror[kind][item.id] = json;
          docs[kind][item.id] = JSON.parse(json);
          writes.push({ op: 'set', kind, id: item.id, data: JSON.parse(json) });
        }
      }
      for (const id of Object.keys(mirror[kind])) {
        if (!seen.has(id)) {
          delete mirror[kind][id];
          delete docs[kind][id];
          writes.push({ op: 'del', kind, id });
        }
      }
    }
    if (!metaExists) { writes.push({ op: 'set', kind: 'meta', id: 'state', data: { seeded: true } }); metaExists = true; }
    if (!writes.length) return;

    // батчами по 400 (лимит Firestore — 500)
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      for (const w of writes.slice(i, i + 400)) {
        const ref = db.collection(w.kind).doc(w.id);
        if (w.op === 'set') batch.set(ref, w.data);
        else batch.delete(ref);
      }
      batch.commit().catch(e => {
        console.error('save failed', e);
        if (typeof toast === 'function') toast('⚠️ Не удалось сохранить в облако: ' + errText(e), 'error');
      });
    }
    // черновик рассылки — локально, не в облаке
    try { localStorage.setItem('makeday_campaign_draft', JSON.stringify(stateObj.activeCampaign || null)); } catch {}
  }

  /* ---------- команда (для администратора) ---------- */
  function renderTeam() {
    const card = document.getElementById('team-card');
    if (!card) return;
    if (!active || !isAdminUser(auth.currentUser)) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const un = db.collection('users').onSnapshot(snap => {
      const rows = [];
      snap.forEach(d => rows.push({ uid: d.id, ...d.data() }));
      rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      document.getElementById('team-list').innerHTML = rows.map(u => `
        <div class="list-item" style="cursor:default">
          <div class="li-emoji">${u.approved ? '✅' : '⏳'}</div>
          <div class="li-body">
            <div class="li-title">${(u.name || '—').replace(/</g, '&lt;')}${(u.email || '').toLowerCase() === adminEmail() ? ' 👑' : ''}</div>
            <div class="li-sub">${(u.email || '').replace(/</g, '&lt;')} · ${u.approved ? 'доступ открыт' : 'ждёт одобрения'}</div>
          </div>
          <div class="li-right">
            ${(u.email || '').toLowerCase() === adminEmail() ? '' : (u.approved
              ? `<button class="btn btn-sm" data-team-off="${u.uid}">Отключить</button>`
              : `<button class="btn btn-sm btn-primary" data-team-on="${u.uid}">Одобрить</button>`)}
          </div>
        </div>`).join('') || '<div class="list-empty">Пока только вы.</div>';
      document.querySelectorAll('[data-team-on]').forEach(b => b.onclick = () =>
        db.collection('users').doc(b.dataset.teamOn).update({ approved: true }));
      document.querySelectorAll('[data-team-off]').forEach(b => b.onclick = () => {
        if (confirm('Закрыть этому сотруднику доступ к CRM?'))
          db.collection('users').doc(b.dataset.teamOff).update({ approved: false });
      });
    }, e => console.warn('team list error', e));
    unsubscribers.push(un);
  }

  /* ---------- вход в приложение ---------- */
  function begin(h) {
    handlers = h;
    loadSdk().then(() => {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      try { db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch {}

      auth.onAuthStateChanged(async user => {
        if (!user) { showAuthScreen('login'); return; }
        try {
          const uref = db.collection('users').doc(user.uid);
          let udoc = await uref.get();
          if (!udoc.exists) {
            await uref.set({
              email: user.email, name: user.displayName || '',
              approved: isAdminUser(user), createdAt: Date.now(),
            });
            udoc = await uref.get();
          }
          const approved = isAdminUser(user) || (udoc.exists && udoc.data().approved === true);
          if (!approved) { showPendingScreen(user); return; }

          active = true;
          startSync(() => {
            hideScreen();
            const data = currentData();
            let draft = null;
            try { draft = JSON.parse(localStorage.getItem('makeday_campaign_draft')); } catch {}
            const loaded = metaExists
              ? { ...data, seeded: true, activeCampaign: draft }
              : null; // база пуста — приложение создаст стартовые данные
            handlers.onReady(loaded);
            renderTeam();
          });
        } catch (e) {
          console.error(e);
          showErrorScreen(errText(e));
        }
      });
    }).catch(e => {
      console.error(e);
      showErrorScreen('Не загрузились файлы Firebase. Проверьте интернет и обновите страницу.');
    });
  }

  function logout() {
    unsubscribers.forEach(u => { try { u(); } catch {} });
    unsubscribers = [];
    active = false;
    (auth ? auth.signOut() : Promise.resolve()).finally(() => location.reload());
  }

  async function resetPassword() {
    if (!auth || !auth.currentUser) return;
    await auth.sendPasswordResetEmail(auth.currentUser.email);
  }

  return {
    isConfigured, begin, persist, logout, resetPassword,
    active: () => active,
    userEmail: () => (auth && auth.currentUser ? auth.currentUser.email : ''),
  };
})();
