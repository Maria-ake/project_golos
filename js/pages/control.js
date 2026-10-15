/**
 * Пульт управления заседанием (UC-02…UC-06): присутствующие, запуск, ход голосования, остановка, повтор.
 * Опрос сервера раз в секунду. Во время голосования секретарь видит только «получено N из M» (FR-13).
 */
import { h, mount, $, preserveFocus, debounce } from '../dom.js';
import { icon, ringTimer } from '../icons.js';
import { api } from '../api.js';
import { initPage, badge, VOTE_STATUS, MEETING_STATUS, KIND, toast, toastError, confirmDialog, loadingState, errorState, withLoading } from '../ui.js';
import { fmtDate, dateParts, nPlural, W, fmtTimer, shortName, plural } from '../format.js';
import { POLL, ONLINE_WINDOW_MS, COUNCIL_SIZE } from '../config.js';

const main = $('#main');
const meetingId = Number(new URLSearchParams(location.search).get('id'));
const state = {
  meeting: null, devices: [], progress: null, progressAt: 0, screen: null,
  key: '', tick: 0, live: null, presentPending: false,
};

boot();

async function boot() {
  if (!meetingId) { location.replace('meetings.html'); return; }
  mount(main, loadingState('Загружаем заседание…'));
  try {
    await initPage({ active: 'meetings' });
    await refreshAll();
    render(true);
    pollLoop();
    setInterval(updateTimer, 250);
  } catch (e) {
    mount(main, errorState(e, boot));
  } finally {
    main.removeAttribute('aria-busy');
  }
}

/* ================= данные ================= */
const runningVote = () => state.meeting && state.meeting.votes.find((v) => v.status === 'running');

async function refreshAll() {
  const [meeting, devices, screen] = await Promise.all([
    api.meetings.get(meetingId),
    api.devices.list().catch(() => state.devices),
    api.screenState().catch(() => state.screen),
  ]);
  state.meeting = meeting;
  state.devices = devices || [];
  state.screen = screen;
  await refreshProgress();
}

async function refreshProgress() {
  const v = runningVote();
  if (!v) { state.progress = null; return; }
  const p = await api.votes.progress(v.id);
  if (p.status !== 'running') {
    state.progress = null;
    state.meeting = await api.meetings.get(meetingId);
    const finished = state.meeting.votes.find((x) => x.id === v.id);
    if (finished && finished.status === 'finished') {
      toast(finished.invalid_count
        ? `«${finished.title}» завершено. Недействительных пунктов: ${finished.invalid_count}`
        : `«${finished.title}» завершено, итоги на экране`, finished.invalid_count ? 'info' : 'ok', 6000);
    }
  } else {
    state.progress = p;
    state.progressAt = performance.now();
  }
}

async function pollLoop() {
  try {
    state.tick += 1;
    if (state.tick % 3 === 0 || !runningVote()) {
      await refreshAll();
    } else {
      await refreshProgress();
      if (state.tick % 2 === 0) state.screen = await api.screenState().catch(() => state.screen);
    }
    render();
  } catch (e) {
    // соединение пропало — шапка покажет «Нет связи», продолжаем опрос
  } finally {
    setTimeout(pollLoop, POLL.control);
  }
}

/* ================= вычисления ================= */
function onlineDevices() {
  return state.devices.filter((d) => d.is_active && Date.now() - Date.parse(d.last_seen_at) < ONLINE_WINDOW_MS);
}
function lastAttempt(item) { return item.attempts[item.attempts.length - 1] || null; }

function focusVote() {
  const m = state.meeting;
  const run = runningVote();
  if (run) return run;
  if (state.screen && state.screen.vote && ['results', 'stopped'].includes(state.screen.mode)) {
    const v = m.votes.find((x) => x.id === state.screen.vote.id);
    if (v) return v;
  }
  const done = m.votes.filter((v) => ['finished', 'stopped'].includes(v.status) && v.finished_at)
    .sort((a, b) => b.finished_at.localeCompare(a.finished_at));
  return done[0] || null;
}

