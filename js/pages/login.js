/** Страница входа (FR-21). */
import { $, h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, USE_MOCK } from '../api.js';

const form = $('#login-form');
const loginEl = $('#login');
const pwEl = $('#password');
const toggle = $('#toggle-pw');
const submit = $('#submit');
const formError = $('#form-error');
const status = $('#server-status');

/** Куда вернуться после входа. Только локальные страницы — защита от открытого редиректа. */
function nextUrl() {
  const n = new URLSearchParams(location.search).get('next') || '';
  return /^[a-z]+\.html(\?[\w=&%.-]*)?$/i.test(n) ? n : 'meetings.html';
}

function setStatus(online, text) {
  status.classList.toggle('down', !online);
  status.lastChild.textContent = text;
}

/* ---- показать / скрыть пароль ---- */
function renderToggle() {
  const shown = pwEl.type === 'text';
  mount(toggle, icon(shown ? 'eyeOff' : 'eye'));
  toggle.setAttribute('aria-label', shown ? 'Скрыть пароль' : 'Показать пароль');
  toggle.setAttribute('aria-pressed', String(shown));
}
toggle.addEventListener('click', () => {
  pwEl.type = pwEl.type === 'password' ? 'text' : 'password';
  renderToggle();
  pwEl.focus();
});
renderToggle();

/* ---- подсказка о Caps Lock ---- */
pwEl.addEventListener('keyup', (e) => {
  $('#caps-hint').hidden = !(e.getModifierState && e.getModifierState('CapsLock'));
});

/* ---- валидация ---- */
function showFieldError(input, errEl, show) {
  errEl.hidden = !show;
  input.setAttribute('aria-invalid', String(show));
}
[loginEl, pwEl].forEach((el) => el.addEventListener('input', () => {
  showFieldError(el, $(`#${el.id}-err`), false);
  formError.hidden = true;
}));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = loginEl.value.trim();
  const password = pwEl.value;
  showFieldError(loginEl, $('#login-err'), !login);
  showFieldError(pwEl, $('#password-err'), !password);
  if (!login) return loginEl.focus();
  if (!password) return pwEl.focus();

  submit.classList.add('is-loading');
  submit.disabled = true;
  formError.hidden = true;
  try {
    await api.login(login, password);
    location.replace(nextUrl());
  } catch (err) {
    const msg = err instanceof ApiError && err.status === 401
      ? 'Неверный логин или пароль. Проверьте раскладку и Caps Lock.'
      : err.message;
    mount(formError, icon('alert'), h('div', { class: 'alert-body' }, msg));
    formError.hidden = false;
    if (err.status === 0) setStatus(false, 'Нет связи с сервером');
    pwEl.select();
    pwEl.focus();
  } finally {
    submit.classList.remove('is-loading');
    submit.disabled = false;
  }
});

/* ---- если уже вошли — сразу дальше; заодно проверяем связь ---- */
(async () => {
  try {
    await api.me();
    location.replace(nextUrl());
  } catch (err) {
    if (err.status === 401) setStatus(true, 'Сервер на связи · сеть ISHITR-VOTE');
    else setStatus(false, 'Нет связи с сервером — проверьте Wi-Fi ISHITR-VOTE');
  }
})();

if (USE_MOCK) {
  const hint = $('#demo-hint');
  mount(hint, icon('info'), h('div', { class: 'alert-body' },
    h('b', null, 'Демо-режим'),
    h('span', null, 'Секретарь: secretary / secretary. Администратор: admin / admin.')));
  hint.hidden = false;
}
loginEl.focus();
