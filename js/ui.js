/** Общие элементы интерфейса: шапка, уведомления, диалоги, сортировка перетаскиванием, статусы. */
import { h, mount, $ } from './dom.js';
import { icon } from './icons.js';
import { api, ApiError, onConnection, USE_MOCK } from './api.js';
import { initials } from './format.js';

/* ================= Подписи статусов ================= */
export const VOTE_STATUS = {
  draft: { text: 'Черновик', cls: 'badge-warn' },
  ready: { text: 'Готово', cls: 'badge-ok' },
  running: { text: 'Идёт', cls: 'badge-live' },
  finished: { text: 'Завершено', cls: 'badge-mute' },
  stopped: { text: 'Остановлено', cls: 'badge-err' },
};
export const MEETING_STATUS = {
  planned: { text: 'Запланировано', cls: 'badge-info' },
  open: { text: 'Идёт', cls: 'badge-ok' },
  closed: { text: 'Проведено', cls: 'badge-ok' },
};
export const KIND = { single: 'Одиночное', batch: 'Пакетное' };

export function badge(text, cls = 'badge-mute', { dot = false, pulse = false } = {}) {
  return h('span', { class: `badge ${cls}` }, dot ? h('span', { class: 'dot' + (pulse ? ' pulse' : '') }) : null, text);
}

/* ================= Инициализация страницы ================= */
/**
 * Проверяет сессию, рисует шапку, показывает отложенное уведомление.
 * @param {{active: 'meetings'|'history'|'devices', roles?: string[]}} opts
 * @returns {Promise<object>} пользователь {id, login, name, role}
 */
export async function initPage({ active, roles } = {}) {
  let user;
  try {
    user = await api.me();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const here = location.pathname.split('/').pop() + location.search;
      location.replace(`login.html?next=${encodeURIComponent(here)}`);
      return new Promise(() => {}); // ждём переход
    }
    renderHeader(active, null);
    throw e;
  }
  renderHeader(active, user);
  showFlash();
  if (roles && !roles.includes(user.role)) {
    const err = new ApiError(403, { detail: 'Раздел доступен только администратору.' });
    throw err;
  }
  return user;
}

export function renderHeader(active, user) {
  const host = $('#app-header');
  if (!host) return;
  const link = (key, href, text) => h('a', { href, 'aria-current': active === key ? 'page' : null }, text);
  const conn = h('span', { class: 'conn', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'dot' }), h('span', null, 'Сервер на связи'));
  onConnection((online) => {
    conn.classList.toggle('down', !online);
    conn.lastChild.textContent = online ? 'Сервер на связи' : 'Нет связи с сервером';
  });

  const logout = h('button', {
    class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Выйти', title: 'Выйти',
    onClick: async () => {
      try { await api.logout(); } catch (e) { /* всё равно уходим */ }
      location.href = 'login.html';
    },
  }, icon('logout'));

  mount(host,
    USE_MOCK ? h('div', { class: 'demo-banner' }, 'Демо-режим: данные хранятся в этом браузере. Настоящий сервер — ', h('a', { href: '?mock=0', style: { color: '#000' } }, 'переключить'), '.') : null,
    h('div', { class: 'top' },
      h('div', { class: 'top-in' },
        h('a', { class: 'brand', href: 'meetings.html' },
          h('span', { class: 'brand-mark' }, icon('school')),
          h('span', { class: 'brand-text' }, h('b', null, 'Учёный совет ИШИТР'), h('span', null, 'Тайное голосование'))),
        h('nav', { class: 'nav', 'aria-label': 'Разделы' },
          link('meetings', 'meetings.html', 'Заседания'),
          link('history', 'history.html', 'История'),
          user && user.role === 'admin' ? link('devices', 'devices.html', 'Пульты') : null),
        h('div', { class: 'top-right' },
          conn,
          user ? h('span', { class: 'vsep', 'aria-hidden': 'true' }) : null,
          user ? h('span', { class: 'user' },
            h('span', { class: 'avatar' + (user.role === 'admin' ? ' admin' : ''), 'aria-hidden': 'true' }, initials(user.name)),
            h('span', { class: 'user-text' }, h('b', null, user.name), h('span', null, user.role === 'admin' ? 'Администратор' : 'Секретарь'))) : null,
          user ? logout : null))));
}

/* ================= Уведомления ================= */
let toastHost;
export function toast(text, kind = 'ok', ms = 4000) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const ic = kind === 'err' ? 'alert' : kind === 'info' ? 'info' : 'check';
  const t = h('div', { class: `toast ${kind}` }, icon(ic), h('span', null, text));
  toastHost.append(t);
  setTimeout(() => t.remove(), ms);
}

export function toastError(e, fallback = 'Не получилось выполнить действие') {
  toast(e instanceof ApiError ? e.message : fallback, 'err', 6000);
}

/** Уведомление, которое покажется на следующей странице (после перехода). */
export function flash(text, kind = 'ok') {
  try { sessionStorage.setItem('golos.flash', JSON.stringify({ text, kind })); } catch (e) { /* ignore */ }
}
function showFlash() {
  try {
    const raw = sessionStorage.getItem('golos.flash');
    if (!raw) return;
    sessionStorage.removeItem('golos.flash');
    const { text, kind } = JSON.parse(raw);
    toast(text, kind);
  } catch (e) { /* ignore */ }
}

/* ================= Диалоги (нативный <dialog>) ================= */
/**
 * openDialog({ title, body: Node|Node[], actions: [{ text, cls, onClick(close) → Promise|void, autofocus }], danger })
 * Возвращает { close, el }. Esc и клик по фону закрывают диалог.
 */