/* ================= отрисовка ================= */
function structureKey() {
  const m = state.meeting;
  const p = state.progress;
  return JSON.stringify([
    m.status, m.present_count, state.presentPending,
    m.votes.map((v) => [v.id, v.status, v.invalid_count, v.items.map((i) => i.status).join('')]),
    p ? [p.item.id, p.item.attempt_no, p.present] : null,
    state.screen ? [state.screen.mode, state.screen.vote && state.screen.vote.id] : null,
    onlineDevices().map((d) => d.id).join(','), state.devices.length,
  ]);
}

function render(force = false) {
  const key = structureKey();
  if (!force && key === state.key) { updateLive(); return; }
  state.key = key;
  state.live = null;
  preserveFocus(() => mount(main,
    meetingBar(),
    h('div', { class: 'split' },
      h('div', { class: 'main stack' }, liveSection(), queueSection()),
      h('aside', { class: 'side stack', 'aria-label': 'Экран и пульты' }, screenCard(), devicesCard(), helpCard()))));
  updateLive();
  updateScreenMini();
}

/* ---------- верхняя панель заседания ---------- */
function meetingBar() {
  const m = state.meeting;
  const st = MEETING_STATUS[m.status];
  const running = !!runningVote();
  const online = onlineDevices();
  const active = state.devices.filter((d) => d.is_active);
  const locked = running || m.status === 'closed';

  const input = h('input', {
    id: 'present', type: 'number', inputmode: 'numeric', min: 1, max: COUNCIL_SIZE,
    value: m.present_count ?? '', placeholder: '—', disabled: locked,
    'aria-describedby': 'present-hint',
    onInput: (e) => {
      const n = Number(e.target.value);
      if (Number.isInteger(n) && n >= 1 && n <= COUNCIL_SIZE) savePresent(n);
    },
    onBlur: (e) => { e.target.value = state.meeting.present_count ?? ''; },
  });
  const step = (d) => {
    const cur = state.meeting.present_count || (d > 0 ? 0 : COUNCIL_SIZE + 1);
    const n = Math.max(1, Math.min(COUNCIL_SIZE, cur + d));
    input.value = n;
    savePresent(n);
  };

  return h('section', { class: 'card meeting-bar', 'aria-label': 'Заседание' },
    h('div', { class: 'mb-title' },
      h('a', { class: 'back-link', href: `meetings.html?id=${m.id}` }, icon('chevronLeft'), 'Все заседания'),
      h('div', { class: 'row', style: { gap: '12px' } },
        h('h1', { style: { fontSize: '28px', lineHeight: 1.2 } }, `${m.title} · ${fmtDate(m.held_on, { year: false })}`),
        badge(st.text, m.status === 'open' ? 'badge-ok' : st.cls, { dot: m.status === 'open', pulse: m.status === 'open' }))),
    h('div', { class: 'mb-cell' },
      h('label', { class: 'mb-label', for: 'present', id: 'present-label' }, 'Присутствуют'),
      h('div', { class: 'row', style: { gap: '10px' } },
        h('div', { class: 'stepper', role: 'group', 'aria-labelledby': 'present-label' },
          h('button', { type: 'button', 'aria-label': 'Уменьшить', disabled: locked, onClick: () => step(-1) }, icon('minus')),
          input,
          h('button', { type: 'button', 'aria-label': 'Увеличить', disabled: locked, onClick: () => step(1) }, icon('plus'))),
        h('span', { class: 'muted' }, `из ${COUNCIL_SIZE}`)),
      h('span', { class: 'tiny', id: 'present-hint', style: { color: !m.present_count && m.status !== 'closed' ? 'var(--c-red-text)' : 'var(--c-text-2)' } },
        running ? 'Нельзя менять во время голосования'
          : !m.present_count ? 'Укажите до запуска голосования'
            : state.presentPending ? 'Сохраняем…' : 'Сохранено')),
    h('div', { class: 'mb-cell' },
      h('span', { class: 'mb-label' }, 'Пульты на связи'),
      h('div', { class: 'row', style: { gap: '8px', minHeight: '44px' } },
        h('b', { style: { fontSize: '20px' } }, String(online.length)),
        h('span', { class: 'muted' }, `из ${active.length}`),
        m.present_count && online.length < m.present_count ? badge('меньше, чем присутствующих', 'badge-warn') : null)),
    h('div', { class: 'row', style: { gap: '12px' } },
      m.status === 'planned' ? h('button', {
        class: 'btn btn-primary', type: 'button', id: 'open-meeting',
        onClick: (e) => withLoading(e.currentTarget, async () => {
          try { await api.meetings.update(m.id, { status: 'open' }); await refreshAll(); render(true); toast('Заседание открыто'); } catch (err) { toastError(err); }
        }),
      }, icon('play'), 'Открыть заседание') : null,
      m.status === 'open' ? h('button', {
        class: 'btn btn-secondary', type: 'button', id: 'show-agenda', disabled: running,
        title: running ? 'Во время голосования экран показывает голосование' : null,
        onClick: (e) => withLoading(e.currentTarget, async () => {
          try { await api.meetings.showAgenda(m.id); state.screen = await api.screenState(); render(true); toast('Повестка на экране'); } catch (err) { toastError(err); }
        }),
      }, icon('presentation'), 'Показать повестку') : null,
      m.status === 'open' && !running ? h('button', { class: 'btn btn-ghost', type: 'button', id: 'close-meeting', onClick: closeMeeting }, 'Завершить заседание') : null));
}

