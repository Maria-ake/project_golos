/** История голосований и выгрузка в Excel (FR-17, FR-18, UC-07). */
import { h, mount, $, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { api, download } from '../api.js';
import { initPage, badge, KIND, toast, toastError, loadingState, errorState, emptyState, withLoading } from '../ui.js';
import { fmtDate, dateParts, nPlural, W, toISODate, academicYear, fmtDateNum } from '../format.js';

const main = $('#main');
const params = new URLSearchParams(location.search);

const today = toISODate(new Date());
const yearAgo = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 1); return toISODate(d); })();
const ay = academicYear();
const prevAy = academicYear(new Date(Number(ay.from.slice(0, 4)) - 1, 9, 1));
const PERIODS = [
  { id: 'year', label: 'Последние 12 мес.', from: yearAgo, to: today },
  { id: 'ay', label: ay.label, from: ay.from, to: ay.to },
  { id: 'prev', label: prevAy.label, from: prevAy.from, to: prevAy.to },
  { id: 'all', label: 'Всё время', from: '', to: '' },
];

const state = {
  period: params.get('from') || params.get('to') ? 'custom' : params.get('meeting') ? 'all' : 'year',
  from: params.get('from') || yearAgo,
  to: params.get('to') || today,
  q: params.get('q') || '',
  onlyBad: params.get('bad') === '1',
  meetingId: Number(params.get('meeting')) || null,
  data: [],
  open: new Set(),
  loading: false,
};
if (state.period !== 'custom') applyPeriod(state.period, false);

boot();

async function boot() {
  mount(main, loadingState());
  try {
    await initPage({ active: 'history' });
    renderShell();
    await load();
  } catch (e) {
    mount(main, errorState(e, boot));
  } finally {
    main.removeAttribute('aria-busy');
  }
}

function applyPeriod(id, reload = true) {
  const p = PERIODS.find((x) => x.id === id);
  state.period = id;
  if (p) { state.from = p.from; state.to = p.to; }
  if (reload) { renderFilters(); load(); }
}

async function load() {
  state.loading = true;
  renderResults();
  try {
    state.data = await api.history(state.from, state.to);
    // По умолчанию раскрыты два последних заседания (или выбранное по ссылке).
    state.open = new Set(state.meetingId ? [state.meetingId] : state.data.slice(0, 2).map((m) => m.id));
  } catch (e) {
    state.data = null;
    state.error = e;
  }
  state.loading = false;
  syncUrl();
  renderResults();
}

function syncUrl() {
  const u = new URL(location.href);
  ['from', 'to', 'q', 'bad', 'meeting'].forEach((k) => u.searchParams.delete(k));
  if (state.period === 'custom') { if (state.from) u.searchParams.set('from', state.from); if (state.to) u.searchParams.set('to', state.to); }
  if (state.q) u.searchParams.set('q', state.q);
  if (state.onlyBad) u.searchParams.set('bad', '1');
  if (state.meetingId) u.searchParams.set('meeting', state.meetingId);
  history.replaceState(null, '', u);
}

/* ================= фильтрация на клиенте ================= */
function attemptIsBad(it, a) { return it.status === 'paper' || !a.is_valid; }

function filtered() {
  const q = state.q.trim().toLowerCase();
  const out = [];
  for (const m of state.data || []) {
    if (state.meetingId && m.id !== state.meetingId) continue;
    const votes = [];
    for (const v of m.votes) {
      const voteHit = !q || v.title.toLowerCase().includes(q);
      const items = [];
      for (const it of v.items) {
        const name = (v.kind === 'batch' ? it.candidate_name : it.text) || '';
        const hit = voteHit || name.toLowerCase().includes(q) || String(it.candidate_post || '').toLowerCase().includes(q);
        if (!hit) continue;
        let attempts = it.attempts;
        if (state.onlyBad) attempts = attempts.filter((a) => attemptIsBad(it, a));
        if (!attempts.length && !(state.onlyBad && it.status === 'paper')) continue;
        items.push({ ...it, attempts });
      }
      if (items.length) votes.push({ ...v, items });
    }
    if (votes.length) out.push({ ...m, votes });
  }
  return out;
}

/* ================= отрисовка ================= */
function renderShell() {
  mount(main,
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' }, h('span', { class: 'overline' }, 'Итоги для протокола'), h('h1', null, 'История голосований')),
      h('div', { class: 'stack-s', style: { alignItems: 'flex-end', gap: '6px' } },
        h('button', { class: 'btn btn-primary btn-lg', type: 'button', id: 'export', onClick: (e) => exportCurrent(e.currentTarget) }, icon('excel'), 'Выгрузить в Excel'),
        h('span', { class: 'tiny muted', id: 'export-hint' }))),
    h('section', { class: 'card filters', id: 'filters', 'aria-label': 'Фильтры' }),
    h('div', { id: 'results', class: 'stack', 'aria-live': 'polite' }),
    h('div', { class: 'note', style: { maxWidth: '820px' } }, icon('info'),
      h('span', null, 'Пункт действителен, когда За + Против + Воздержался равно числу присутствующих. Закрытые попытки изменить нельзя; в выгрузке каждая попытка — отдельная строка.')));
  renderFilters();
}

