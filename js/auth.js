/* ============================================================
   Вход и шифрование MakeDay CRM.

   Как устроено:
   - Первый вход на устройстве: код доступа (выдаёт Влад) + свой пароль.
   - Все данные CRM шифруются паролем (AES-GCM, ключ через PBKDF2) —
     без пароля их не прочитать даже через инструменты разработчика.
   - Код доступа хранится в коде только в виде SHA-256 хеша.
   ============================================================ */
'use strict';

const Auth = (() => {
  // SHA-256 от кода доступа. Сменить код: node -e "console.log(require('crypto').createHash('sha256').update('НОВЫЙ_КОД').digest('hex'))"
  const INVITE_HASH = '353bcf7fa6decb1f80865142a68cf0acef90e647ae808c4c764515377bccf35f';

  const K = {
    meta: 'makeday_auth_v1',      // { salt }
    data: 'makeday_crm_enc_v1',   // { iv, ct }
    remember: 'makeday_key_v1',   // base64 ключа («запомнить меня»)
    session: 'makeday_key_session',
    legacy: 'makeday_crm_v1',     // старое нешифрованное хранилище
  };

  const subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  let cryptoKey = null;   // активный AES-ключ
  let pending = Promise.resolve(); // очередь записи

  /* ---------- утилиты ---------- */
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;

  async function sha256hex(str) {
    const h = await subtle.digest('SHA-256', enc.encode(str));
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function deriveKey(password, saltB64) {
    const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: unb64(saltB64), iterations: 150000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  async function encryptJSON(obj, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function decryptJSON(payload, key) {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(unb64(payload.iv)) }, key, unb64(payload.ct));
    return JSON.parse(dec.decode(pt));
  }
  async function exportKeyB64(key) { return b64(await subtle.exportKey('raw', key)); }
  async function importKeyB64(s) {
    return subtle.importKey('raw', unb64(s), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }
  const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

  /* ---------- хранение состояния CRM ---------- */
  function persist(stateObj) {
    if (!subtle || !cryptoKey) { // запасной режим без шифрования
      localStorage.setItem(K.legacy, JSON.stringify(stateObj));
      return;
    }
    const snapshot = JSON.parse(JSON.stringify(stateObj));
    pending = pending
      .then(() => encryptJSON(snapshot, cryptoKey))
      .then(payload => localStorage.setItem(K.data, JSON.stringify(payload)))
      .catch(e => console.error('persist failed', e));
  }

  /* ---------- экран блокировки ---------- */
  function lockHtml(mode, msg) {
    return `
    <div class="lock-overlay" id="lock-overlay">
      <div class="lock-card">
        <div class="lock-logo">🎉</div>
        <h1>MakeDay CRM</h1>
        <p class="lock-sub">${mode === 'setup'
          ? 'Первый вход на этом устройстве.<br>Введите код доступа и придумайте пароль.'
          : 'Введите пароль, чтобы открыть CRM.'}</p>
        ${msg ? `<div class="lock-error">${msg}</div>` : ''}
        <form id="lock-form" class="form-grid">
          ${mode === 'setup' ? `
          <div class="field"><label>Код доступа (спросите у Влада)</label>
            <input id="lk-invite" type="text" autocomplete="off" autocapitalize="characters" required></div>
          <div class="field"><label>Придумайте пароль</label>
            <input id="lk-pass" type="password" minlength="4" required autocomplete="new-password"></div>
          <div class="field"><label>Повторите пароль</label>
            <input id="lk-pass2" type="password" minlength="4" required autocomplete="new-password"></div>
          ` : `
          <div class="field"><label>Пароль</label>
            <input id="lk-pass" type="password" required autocomplete="current-password"></div>
          <label class="check-inline"><input type="checkbox" id="lk-remember"> запомнить меня на этом устройстве</label>
          `}
          <button class="btn btn-primary" style="justify-content:center;padding:13px" type="submit">
            ${mode === 'setup' ? '🚀 Начать работу' : '🔓 Войти'}</button>
        </form>
        ${mode === 'login' ? `<button class="lock-reset" id="lk-reset">Забыли пароль?</button>` : ''}
      </div>
    </div>`;
  }

  function showLock(mode, onDone, msg) {
    const root = document.getElementById('lock-root');
    root.innerHTML = lockHtml(mode, msg);
    const form = document.getElementById('lock-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = '…';
      try {
        if (mode === 'setup') await doSetup(onDone);
        else await doLogin(onDone);
      } catch (err) {
        console.warn(err);
        showLock(mode, onDone, mode === 'setup' ? 'Неверный код доступа' : 'Неверный пароль');
      }
    });
    const reset = document.getElementById('lk-reset');
    if (reset) reset.addEventListener('click', () => {
      if (!confirm('Сброс удалит все данные CRM на ЭТОМ устройстве (их можно будет восстановить из JSON-копии). Продолжить?')) return;
      if (!confirm('Точно удалить данные и настроить вход заново?')) return;
      [K.meta, K.data, K.remember, K.legacy].forEach(k => localStorage.removeItem(k));
      sessionStorage.removeItem(K.session);
      location.reload();
    });
    setTimeout(() => {
      const f = document.getElementById(mode === 'setup' ? 'lk-invite' : 'lk-pass');
      if (f) f.focus();
    }, 60);
  }

  function hideLock() { document.getElementById('lock-root').innerHTML = ''; }

  async function doSetup(onDone) {
    const invite = document.getElementById('lk-invite').value.trim().toUpperCase().replace(/[\s\-]/g, '');
    const p1 = document.getElementById('lk-pass').value;
    const p2 = document.getElementById('lk-pass2').value;
    if (await sha256hex(invite) !== INVITE_HASH) throw new Error('bad invite');
    if (p1 !== p2) { showLock('setup', onDone, 'Пароли не совпадают'); return; }
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    localStorage.setItem(K.meta, JSON.stringify({ salt }));
    cryptoKey = await deriveKey(p1, salt);
    sessionStorage.setItem(K.session, await exportKeyB64(cryptoKey));
    // забрать старые нешифрованные данные, если были
    const legacy = readJSON(K.legacy);
    const initial = legacy && Array.isArray(legacy.clients) ? legacy : null;
    if (initial) {
      localStorage.setItem(K.data, JSON.stringify(await encryptJSON(initial, cryptoKey)));
      localStorage.removeItem(K.legacy);
    }
    hideLock();
    onDone(initial);
  }

  async function doLogin(onDone) {
    const pass = document.getElementById('lk-pass').value;
    const remember = document.getElementById('lk-remember').checked;
    const meta = readJSON(K.meta);
    const key = await deriveKey(pass, meta.salt);
    const payload = readJSON(K.data);
    const stateObj = payload ? await decryptJSON(payload, key) : null; // бросит ошибку при неверном пароле
    cryptoKey = key;
    sessionStorage.setItem(K.session, await exportKeyB64(key));
    if (remember) localStorage.setItem(K.remember, await exportKeyB64(key));
    hideLock();
    onDone(stateObj);
  }

  /* ---------- вход в приложение ---------- */
  async function begin(onDone) {
    if (!subtle) { // очень старый браузер — работаем без шифрования
      console.warn('WebCrypto недоступен — данные хранятся без шифрования');
      onDone(readJSON(K.legacy));
      return;
    }
    const meta = readJSON(K.meta);
    if (meta) {
      // авторазблокировка по запомненному ключу
      const saved = sessionStorage.getItem(K.session) || localStorage.getItem(K.remember);
      if (saved) {
        try {
          const key = await importKeyB64(saved);
          const payload = readJSON(K.data);
          const stateObj = payload ? await decryptJSON(payload, key) : null;
          cryptoKey = key;
          onDone(stateObj);
          return;
        } catch (e) { console.warn('auto-unlock failed', e); }
      }
      showLock('login', onDone);
    } else {
      showLock('setup', onDone);
    }
  }

  function logout() {
    sessionStorage.removeItem(K.session);
    localStorage.removeItem(K.remember);
    // дождаться, пока допишутся отложенные шифрованные данные
    pending.then(() => location.reload()).catch(() => location.reload());
  }

  async function changePassword(current, next) {
    const meta = readJSON(K.meta);
    await decryptJSON(readJSON(K.data), await deriveKey(current, meta.salt)); // проверка текущего
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveKey(next, salt);
    const payload = readJSON(K.data);
    const stateObj = payload ? await decryptJSON(payload, cryptoKey) : null;
    localStorage.setItem(K.meta, JSON.stringify({ salt }));
    if (stateObj) localStorage.setItem(K.data, JSON.stringify(await encryptJSON(stateObj, key)));
    cryptoKey = key;
    sessionStorage.setItem(K.session, await exportKeyB64(key));
    if (localStorage.getItem(K.remember)) localStorage.setItem(K.remember, await exportKeyB64(key));
  }

  return { begin, persist, logout, changePassword, encryptionOn: () => !!subtle };
})();