const savePresentNow = async (n) => {
  try {
    state.meeting = await api.meetings.update(meetingId, { present_count: n });
  } catch (e) {
    toastError(e);
    state.meeting = await api.meetings.get(meetingId).catch(() => state.meeting);
  } finally {
    state.presentPending = false;
    render();
  }
};
const savePresentDebounced = debounce(savePresentNow, 500);
function savePresent(n) {
  state.meeting.present_count = n;
  state.presentPending = true;
  render();
  savePresentDebounced(n);
}

/* ---------- центральная карточка ---------- */
function liveSection() {
  const m = state.meeting;
  const run = runningVote();
  if (run) return state.progress ? runningCard(run) : loadingState('Подключаемся к голосованию…');
  const fv = focusVote();
  if (fv) return resultsCard(fv);
  if (m.status === 'planned') {
    return h('section', { class: 'card card-pad stack' },
      h('div', { class: 'alert alert-info' }, icon('info'), h('div', { class: 'alert-body' },
        h('b', null, 'Заседание ещё не открыто'),
        h('span', null, 'Нажмите «Открыть заседание», укажите число присутствующих и раздайте пульты в случайном порядке.'))));
  }
  if (m.status === 'closed') {
    return h('section', { class: 'card card-pad stack' },
      h('div', { class: 'alert alert-ok' }, icon('check'), h('div', { class: 'alert-body' },
        h('b', null, 'Заседание завершено'),
        h('span', null, 'Итоги — в истории голосований, там же выгрузка в Excel.'))),
      h('div', null, h('a', { class: 'btn btn-secondary', href: `history.html?meeting=${m.id}` }, icon('history'), 'Открыть историю')));
  }
  return h('section', { class: 'card card-pad stack' },
    h('h2', null, 'Всё готово к голосованию'),
    h('ol', { class: 'stack-s', style: { paddingLeft: '20px', fontSize: '16px' } },
      h('li', null, m.present_count ? `Присутствуют ${m.present_count} — проверьте число.` : 'Укажите число присутствующих вверху.'),
      h('li', null, 'Раздайте пульты в случайном порядке и не записывайте, кому какой.'),
      h('li', null, 'Нажмите «Запустить» у нужного голосования ниже.')));
}