function renderFilters() {
  const el = $('#filters');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-labelledby': 'per-l' },
    PERIODS.map((p) => h('button', { type: 'button', 'aria-pressed': String(state.period === p.id), onClick: () => { state.meetingId = null; applyPeriod(p.id); } }, p.label)));
  const dateInput = (key, label) => h('div', { class: 'field', style: { width: '160px' } },
    h('label', { class: 'label', for: `d-${key}`, style: { fontSize: '14px', marginBottom: '6px' } }, label),
    h('input', {
      class: 'input input-sm', id: `d-${key}`, type: 'date', value: state[key],
      onChange: (e) => { state[key] = e.target.value; state.period = 'custom'; state.meetingId = null; renderFilters(); load(); },
    }));
  const search = h('input', {
    class: 'input input-sm with-icon', id: 'q', type: 'search', value: state.q, placeholder: 'Фамилия кандидата или текст вопроса',
    onInput: debounce((e) => { state.q = e.target.value; syncUrl(); renderResults(); }, 200),
  });
  mount(el,
    h('div', null, h('span', { class: 'label', id: 'per-l', style: { fontSize: '14px', marginBottom: '6px' } }, 'Период'), seg),
    h('div', { class: 'row', style: { gap: '8px', alignItems: 'flex-end' } },
      dateInput('from', 'С'), h('span', { class: 'muted', style: { height: '40px', display: 'flex', alignItems: 'center' } }, '—'), dateInput('to', 'По')),
    h('div', { class: 'field', style: { flex: '1 1 240px' } },
      h('label', { class: 'label', for: 'q', style: { fontSize: '14px', marginBottom: '6px' } }, 'Поиск'),
      h('div', { class: 'input-wrap' }, icon('magnify', { class: 'input-icon' }), search)),
    h('label', { class: 'switch' },
      h('input', { type: 'checkbox', id: 'only-bad', checked: state.onlyBad, onChange: (e) => { state.onlyBad = e.target.checked; syncUrl(); renderResults(); } }),
      h('span', { class: 'track', 'aria-hidden': 'true' }),
      'Только недействительные'),
    state.meetingId ? h('button', {
      class: 'chip', type: 'button', 'aria-pressed': 'true',
      onClick: () => { state.meetingId = null; syncUrl(); renderFilters(); renderResults(); },
      'aria-label': 'Показать все заседания периода',
    }, 'Одно заседание', icon('close', { size: 16 })) : null);
}

function renderResults() {
  const el = $('#results');
  if (!el) return;
  const hint = $('#export-hint');
  if (state.loading) { mount(el, loadingState('Загружаем итоги…')); return; }
  if (!state.data) { mount(el, errorState(state.error, load)); return; }
  const list = filtered();
  const one = state.meetingId && state.data.find((m) => m.id === state.meetingId);
  if (hint) {
    hint.textContent = one
      ? `Файл .xlsx по заседанию ${fmtDateNum(one.held_on)}`
      : state.from || state.to ? `Файл .xlsx за ${state.from ? fmtDateNum(state.from) : 'всё время'} — ${state.to ? fmtDateNum(state.to) : 'сегодня'}` : 'Файл .xlsx за всё время';
  }

  if (!list.length) {
    mount(el, h('div', { class: 'card' }, emptyState({
      iconName: 'history',
      title: state.data.length ? 'Ничего не найдено' : 'За этот период голосований не было',
      text: state.data.length ? 'Измените поиск или отключите «Только недействительные».' : 'Выберите другой период или «Всё время».',
      action: state.data.length ? h('button', {
        class: 'btn btn-secondary', type: 'button',
        onClick: () => { state.q = ''; state.onlyBad = false; renderFilters(); syncUrl(); renderResults(); },
      }, 'Сбросить фильтры') : null,
    })));
    return;
  }

  // Сводка
  let votes = 0; let items = 0; let repeats = 0; let paper = 0;
  for (const m of list) for (const v of m.votes) {
    votes += 1;
    for (const it of v.items) { items += 1; if (it.attempts.some((a) => a.attempt_no > 1)) repeats += 1; if (it.status === 'paper') paper += 1; }
  }
  const stat = (label, value, color) => h('div', { class: 'stat', role: 'listitem' }, h('span', { class: 'overline' }, label), h('b', { style: color ? { color } : null }, String(value)));

  mount(el,
    h('div', { class: 'card stats', role: 'list', 'aria-label': 'Сводка за период' },
      stat('Заседаний', list.length), stat('Голосований', votes), stat('Пунктов', items),
      stat('Повторов', repeats, repeats ? 'var(--c-yellow-text)' : null), stat('На бумаге', paper, paper ? 'var(--c-red-text)' : null)),
    list.map(meetingCard));
}

