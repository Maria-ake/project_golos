/**
 * Экран проектора (FR-05, FR-12, FR-14). Без входа, только чтение GET /api/screen/state раз в секунду.
 * Во время голосования — никаких счётчиков, только пункт и таймер.
 * F — полный экран. Курсор прячется через 3 с без движения.
 */
import { h, mount, $ } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { fmtDate, nPlural, W, pad2 } from '../format.js';
import { POLL } from '../config.js';

const root = $('#screen');
const state = { s: null, key: '', deadline: 0, ring: null, fails: 0, page: 0, pageTimer: null };
const PER_PAGE = 12;

/* ================= опрос ================= */
async function poll() {
  try {
    const s = await api.screenState();
    state.fails = 0;
    $('#offline').hidden = true;
    state.s = s;
    if (s.mode === 'voting') state.deadline = performance.now() + s.seconds_left * 1000;
    const key = keyOf(s);
    if (key !== state.key) { state.key = key; state.page = 0; render(); }
  } catch (e) {
    state.fails += 1;
    if (state.fails >= 3) $('#offline').hidden = false;
  } finally {
    setTimeout(poll, POLL.screen);
  }
}

function keyOf(s) {
  const copy = { ...s };
  delete copy.seconds_left;
  return JSON.stringify(copy);
}

/* ================= отрисовка ================= */
function render() {
  const s = state.s || { mode: 'idle' };
  clearInterval(state.pageTimer);
  state.ring = null;
  const body = {
    idle: renderIdle,
    agenda: renderAgenda,
    voting: renderVoting,
    results: renderResults,
    stopped: renderStopped,
  }[s.mode] || renderIdle;
  mount(root, topBar(s), h('div', { class: 'scr-body fade-in' }, body(s)));
  tick();
}

function topBar(s) {
  const m = s.meeting;
  return h('div', { class: 'scr-top' },
    h('div', { class: 'scr-brand' },
      h('span', { class: 'mark' }, icon('school')),
      h('span', null, 'Учёный совет ИШИТР'),
      m ? h('span', { class: 'date' }, `· ${fmtDate(m.held_on)}`) : null),
    s.present ? h('div', { class: 'scr-present' }, icon('accountGroup'), 'Присутствуют ', h('b', null, String(s.present))) : null);
}

function renderIdle(s) {
  return h('div', { class: 'idle' },
    h('div', { class: 'clock', id: 'clock' }),
    h('div', { class: 'sub' }, s.meeting ? s.meeting.title : 'Тайное голосование'),
    h('div', { class: 'sub', style: { fontSize: '1.5rem' } }, 'Голосование начнётся по команде секретаря'));
}

function renderAgenda(s) {
  const status = (v) => (['finished', 'stopped'].includes(v.status) ? 'done' : v.status === 'running' ? 'now' : '');
  return [
    h('div', { class: 'stack-s', style: { gap: '.6rem' } },
      h('span', { class: 'kicker' }, s.meeting ? s.meeting.title : 'Заседание'),
      h('h1', { style: { fontSize: '4.5rem' } }, 'Повестка тайных голосований')),
    s.votes.length
      ? h('ol', { class: 'agenda' }, s.votes.slice(0, 6).map((v, i) => h('li', { class: status(v) },
        h('span', { class: 'n' }, String(i + 1)),
        h('span', { class: 't' }, v.title),
        h('span', { class: 'm' }, v.kind === 'batch' ? `${nPlural(v.items_count, W.candidate)} по очереди` : 'одиночное'))))
      : h('p', { style: { fontSize: '2rem' } }, 'Голосований в повестке нет'),
    h('div', { class: 'foot-line' }, h('span', null, 'Голосование тайное'), h('span', null, '·'), h('span', null, 'Ответы: За / Против / Воздержался'), h('span', null, '·'), h('span', null, 'Переголосовать нельзя')),
  ];
}