function runningCard(v) {
  const p = state.progress;
  const isBatch = v.kind === 'batch';
  const ring = ringTimer();
  const cells = h('div', { class: 'cells', 'aria-hidden': 'true' }, Array.from({ length: p.present }, () => h('span')));
  const received = h('b', { class: 'num', style: { fontSize: '32px', fontWeight: 700 } });
  state.live = { ring, cells, received, total: p.item_seconds };

  const kicker = isBatch
    ? (p.is_repeat ? `Повтор · кандидатура ${p.current_position} из ${p.total_items} · попытка ${p.item.attempt_no}` : `Кандидатура ${p.current_position} из ${p.total_items}`)
    : (p.is_repeat ? `Повтор · попытка ${p.item.attempt_no}` : 'Вопрос');

  const pills = isBatch ? h('ol', { class: 'pills', 'aria-label': 'Ход пакета' },
    v.items.map((it) => {
      const cur = it.id === p.item.id;
      const cls = cur ? 'cur' : it.status === 'pending' ? '' : it.status === 'paper' ? 'paper' : 'done';
      return h('li', { class: `pill ${cls}`, 'aria-current': cur ? 'step' : null, 'aria-label': `Пункт ${it.position}${cur ? ' — идёт' : it.status === 'pending' ? ' — ожидает' : ' — закрыт'}` }, String(it.position));
    })) : null;

  return h('section', { class: 'card card-pad is-live stack', style: { gap: '28px' }, 'aria-label': 'Текущее голосование' },
    h('div', { class: 'row-between', style: { alignItems: 'flex-start' } },
      h('div', { class: 'stack-s' },
        badge(`Идёт · ${KIND[v.kind].toLowerCase()}`, 'badge-live', { dot: true, pulse: true }),
        h('h2', null, v.title)),
      h('button', { class: 'btn btn-danger', type: 'button', id: 'stop-vote', onClick: () => stopVote(v) }, icon('stop'), 'Остановить')),
    h('div', { class: 'live-grid' },
      h('div', { class: 'live-info' },
        h('div', { class: 'stack-s', style: { gap: '6px' } },
          h('span', { class: 'overline' }, kicker),
          isBatch
            ? [h('div', { class: 'live-name' }, p.item.candidate_name), h('div', { class: 'live-post' }, p.item.candidate_post)]
            : h('div', { class: 'live-name', style: { fontSize: '26px' } }, p.item.text)),
        h('div', { class: 'stack-s', style: { gap: '10px' } },
          h('div', { class: 'row', style: { gap: '10px', alignItems: 'baseline' } },
            h('span', { style: { fontWeight: 500 } }, 'Получено голосов'),
            received,
            h('span', { class: 'muted', style: { fontSize: '18px' } }, `из ${p.present}`)),
          cells,
          h('div', { class: 'note' }, icon('lock', { color: 'rgba(0,0,0,.6)' }),
            h('span', null, isBatch ? 'Разбивка «За / Против / Воздержался» скрыта до конца пакета' : 'Разбивка появится после окончания таймера')))),
      ring.el),
    isBatch ? h('div', { class: 'stack-s', style: { gap: '12px', paddingTop: '20px', borderTop: '1px solid var(--c-divider)' } },
      h('div', { class: 'row-between small muted' }, h('span', null, 'Пункты переключаются автоматически'), h('span', null, 'Итоги по всем — после последнего пункта')),
      pills) : null);
}

function updateLive() {
  const p = state.progress;
  if (!p || !state.live) return;
  state.live.received.textContent = String(p.received);
  Array.from(state.live.cells.children).forEach((c, i) => c.classList.toggle('on', i < p.received));
  updateTimer();
  updateScreenMini();
}

function updateTimer() {
  const p = state.progress;
  if (!p || !state.live) return;
  const left = Math.max(0, p.seconds_left - (performance.now() - state.progressAt) / 1000);
  state.live.ring.set(left, p.item_seconds);
}

function itemTitle(v, it) {
  return v.kind === 'batch' ? it.candidate_name : it.text;
}

