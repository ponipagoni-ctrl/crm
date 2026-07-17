/* ============================================================
   Настройки облака (Firebase).

   Пока здесь null — CRM работает в ЛОКАЛЬНОМ режиме
   (данные только на этом устройстве, вход по коду доступа).

   Чтобы включить общую базу для команды: создайте проект Firebase
   (см. SETUP-CLOUD.md) и вставьте сюда конфигурацию из
   Project settings → General → Your apps → SDK setup → Config.
   ============================================================ */

window.FIREBASE_CONFIG = null;
/* Пример заполнения:
window.FIREBASE_CONFIG = {
  apiKey: "AIza…",
  authDomain: "makeday-crm.firebaseapp.com",
  projectId: "makeday-crm",
  storageBucket: "makeday-crm.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
*/

// Администратор CRM: одобряет сотрудников, управляет командой
window.CRM_ADMIN_EMAIL = 'ponipagoni@gmail.com';
