/**
 * Мини-хелперы для построения DOM без фреймворка.
 * Пользовательские данные всегда попадают в DOM через textContent — без innerHTML (защита от XSS).
 */

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'readOnly', 'hidden', 'indeterminate', 'open']);

/**
 * h('button', { class: 'btn', onClick: fn, 'aria-label': '…' }, 'Текст', childNode, [массив], null)
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) setProps(el, props);
  append(el, children);
  return el;
}

export function setProps(el, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) {
      if (PROPS.has(k)) el[k] = false;
      continue;
    }
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv === null || sv === undefined) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else if (k === 'ref' && typeof v === 'function') v(el);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Заменить содержимое элемента. */
export function mount(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Перерисовка с сохранением фокуса (по id) — чтобы опрос раз в секунду не сбивал клавиатурную навигацию. */
export function preserveFocus(fn) {
  const active = document.activeElement;
  const id = active && active.id;
  const selStart = active && 'selectionStart' in active ? active.selectionStart : null;
  fn();
  if (id) {
    const next = document.getElementById(id);
    if (next && next !== document.activeElement) {
      next.focus({ preventScroll: true });
      if (selStart !== null && 'setSelectionRange' in next) {
        try { next.setSelectionRange(selStart, selStart); } catch (e) { /* type=number */ }
      }
    }
  }
}

/** Простой debounce. */
export function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Уникальный id для связки label/input. */
let uid = 0;
export const nextId = (prefix = 'f') => `${prefix}-${++uid}`;