function resultsCard(v) {
  const invalid = v.items.filter((i) => i.status === 'invalid');
  const pending = v.items.filter((i) => i.status === 'pending');
  const onScreen = state.screen && state.screen.vote && state.screen.vote.id === v.id && ['results', 'stopped'].includes(state.screen.mode);
  const m = state.meeting;
  const stopped = v.status === 'stopped';

  let head;
  if (stopped) head = badge('Остановлено', 'badge-err');
  else if (invalid.length) head = badge(`Завершено · недействительных: ${invalid.length}`, 'badge-warn');
  else head = badge('Завершено · все пункты действительны', 'badge-ok');

  const single = v.kind === 'single' && v.items[0];
  const a = single ? lastAttempt(v.items[0]) : null;

  return h('section', { class: 'card card-pad stack' + (stopped ? ' is-danger' : ''), 'aria-label': 'Итоги голосования' },
    h('div', { class: 'row-between', style: { alignItems: 'flex-start' } },
      h('div', { class: 'stack-s' }, head, h('h2', null, v.title)),
      h('button', {
        class: 'btn btn-secondary', type: 'button', id: 'show-results', disabled: onScreen || !!runningVote(),
        onClick: (e) => withLoading(e.currentTarget, async () => {
          try { await api.votes.showResults(v.id); state.screen = await api.screenState(); render(true); toast('Итоги на экране'); } catch (err) { toastError(err); }
        }),
      }, icon('presentation'), onScreen ? 'Итоги на экране' : 'Показать на экране')),
    single && a ? h('div', { class: 'big-results' },
      h('div', null, h('span', { class: 'overline' }, 'За'), h('b', { style: { color: 'var(--c-green-text)' } }, a.for_count)),
      h('div', null, h('span', { class: 'overline' }, 'Против'), h('b', { style: { color: 'var(--c-red-text)' } }, a.against_count)),
      h('div', null, h('span', { class: 'overline' }, 'Воздержался'), h('b', { style: { color: 'var(--c-yellow-text)' } }, a.abstain_count)),
      h('div', null, h('span', { class: 'overline' }, 'Всего'), h('b', null, `${a.total}`), h('span', { class: 'small muted' }, `из ${a.present_count}`)))
      : resultsTable(v),
    invalid.length && m.status === 'open' && stopped ? h('div', { class: 'alert alert-err', style: { alignItems: 'center', flexWrap: 'wrap' } }, icon('alert'),
      h('div', { class: 'alert-body', style: { flex: '1 1 300px' } },
        h('b', null, 'Голосование остановлено аварийно'),
        h('span', null, 'По ТЗ дальше — бумажные бюллетени. Отметьте пункты «На бумаге» и внесите итог в протокол вручную.')),
      h('button', { class: 'btn btn-accent', type: 'button', id: 'to-paper', onClick: () => toPaper(v) }, icon('paper'), 'Отметить «На бумаге»'))
      : null,
    invalid.length && m.status === 'open' && !stopped ? h('div', { class: 'alert alert-warn', style: { alignItems: 'center', flexWrap: 'wrap' } }, icon('alert'),
      h('div', { class: 'alert-body', style: { flex: '1 1 300px' } },
        h('b', null, `${nPlural(invalid.length, W.item)} ${plural(invalid.length, ['недействителен', 'недействительны', 'недействительны'])}`),
        h('span', null, invalid.slice(0, 3).map((it) => {
          const at = lastAttempt(it);
          return `${shortName(itemTitle(v, it)) || 'Вопрос'}: ${at ? `${at.total} из ${at.present_count}` : 'остановлено'}`;
        }).join('; ') + '. Повторите новой попыткой или проведите на бумаге.')),
      h('div', { class: 'row', style: { gap: '12px' } },
        h('button', { class: 'btn btn-ghost', type: 'button', id: 'to-paper', onClick: () => toPaper(v) }, icon('paper'), 'На бумаге'),
        h('button', { class: 'btn btn-accent', type: 'button', id: 'repeat', disabled: !!runningVote(), onClick: (e) => repeatVote(e.currentTarget, v) }, icon('replay'), `Повторить недействительные (${invalid.length})`)))
      : null,
    stopped && pending.length ? h('p', { class: 'muted' }, `Не проведено пунктов: ${pending.length}. Их нужно провести на бумаге.`) : null);
}

