/**
 * Настройки фронтенда.
 *
 * USE_MOCK — встроенный демо-сервер в браузере (js/mock.js) вместо настоящего FastAPI.
 *   По умолчанию включён, пока бэкенд не готов. Переключение без правки кода:
 *   добавьте к адресу любой страницы ?mock=0 (настоящий сервер) или ?mock=1 (демо) —
 *   выбор запоминается в localStorage.
 */
const params = new URLSearchParams(location.search);
if (params.has('mock')) {
  try { localStorage.setItem('golos.useMock', params.get('mock') === '0' ? '0' : '1'); } catch (e) { /* приватный режим */ }
}

function readMockFlag() {
  try {
    const v = localStorage.getItem('golos.useMock');
    if (v === '0') return false;
    if (v === '1') return true;
  } catch (e) { /* ignore */ }
  return DEFAULT_MOCK;
}

/** Значение по умолчанию. Поставьте false, когда FastAPI начнёт отдавать /api. */
const DEFAULT_MOCK = true;

export const USE_MOCK = readMockFlag();

/** Базовый адрес API. Пустая строка — тот же сервер, что раздаёт статику (FastAPI). */
export const API_BASE = '';

/** Интервалы опроса, мс (ТЗ 5.1: «опрос сервера раз в 1 с»). */
export const POLL = {
  control: 1000,
  screen: 1000,
  devices: 3000,
};

/** Пульт считается «на связи», если откликался не позже этого срока, мс. */
export const ONLINE_WINDOW_MS = 5000;

/** Число членов совета (ТЗ: 15). */
export const COUNCIL_SIZE = 15;

/** Длительность пункта по умолчанию, с. */
export const DEFAULT_SECONDS = { single: 60, batch: 10 };
export const SECONDS_RANGE = { min: 10, max: 300, step: 5 };