function renderVoting(s) {
  const isBatch = s.vote.kind === 'batch';
  const it = s.item;
  const repeat = it.attempt_no > 1 ? ` · повтор` : '';
  const kicker = isBatch ? `${s.vote.title} · кандидатура ${it.position} из ${it.total}${repeat}` : `${s.vote.title}${repeat}`;
  const nameLen = (it.candidate_name || '').length;
  const qLen = (it.text || '').length;

  // Большой таймер
  const R = 88; const C = 2 * Math.PI * R;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('aria-hidden', 'true');
  const mk = (cls) => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', 100); c.setAttribute('cy', 100); c.setAttribute('r', R); c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', 12); c.setAttribute('class', cls); return c; };
  const bar = mk('bar');
  bar.setAttribute('stroke-linecap', 'round');
  bar.setAttribute('stroke-dasharray', C.toFixed(2));
  svg.append(mk('track'), bar);
  const num = h('b');
  const ringEl = h('div', { class: 'big-ring', role: 'timer' }, svg, h('div', { class: 'txt' }, num, h('span', null, 'осталось')));
  state.ring = { el: ringEl, bar, num, C, total: s.item_seconds };

  return [
    h('div', { class: 'voting' },
      h('div', { class: 'who' },
        h('span', { class: 'kicker', style: { fontSize: '1.9rem' } }, kicker),
        isBatch
          ? [h('h1', { class: 'name' + (nameLen > 28 ? ' long' : '') }, it.candidate_name), h('div', { class: 'post' }, it.candidate_post)]
          : h('h1', { class: 'question' + (qLen > 220 ? ' xlong' : qLen > 120 ? ' long' : '') }, it.text)),
      ringEl),
    h('div', { class: 'keys' },
      h('div', { class: 'set' },
        h('span', { class: 'key' }, h('i', { class: 'led g' }), 'За'),
        h('span', { class: 'key' }, h('i', { class: 'led r' }), 'Против'),
        h('span', { class: 'key' }, h('i', { class: 'led y' }), 'Воздержался')),
      h('span', { class: 'hint' }, 'Нажмите кнопку на пульте.', h('br'), 'Светодиод загорится, когда голос принят.')),
    isBatch && it.total > 1 && it.total <= 40 ? h('div', { class: 'dots', 'aria-hidden': 'true' },
      Array.from({ length: it.total }, (_, i) => h('span', { class: i + 1 < it.position ? 'done' : i + 1 === it.position ? 'cur' : '' }))) : null,
  ];
}

function renderResults(s) {
  if (s.vote.kind === 'single' && s.items.length === 1) return renderSingleResult(s);
  const items = s.items;
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const pageItems = items.slice(state.page * PER_PAGE, (state.page + 1) * PER_PAGE);
  if (pages > 1) {
    state.pageTimer = setInterval(() => { state.page = (state.page + 1) % pages; render(); }, 10000);
  }
  // Высота строки подстраивается под число кандидатур.
  const rowH = Math.max(3.25, Math.min(6, 44 / Math.max(pageItems.length, 1)));
  const anyBad = items.some((i) => i.status === 'invalid');
  const present = s.present;

  return [
    h('div', { class: 'res-head' },
      h('div', { class: 'stack-s', style: { gap: '.6rem' } },
        h('span', { class: 'kicker' }, 'Итоги тайного голосования'),
        h('h1', null, s.vote.title)),
      h('div', { class: 'legend' },
        h('span', null, h('i', { style: { background: '#48E868' } }), 'За'),
        h('span', null, h('i', { style: { background: '#FF4460' } }), 'Против'),
        h('span', null, h('i', { style: { background: '#FFB600' } }), 'Воздержался'))),
    h('div', { class: 'rtable', role: 'table', 'aria-label': 'Итоги по кандидатурам' },
      h('div', { class: 'rrow head', role: 'row' },
        h('span', { role: 'columnheader', style: { textAlign: 'center' } }, '№'),
        h('span', { role: 'columnheader' }, 'Кандидатура'),
        h('span', { role: 'columnheader', class: 'f', style: { textAlign: 'center' } }, 'За'),
        h('span', { role: 'columnheader', class: 'a', style: { textAlign: 'center' } }, 'Против'),
        h('span', { role: 'columnheader', class: 'ab', style: { textAlign: 'center' } }, 'Возд.'),
        h('span', { role: 'columnheader' }, 'Распределение'),
        h('span', { role: 'columnheader' }, 'Итог')),
      pageItems.map((it) => resultRow(it, rowH, present))),
    h('div', { class: 'res-foot' },
      anyBad ? h('span', { style: { display: 'flex', alignItems: 'center', gap: '1rem' } },
        h('span', { class: 'st err' }, 'Недействительно'),
        `сумма голосов не равна числу присутствующих${present ? ` (${present})` : ''} — пункт будет повторён`) : h('span', null, 'Все пункты действительны'),
      pages > 1 ? h('span', null, `Страница ${state.page + 1} из ${pages}`) : null),
  ];
}

function resultRow(it, rowH, present) {
  const a = it.attempt && it.attempt.end_reason === 'stopped' ? null : it.attempt;
  if (!a && it.attempt && it.status !== 'paper') it = { ...it, status: 'stopped' };
  const name = it.candidate_name || it.text;
  let st;
  if (it.status === 'paper') st = h('span', { class: 'st warn' }, 'На бумаге');
  else if (it.status === 'pending') st = h('span', { class: 'st mute' }, 'Не проводился');
  else if (it.status === 'stopped') st = h('span', { class: 'st err' }, 'Остановлено');
  else if (!a) st = h('span', { class: 'st mute' }, '—');
  else if (a.is_valid) st = h('span', { class: 'st ok' }, 'Действительно');
  else st = h('span', { class: 'st err' }, a.end_reason === 'stopped' ? 'Остановлено' : 'Недействительно');
  const base = (a && a.present_count) || present || 1;
  const pct = (x) => `${Math.min(100, (x / base) * 100).toFixed(2)}%`;
  return h('div', { class: 'rrow' + (it.status === 'invalid' ? ' bad' : ''), role: 'row', style: { '--h': `${rowH}rem` } },
    h('span', { class: 'pos', role: 'cell' }, String(it.position)),
    h('span', { class: 'nm', role: 'cell' }, h('b', null, shortFio(name)), it.candidate_post ? h('span', null, it.candidate_post) : null),
    h('span', { class: 'v f', role: 'cell' }, a ? String(a.for_count) : '—'),
    h('span', { class: 'v a', role: 'cell' }, a ? String(a.against_count) : '—'),
    h('span', { class: 'v ab', role: 'cell' }, a ? String(a.abstain_count) : '—'),
    h('span', { class: 'bar', role: 'cell', 'aria-hidden': 'true' },
      a ? [h('i', { style: { width: pct(a.for_count), background: '#48E868' } }), h('i', { style: { width: pct(a.against_count), background: '#FF4460' } }), h('i', { style: { width: pct(a.abstain_count), background: '#FFB600' } })] : null),
    h('span', { role: 'cell' }, st));
}

