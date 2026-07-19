/* ============================================================
   Настройки облака (Firebase).

   Пока здесь null — CRM работает в ЛОКАЛЬНОМ режиме
   (данные только на этом устройстве, вход по коду доступа).

   Чтобы включить общую базу для команды: создайте проект Firebase
   (см. SETUP-CLOUD.md) и вставьте сюда конфигурацию из
   Project settings → General → Your apps → SDK setup → Config.
   ============================================================ */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDPjkBJNawCeR_M1iDN8OD3v_fo3cRWu84",
  authDomain: "makeday-crm.firebaseapp.com",
  projectId: "makeday-crm",
  storageBucket: "makeday-crm.firebasestorage.app",
  messagingSenderId: "945188988680",
  appId: "1:945188988680:web:2c8f311eeb8eb3d8e16ebd"
};

// Администратор CRM: одобряет сотрудников, управляет командой
window.CRM_ADMIN_EMAIL = 'ponipagoni@gmail.com';