function meetingCard(m) {
  const open = state.open.has(m.id) || !!state.q || state.onlyBad;
  const p = dateParts(m.held_on);
  const itemsCount = m.votes.reduce((s, v) => s + v.items.length, 0);
  const repeats = m.votes.reduce((s, v) => s + v.items.filter((it) => it.attempts.some((a) => a.attempt_no > 1)).length, 0);
  const paper = m.votes.reduce((s, v) => s + v.items.filter((it) => it.status === 'paper').length, 0);
  const meta = [`Присутствовали ${m.present_count ?? '—'}`, nPlural(m.votes.length, W.vote), nPlural(itemsCount, W.item)];
  if (repeats) meta.push(`${repeats} с повтором`);
  if (paper) meta.push(`${paper} на бумаге`);
  const bodyId = `mb-${m.id}`;
  return h('section', { class: 'card', style: { overflow: 'hidden' }, 'aria-label': `${m.title}, ${fmtDate(m.held_on)}` },
    h('div', { class: 'row', style: { gap: 0, flexWrap: 'nowrap' } },
      h('button', {
        class: 'group-head', type: 'button', 'aria-expanded': String(open), 'aria-controls': bodyId,
        onClick: () => { if (state.open.has(m.id)) state.open.delete(m.id); else state.open.add(m.id); renderResults(); },
      },
      h('span', { class: 'date-tile green' }, h('b', null, p.day), h('span', null, p.mon)),
      h('span', { class: 'g-body' }, h('b', null, `${m.title} · ${fmtDate(m.held_on)}`), h('span', null, meta.join(' · '))),
      icon('chevronDown', { class: 'chev' })),
      h('div', { style: { padding: '0 24px 0 0', flex: 'none' } },
        h('button', {
          class: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': `Выгрузить ${m.title} от ${fmtDate(m.held_on)} в Excel`,
          onClick: (e) => withLoading(e.currentTarget, () => doDownload({ meeting_id: m.id })),
        }, icon('excel'), '.xlsx'))),
    open ? h('div', { class: 'table-scroll', id: bodyId, style: { padding: '0 24px 16px' } }, meetingTable(m)) : null);
}

function meetingTable(m) {
  return h('table', { class: 'table' },
    h('caption', { class: 'sr-only' }, `Итоги ${m.title}`),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Пункт'), h('th', { class: 'c', scope: 'col' }, 'Попытка'), h('th', { class: 'c', scope: 'col' }, 'Присут.'),
      h('th', { class: 'c', scope: 'col' }, 'За'), h('th', { class: 'c', scope: 'col' }, 'Против'), h('th', { class: 'c', scope: 'col' }, 'Возд.'),
      h('th', { class: 'c', scope: 'col' }, 'Всего'), h('th', { scope: 'col' }, 'Итог'))),
    h('tbody', null, m.votes.map((v) => [
      h('tr', { class: 'group' }, h('td', { colspan: '8' }, v.title, h('span', { class: 'muted', style: { fontWeight: 400 } }, ` · ${KIND[v.kind].toLowerCase()}`))),
      v.items.map((it) => (it.attempts.length ? it.attempts : [null]).map((a) => attemptRow(v, it, a))),
    ])));
}

function attemptRow(v, it, a) {
  const name = v.kind === 'batch' ? it.candidate_name : it.text;
  const sub = v.kind === 'batch' ? it.candidate_post : null;
  let result;
  if (it.status === 'paper' && (!a || !a.is_valid)) result = [badge('На бумаге', 'badge-warn'), h('div', { class: 'sub' }, a && a.end_reason === 'stopped' ? 'остановлено секретарём' : 'итог в протоколе')];
  else if (!a) result = badge('Не проводился', 'badge-mute');
  else if (a.is_valid) result = badge('Действительно', 'badge-ok');
  else result = [badge('Недействительно', 'badge-err'), h('div', { class: 'sub' }, a.end_reason === 'stopped' ? 'остановлено' : `${a.total} из ${a.present_count}`)];
  const paperRow = it.status === 'paper' && a && a.end_reason === 'stopped';
  const bad = a && !a.is_valid;
  const n = (x) => (paperRow ? '—' : x);
  return h('tr', { class: bad ? 'is-bad' : '' },
    h('td', null, h('div', { class: 'strong' }, name), sub ? h('div', { class: 'sub' }, sub) : null),
    h('td', { class: 'c', style: { fontWeight: 400 } }, a ? a.attempt_no : '—'),
    h('td', { class: 'c', style: { fontWeight: 400 } }, a ? a.present_count : '—'),
    h('td', { class: 'c' }, a ? n(a.for_count) : '—'),
    h('td', { class: 'c' }, a ? n(a.against_count) : '—'),
    h('td', { class: 'c' }, a ? n(a.abstain_count) : '—'),
    h('td', { class: 'c', style: bad && !paperRow ? { color: 'var(--c-red-text)' } : null }, a ? n(a.total) : '—'),
    h('td', null, result));
}

/* ================= выгрузка ================= */
async function exportCurrent(btn) {
  const params = state.meetingId ? { meeting_id: state.meetingId } : { from: state.from || undefined, to: state.to || undefined };
  await withLoading(btn, () => doDownload(params));
}

async function doDownload(params) {
  try {
    const name = await download(params);
    toast(name ? `Файл «${name}» сохранён` : 'Выгрузка началась');
  } catch (e) { toastError(e, 'Не удалось выгрузить файл'); }
}