function resultsTable(v) {
  const statusBadge = (it, a) => {
    if (it.status === 'paper') return badge('На бумаге', 'badge-warn');
    if (it.status === 'pending') return badge('Не проводился', 'badge-mute');
    if (!a) return badge(it.status === 'invalid' ? 'Остановлен' : '—', it.status === 'invalid' ? 'badge-err' : 'badge-mute');
    return a.is_valid ? badge('Действительно', 'badge-ok') : badge(a.end_reason === 'stopped' ? 'Остановлен' : 'Недействительно', 'badge-err');
  };
  return h('div', { class: 'table-scroll' }, h('table', { class: 'table' },
    h('caption', { class: 'sr-only' }, `Итоги: ${v.title}`),
    h('thead', null, h('tr', null,
      h('th', { class: 'c', scope: 'col' }, '№'), h('th', { scope: 'col' }, v.kind === 'batch' ? 'Кандидатура' : 'Вопрос'),
      h('th', { class: 'c', scope: 'col' }, 'За'), h('th', { class: 'c', scope: 'col' }, 'Против'), h('th', { class: 'c', scope: 'col' }, 'Возд.'),
      h('th', { class: 'c', scope: 'col' }, 'Всего'), h('th', { scope: 'col' }, 'Итог'))),
    h('tbody', null, v.items.map((it) => {
      const last = lastAttempt(it);
      // Неполный счёт остановленной попытки не показываем — он ничего не значит и только путает.
      const a = last && last.end_reason === 'stopped' ? null : last;
      const bad = it.status === 'invalid';
      return h('tr', { class: bad ? 'is-bad' : '' },
        h('td', { class: 'c', style: { fontWeight: 400 } }, String(it.position)),
        h('td', null,
          h('div', { class: 'strong' }, itemTitle(v, it)),
          v.kind === 'batch' ? h('div', { class: 'sub' }, it.candidate_post, a && a.attempt_no > 1 ? ` · попытка ${a.attempt_no}` : '') : null),
        h('td', { class: 'c' }, a ? a.for_count : '—'),
        h('td', { class: 'c' }, a ? a.against_count : '—'),
        h('td', { class: 'c' }, a ? a.abstain_count : '—'),
        h('td', { class: 'c', style: bad ? { color: 'var(--c-red-text)' } : null }, a ? `${a.total}/${a.present_count}` : '—'),
        h('td', null, statusBadge(it, a)));
    }))));
}

/* ---------- очередь голосований ---------- */
function queueSection() {
  const m = state.meeting;
  return h('section', { class: 'stack-s', style: { gap: '12px' }, 'aria-labelledby': 'queue-t' },
    h('div', { class: 'row-between' },
      h('h3', { id: 'queue-t' }, 'Голосования заседания'),
      m.status !== 'closed' ? h('a', { href: `editor.html?meeting=${m.id}`, class: 'small' }, '+ Добавить голосование') : null),
    m.votes.length ? m.votes.map((v, i) => queueRow(v, i)) : h('p', { class: 'muted' }, 'Голосований нет. Добавьте их на странице заседания.'));
}

function startBlocker(v) {
  const m = state.meeting;
  if (v.status === 'draft') return 'Черновик — дополните в редакторе';
  if (m.status !== 'open') return 'Сначала откройте заседание';
  if (!m.present_count) return 'Укажите число присутствующих';
  if (state.presentPending) return 'Сохраняем число присутствующих…';
  if (runningVote()) return 'После окончания текущего';
  if (v.status === 'draft') return 'Черновик — дополните в редакторе';
  return null;
}

