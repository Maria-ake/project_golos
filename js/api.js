/**
 * Клиент API (ТЗ, раздел 11). Все запросы — JSON на тот же сервер.
 * Авторизация — cookie сессии (POST /api/auth/login), поэтому credentials: 'same-origin'.
 * Если включён USE_MOCK, запросы обрабатывает js/mock.js прямо в браузере.
 */
import { USE_MOCK, API_BASE } from './config.js';

export class ApiError extends Error {
  constructor(status, data) {
    super((data && (typeof data.detail === 'string' ? data.detail : null)) || defaultMessage(status));
    this.status = status;
    this.data = data;
  }
}

function defaultMessage(status) {
  if (status === 0) return 'Нет связи с сервером. Проверьте, что ноутбук подключён к сети ISHITR-VOTE.';
  if (status === 401) return 'Нужно войти заново.';
  if (status === 403) return 'Недостаточно прав для этого действия.';
  if (status === 404) return 'Не найдено — возможно, запись уже удалена.';
  if (status === 409) return 'Действие сейчас недоступно: состояние изменилось. Обновите страницу.';
  if (status === 422) return 'Проверьте заполнение полей.';
  return 'Ошибка сервера. Попробуйте ещё раз.';
}

/* ---- статус соединения: шапка показывает «Сервер на связи / Нет связи» ---- */
const connListeners = new Set();
let lastOnline = null;
export function onConnection(fn) { connListeners.add(fn); if (lastOnline !== null) fn(lastOnline); return () => connListeners.delete(fn); }
function setOnline(v) {
  if (v === lastOnline) return;
  lastOnline = v;
  connListeners.forEach((fn) => fn(v));
}

let mockModule = null;
async function mock() {
  if (!mockModule) mockModule = await import('./mock.js');
  return mockModule;
}

async function request(method, path, body, { redirectOn401 = true } = {}) {
  let res;
  try {
    if (USE_MOCK) {
      res = await (await mock()).handle(method, path, body);
    } else {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(API_BASE + path, {
        method,
        credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      let data = null;
      if (r.status !== 204) {
        const text = await r.text();
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = { detail: text }; }
      }
      res = { status: r.status, data };
    }
  } catch (e) {
    setOnline(false);
    throw new ApiError(0, null);
  }
  setOnline(true);
  if (res.status >= 400) {
    if (res.status === 401 && redirectOn401) goToLogin();
    throw new ApiError(res.status, res.data);
  }
  return res.data;
}

export function goToLogin() {
  const here = location.pathname.split('/').pop() || 'meetings.html';
  if (here === 'login.html') return;
  const next = encodeURIComponent(here + location.search);
  location.href = `login.html?next=${next}`;
}

const q = (params) => {
  const s = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') s.set(k, v); });
  const str = s.toString();
  return str ? '?' + str : '';
};

/* ================= Эндпоинты ================= */
export const api = {
  /* Авторизация */
  me: () => request('GET', '/api/auth/me', undefined, { redirectOn401: false }),
  login: (login, password) => request('POST', '/api/auth/login', { login, password }, { redirectOn401: false }),
  logout: () => request('POST', '/api/auth/logout'),

  /* Заседания */
  meetings: {
    list: () => request('GET', '/api/meetings'),
    get: (id) => request('GET', `/api/meetings/${id}`),
    create: (data) => request('POST', '/api/meetings', data),
    update: (id, data) => request('PATCH', `/api/meetings/${id}`, data),
    showAgenda: (id) => request('POST', `/api/meetings/${id}/show-agenda`),
    reorderVotes: (id, voteIds) => request('PUT', `/api/meetings/${id}/votes/order`, { vote_ids: voteIds }),
  },

  /* Голосования */
  votes: {
    create: (meetingId, data) => request('POST', `/api/meetings/${meetingId}/votes`, data),
    get: (id) => request('GET', `/api/votes/${id}`),
    update: (id, data) => request('PUT', `/api/votes/${id}`, data),
    remove: (id) => request('DELETE', `/api/votes/${id}`),
    start: (id) => request('POST', `/api/votes/${id}/start`),
    stop: (id) => request('POST', `/api/votes/${id}/stop`),
    repeat: (id) => request('POST', `/api/votes/${id}/repeat`),
    paper: (id) => request('POST', `/api/votes/${id}/paper`),
    progress: (id) => request('GET', `/api/votes/${id}/progress`),
    showResults: (id) => request('POST', `/api/votes/${id}/show-results`),
  },

  /* История и выгрузка */
  history: (from, to) => request('GET', `/api/history${q({ from, to })}`),
  exportPath: (params) => `/api/export.xlsx${q(params)}`,

  /* Пульты (админ; чтение доступно и секретарю) */
  devices: {
    list: () => request('GET', '/api/devices'),
    create: (data) => request('POST', '/api/devices', data),
    update: (id, data) => request('PATCH', `/api/devices/${id}`, data),
    identify: (id) => request('POST', `/api/devices/${id}/identify`),
  },
  backup: () => request('POST', '/api/admin/backup'),
  backupInfo: () => request('GET', '/api/admin/backup'),

  /* Экран проектора (без входа) */
  screenState: () => request('GET', '/api/screen/state', undefined, { redirectOn401: false }),
};

/**
 * Скачивание выгрузки. С настоящим сервером — обычная навигация по ссылке (cookie уходит сама).
 * В демо-режиме файл собирается в браузере.
 */
export async function download(params) {
  if (USE_MOCK) {
    const m = await mock();
    const { blob, filename } = await m.exportFile(params);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return filename;
  }
  const a = document.createElement('a');
  a.href = API_BASE + api.exportPath(params);
  a.download = '';
  document.body.append(a); a.click(); a.remove();
  return null;
}

export { USE_MOCK };