export function openDialog({ title, body, actions = [], danger = false, onClose }) {
  const titleId = 'dlg-t-' + Math.random().toString(36).slice(2, 8);
  const dlg = h('dialog', { class: 'dlg' + (danger ? ' is-danger' : ''), 'aria-labelledby': titleId });
  const close = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

  const buttons = actions.map((a) => {
    const b = h('button', { class: `btn ${a.cls || 'btn-tertiary'}`, type: a.submit ? 'submit' : 'button', autofocus: a.autofocus || null }, a.text);
    if (!a.submit) {
      b.addEventListener('click', async () => {
        if (!a.onClick) return close();
        b.classList.add('is-loading');
        try { await a.onClick(close); } finally { b.classList.remove('is-loading'); }
      });
    }
    return b;
  });

  const form = h('form', { method: 'dialog', novalidate: true },
    h('div', { class: 'dlg-head' },
      h('h2', { id: titleId }, title),
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))),
    h('div', { class: 'dlg-body' }, body),
    buttons.length ? h('div', { class: 'dlg-foot' }, buttons) : null);

  const submitAction = actions.find((a) => a.submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!submitAction) return;
    const btn = buttons[actions.indexOf(submitAction)];
    btn.classList.add('is-loading');
    try { await submitAction.onClick(close); } finally { btn.classList.remove('is-loading'); }
  });

  dlg.append(form);
  document.body.append(dlg);
  dlg.showModal();
  return { close, el: dlg, form };
}

/** Подтверждение. Возвращает Promise<boolean>. */
export function confirmDialog({ title, text, ok = 'Подтвердить', cancel = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    openDialog({
      title,
      danger,
      body: h('p', null, text),
      actions: [
        { text: cancel, cls: 'btn-tertiary', autofocus: danger, onClick: (close) => close() },
        { text: ok, cls: danger ? 'btn-danger-fill' : 'btn-primary', autofocus: !danger, onClick: (close) => { result = true; close(); } },
      ],
      onClose: () => resolve(result),
    });
  });
}

/* ================= Состояния загрузки и ошибки ================= */
export function loadingState(text = 'Загружаем…') {
  return h('div', { class: 'card empty', 'aria-busy': 'true' },
    h('div', { class: 'skeleton', style: { width: '48px', height: '48px', borderRadius: '50%' } }),
    h('p', null, text));
}

export function errorState(e, retry) {
  return h('div', { class: 'card empty', role: 'alert' },
    icon('alert'),
    h('b', null, e && e.status === 403 ? 'Нет доступа' : 'Не удалось загрузить данные'),
    h('p', null, e instanceof ApiError ? e.message : String(e && e.message ? e.message : e)),
    retry ? h('button', { class: 'btn btn-secondary', type: 'button', onClick: retry }, icon('replay'), 'Повторить') : null);
}

export function emptyState({ iconName = 'calendar', title, text, action }) {
  return h('div', { class: 'empty' }, icon(iconName), h('b', null, title), text ? h('p', null, text) : null, action || null);
}

/* ================= Сортировка перетаскиванием (+ клавиатура) ================= */
/**
 * makeSortable(container, { itemSelector, handleSelector, onReorder(fromIndex, toIndex) })
 * Перетаскивание — только за ручку (иначе ломается выделение текста в полях).
 * С клавиатуры: фокус на ручке + стрелки ↑/↓.
 */
export function makeSortable(container, { itemSelector, handleSelector, onReorder }) {
  let dragEl = null;
  const items = () => Array.from(container.querySelectorAll(itemSelector));
  const clearMarks = () => items().forEach((i) => i.classList.remove('drop-before', 'drop-after', 'is-dragging'));

  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle) return;
    const item = handle.closest(itemSelector);
    if (item) item.draggable = true;
  });
  container.addEventListener('dragstart', (e) => {
    dragEl = e.target.closest(itemSelector);
    if (!dragEl) return;
    dragEl.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', ''); } catch (err) { /* Firefox */ }
  });
  container.addEventListener('dragover', (e) => {
    if (!dragEl) return;
    const over = e.target.closest(itemSelector);
    if (!over || over === dragEl) return;
    e.preventDefault();
    const r = over.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    items().forEach((i) => i.classList.remove('drop-before', 'drop-after'));
    over.classList.add(after ? 'drop-after' : 'drop-before');
  });
  container.addEventListener('drop', (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const over = e.target.closest(itemSelector);
    const list = items();
    const from = list.indexOf(dragEl);
    if (over && over !== dragEl) {
      let to = list.indexOf(over);
      if (over.classList.contains('drop-after')) to += 1;
      if (from < to) to -= 1;
      if (to !== from) onReorder(from, to);
    }
    clearMarks();
  });
  container.addEventListener('dragend', () => {
    clearMarks();
    if (dragEl) dragEl.draggable = false;
    dragEl = null;
  });
  container.addEventListener('keydown', (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const list = items();
    const from = list.indexOf(handle.closest(itemSelector));
    const to = e.key === 'ArrowUp' ? from - 1 : from + 1;
    if (to < 0 || to >= list.length) return;
    onReorder(from, to, { keyboard: true });
  });
}

export function moveItem(arr, from, to) {
  const copy = arr.slice();
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x);
  return copy;
}

/** Кнопка с состоянием загрузки на время промиса. */
export async function withLoading(btn, fn) {
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  try { return await fn(); } finally { btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy'); }
}