function queueRow(v, i) {
  const st = VOTE_STATUS[v.status];
  const meta = v.kind === 'batch' ? `${KIND.batch} · ${nPlural(v.items_count, W.candidate)} · по ${v.item_seconds} с` : `${KIND.single} · ${v.item_seconds} с`;
  let right;
  if (v.status === 'ready' || v.status === 'draft') {
    const why = startBlocker(v);
    const hintId = `why-${v.id}`;
    right = h('div', { class: 'stack-s', style: { alignItems: 'flex-end', gap: '4px' } },
      v.status === 'draft'
        ? h('a', { class: 'btn btn-secondary', href: `editor.html?meeting=${v.meeting_id}&vote=${v.id}` }, 'Дополнить')
        : h('button', {
          class: 'btn btn-primary', type: 'button', id: `start-${v.id}`, disabled: !!why,
          'aria-describedby': hintId, onClick: (e) => startVote(e.currentTarget, v),
        }, icon('play'), 'Запустить'),
      h('span', { class: 'tiny muted', id: hintId }, why || `Присутствуют ${state.meeting.present_count}`));
  } else if (v.status === 'running') {
    right = badge('Идёт', 'badge-live', { dot: true, pulse: true });
  } else {
    const inv = v.invalid_count;
    right = h('div', { class: 'row', style: { gap: '8px' } },
      v.status === 'stopped' ? badge('Остановлено', 'badge-err') : inv ? badge(`Недействительных: ${inv}`, 'badge-warn') : badge('Действительно', 'badge-ok'),
      h('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', disabled: !!runningVote(),
        onClick: (e) => withLoading(e.currentTarget, async () => {
          try { await api.votes.showResults(v.id); state.screen = await api.screenState(); render(true); toast('Итоги на экране'); } catch (err) { toastError(err); }
        }),
      }, 'Итог на экран'));
  }
  const pillCls = v.status === 'running' ? 'cur' : ['finished', 'stopped'].includes(v.status) ? 'done' : '';
  return h('div', { class: 'vrow' + (v.status === 'running' ? ' is-live' : '') },
    h('span', { class: `pill sm ${pillCls}`, 'aria-hidden': 'true' }, String(i + 1)),
    h('div', { class: 'v-body' }, h('b', null, v.title), h('span', null, meta)),
    v.status === 'draft' ? badge(st.text, st.cls) : null,
    right);
}

/* ---------- боковая колонка ---------- */
function screenCard() {
  return h('section', { class: 'card card-pad-m stack-s', style: { gap: '14px' }, 'aria-labelledby': 'scr-t' },
    h('div', { class: 'row-between' }, h('h3', { id: 'scr-t', style: { fontSize: '18px' } }, 'Экран проектора'),
      h('a', { href: 'screen.html', target: '_blank', rel: 'noopener', class: 'small' }, 'Открыть экран')),
    h('div', { class: 'mini-screen', id: 'mini-screen', 'aria-live': 'off' }),
    h('span', { class: 'small muted' }, 'Экран переключается сам: повестка → голосование → итоги. Счётчики во время голосования не показываются.'));
}

function updateScreenMini() {
  const el = $('#mini-screen');
  if (!el) return;
  const s = state.screen || { mode: 'idle' };
  let k = 'Ожидание'; let mm = 'Учёный совет ИШИТР'; let sub = ''; let t = '';
  if (s.mode === 'agenda') { k = 'Повестка'; mm = s.meeting ? s.meeting.title : ''; sub = nPlural(s.votes.length, W.vote); }
  if (s.mode === 'voting') {
    k = s.vote.kind === 'batch' ? `Кандидатура ${s.item.position} из ${s.item.total}` : s.vote.title;
    mm = s.vote.kind === 'batch' ? s.item.candidate_name : s.item.text;
    sub = s.vote.kind === 'batch' ? s.item.candidate_post : 'За · Против · Воздержался';
    const p = state.progress;
    t = p ? fmtTimer(Math.max(0, p.seconds_left - (performance.now() - state.progressAt) / 1000)) : fmtTimer(s.seconds_left);
  }
  if (s.mode === 'results') { k = 'Итоги'; mm = s.vote.title; sub = s.vote.kind === 'batch' ? `Сводная таблица · ${nPlural(s.items.length, W.candidate)}` : 'За · Против · Воздержался'; }
  if (s.mode === 'stopped') { k = 'Голосование остановлено'; mm = s.vote.title; sub = 'Переходим на бумажные бюллетени'; }
  mount(el,
    h('div', { class: 'k' }, h('span', null, k), s.mode === 'voting' ? h('span', { class: 'live' }, 'идёт') : null),
    h('div', null, h('div', { class: 'm' }, mm), h('div', { class: 's' }, sub)),
    h('div', { class: 'b' }, h('span'), h('span', { class: 't' }, t)));
}