/** На экране — «Фамилия И. О.», чтобы строка помещалась. */
function shortFio(full) {
  const p = String(full || '').trim().split(/\s+/);
  if (p.length !== 3) return full;
  return `${p[0]} ${p[1][0]}. ${p[2][0]}.`;
}

function renderSingleResult(s) {
  const it = s.items[0];
  const a = it.attempt;
  const valid = a && a.is_valid;
  return [
    h('div', { class: 'stack-s', style: { gap: '.8rem' } },
      h('span', { class: 'kicker' }, 'Итоги тайного голосования'),
      h('h1', { style: { fontSize: (it.text || '').length > 140 ? '2.6rem' : '3.25rem' } }, it.text || s.vote.title)),
    a ? h('div', { class: 'single-res' },
      h('div', null, h('span', { style: { color: '#5FEA7C' } }, 'За'), h('b', null, String(a.for_count))),
      h('div', null, h('span', { style: { color: '#FF8A9C' } }, 'Против'), h('b', null, String(a.against_count))),
      h('div', null, h('span', { style: { color: '#FFC94D' } }, 'Воздержался'), h('b', null, String(a.abstain_count))))
      : h('p', { style: { fontSize: '2rem' } }, 'Итог не получен'),
    h('div', { class: 'res-foot' },
      h('span', { style: { display: 'flex', alignItems: 'center', gap: '1rem' } },
        it.status === 'paper' ? h('span', { class: 'st warn' }, 'На бумаге') : h('span', { class: `st ${valid ? 'ok' : 'err'}` }, valid ? 'Действительно' : 'Недействительно'),
        a ? `Всего ${a.total} из ${a.present_count}` : ''),
      h('span', null, s.vote.title)),
  ];
}

function renderStopped(s) {
  return h('div', { class: 'stopped' },
    h('span', { class: 'kicker', style: { color: '#FF8A9C' } }, s.vote ? s.vote.title : 'Голосование'),
    h('div', { class: 'big' }, 'Голосование остановлено'),
    h('div', { class: 'sub' }, 'Переходим на бумажные бюллетени. Секретарь раздаст их сейчас.'));
}

/* ================= таймер и часы ================= */
function tick() {
  const s = state.s;
  if (s && s.mode === 'voting' && state.ring) {
    const left = Math.max(0, (state.deadline - performance.now()) / 1000);
    const l = Math.ceil(left);
    state.ring.num.textContent = `${Math.floor(l / 60)}:${pad2(l % 60)}`;
    const frac = state.ring.total ? Math.max(0, Math.min(1, left / state.ring.total)) : 0;
    state.ring.bar.setAttribute('stroke-dashoffset', (state.ring.C * (1 - frac)).toFixed(2));
    state.ring.el.classList.toggle('low', l <= 3);
  }
  const clock = document.getElementById('clock');
  if (clock) { const d = new Date(); clock.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
}
setInterval(tick, 200);

/* ================= полный экран, курсор, сон ================= */
const fsBtn = $('#fs-btn');
function renderFsBtn() {
  const on = !!document.fullscreenElement;
  mount(fsBtn, icon('fullscreen'), on ? 'Выйти из полного экрана (F)' : 'Полный экран (F)');
}
function toggleFs() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
fsBtn.addEventListener('click', toggleFs);
document.addEventListener('fullscreenchange', renderFsBtn);
document.addEventListener('keydown', (e) => { if ((e.key === 'f' || e.key === 'а' || e.key === 'F') && !e.ctrlKey && !e.metaKey) toggleFs(); });
renderFsBtn();

let idleT;
document.addEventListener('mousemove', () => {
  document.body.classList.remove('hide-cursor');
  document.body.classList.add('show-tools');
  clearTimeout(idleT);
  idleT = setTimeout(() => { document.body.classList.add('hide-cursor'); document.body.classList.remove('show-tools'); }, 3000);
});

let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* не поддерживается */ }
}
document.addEventListener('visibilitychange', keepAwake);
keepAwake();

render();
poll();