function devicesCard() {
  const active = state.devices.filter((d) => d.is_active).sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }));
  const online = new Set(onlineDevices().map((d) => d.id));
  return h('section', { class: 'card card-pad-m stack-s', style: { gap: '14px' }, 'aria-labelledby': 'dev-t' },
    h('div', { class: 'row-between' }, h('h3', { id: 'dev-t', style: { fontSize: '18px' } }, 'Пульты'),
      h('span', { class: 'small muted' }, `${online.size} из ${active.length} на связи`)),
    active.length ? h('ul', { class: 'dev-grid', 'aria-label': 'Статус пультов' },
      active.map((d) => {
        const on = online.has(d.id);
        const n = d.label.replace(/\D+/g, '') || d.label;
        return h('li', { class: on ? '' : 'off', title: on ? `${d.label}: на связи` : `${d.label}: нет связи` },
          h('span', { 'aria-hidden': 'true' }, n), h('span', { class: 'sr-only' }, `${d.label}: ${on ? 'на связи' : 'нет связи'}`));
      })) : h('p', { class: 'small muted' }, 'Пульты не зарегистрированы.'),
    h('div', { class: 'note' }, icon('shieldLock'), h('span', null, 'Раздавайте пульты в случайном порядке и не записывайте, кому какой достался.')));
}

function helpCard() {
  return h('section', { class: 'stack-s', style: { padding: '0 8px' }, 'aria-labelledby': 'fail-t' },
    h('h3', { id: 'fail-t', style: { fontSize: '16px' } }, 'Если система дала сбой'),
    h('ol', { class: 'small muted', style: { paddingLeft: '20px', lineHeight: 1.6 } },
      h('li', null, 'Нажмите «Остановить» — пункт станет недействительным.'),
      h('li', null, 'Раздайте бумажные бюллетени.'),
      h('li', null, 'Итог внесите в протокол вручную, в системе отметьте «На бумаге».')));
}

/* ================= действия ================= */
async function startVote(btn, v) {
  const m = state.meeting;
  const online = onlineDevices().length;
  if (online < m.present_count) {
    const ok = await confirmDialog({
      title: 'Пультов на связи меньше, чем присутствующих',
      text: `На связи ${online}, присутствуют ${m.present_count}. Кто-то не сможет проголосовать, и пункт станет недействительным. Всё равно запустить?`,
      ok: 'Запустить',
    });
    if (!ok) return;
  }
  await withLoading(btn, async () => {
    try {
      await api.votes.start(v.id);
      await refreshAll();
      render(true);
      const stop = $('#stop-vote');
      if (stop) stop.focus();
    } catch (e) { toastError(e); }
  });
}

async function stopVote(v) {
  const ok = await confirmDialog({
    title: 'Остановить голосование?',
    text: 'Текущий пункт станет недействительным, остальные не будут проведены. Дальше — бумажные бюллетени.',
    ok: 'Да, остановить',
    cancel: 'Продолжить голосование',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.votes.stop(v.id);
    await refreshAll();
    render(true);
    toast('Голосование остановлено', 'info');
  } catch (e) { toastError(e); }
}

async function repeatVote(btn, v) {
  await withLoading(btn, async () => {
    try {
      await api.votes.repeat(v.id);
      await refreshAll();
      render(true);
    } catch (e) { toastError(e); }
  });
}

async function toPaper(v) {
  const ok = await confirmDialog({
    title: 'Провести на бумаге?',
    text: 'Недействительные и непроведённые пункты будут отмечены «На бумаге». Итог по ним внесите в протокол вручную.',
    ok: 'Отметить',
  });
  if (!ok) return;
  try {
    await api.votes.paper(v.id);
    await refreshAll();
    render(true);
  } catch (e) { toastError(e); }
}

async function closeMeeting() {
  const notDone = state.meeting.votes.filter((v) => ['draft', 'ready'].includes(v.status)).length;
  const ok = await confirmDialog({
    title: 'Завершить заседание?',
    text: notDone
      ? `Не проведено голосований: ${notDone}. После завершения их нельзя будет запустить.`
      : 'Итоги останутся в истории, экран вернётся в режим ожидания.',
    ok: 'Завершить',
  });
  if (!ok) return;
  try {
    await api.meetings.update(meetingId, { status: 'closed' });
    await refreshAll();
    render(true);
    toast('Заседание завершено');
  } catch (e) { toastError(e); }
}
