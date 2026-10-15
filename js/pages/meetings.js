/** Заседания: список по датам и подготовка выбранного заседания (FR-01, FR-02, UC-01). */
import { h, mount, $, preserveFocus, nextId } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import {
  initPage, badge, VOTE_STATUS, MEETING_STATUS, KIND, toast, toastError, openDialog, confirmDialog,
  loadingState, errorState, emptyState, makeSortable, moveItem, withLoading,
} from '../ui.js';
import { fmtDate, dateParts, daysUntil, nPlural, W, fmtDuration, toISODate, academicYear, parseDate } from '../format.js';
import { ONLINE_WINDOW_MS } from '../config.js';

const main = $('#main');
const state = { user: null, meetings: [], selectedId: null, detail: null, devices: null, loadingDetail: false };

boot();

async function boot() {
  mount(main, loadingState());
  try {
    state.user = await initPage({ active: 'meetings' });
    await loadList();
  } catch (e) {
    mount(main, errorState(e, boot));
  } finally {
    main.removeAttribute('aria-busy');
  }
}

async function loadList(preferId) {
  state.meetings = await api.meetings.list();
  const fromUrl = Number(new URLSearchParams(location.search).get('id'));
  const exists = (id) => state.meetings.some((m) => m.id === id);
  state.selectedId = [preferId, fromUrl, state.selectedId].find((id) => id && exists(id)) || pickDefault();
  await loadDetail();
}

/** Ближайшее незавершённое заседание, иначе последнее проведённое. */
function pickDefault() {
  const ms = state.meetings;
  const open = ms.find((m) => m.status === 'open');
  if (open) return open.id;
  const today = toISODate(new Date());
  const planned = ms.filter((m) => m.status === 'planned').sort((a, b) => a.held_on.localeCompare(b.held_on));
  const upcoming = planned.find((m) => m.held_on >= today) || planned[planned.length - 1];
  if (upcoming) return upcoming.id;
  const closed = ms.filter((m) => m.status === 'closed').sort((a, b) => b.held_on.localeCompare(a.held_on));
  return closed[0] ? closed[0].id : null;
}

async function loadDetail() {
  if (!state.selectedId) { state.detail = null; render(); return; }
  state.loadingDetail = true;
  render();
  const [detail, devices] = await Promise.all([
    api.meetings.get(state.selectedId),
    api.devices.list().catch(() => null),
  ]);
  state.detail = detail;
  state.devices = devices;
  state.loadingDetail = false;
  const url = new URL(location.href);
  url.searchParams.set('id', state.selectedId);
  history.replaceState(null, '', url);
  render();
}

/* ================= отрисовка ================= */
function render() {
  preserveFocus(() => mount(main,
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('span', { class: 'overline' }, `${academicYear().label} учебный год · сентябрь — июнь`),
        h('h1', null, 'Заседания')),
      h('button', { class: 'btn btn-primary', type: 'button', id: 'new-meeting', onClick: () => meetingDialog() }, icon('plus'), 'Новое заседание')),
    state.meetings.length
      ? h('div', { class: 'split' }, renderList(), renderDetail())
      : h('div', { class: 'card' }, emptyState({
        title: 'Заседаний пока нет',
        text: 'Создайте заседание, добавьте в него голосования — и в день совета останется только нажать «Запустить».',
        action: h('button', { class: 'btn btn-primary', type: 'button', onClick: () => meetingDialog() }, icon('plus'), 'Новое заседание'),
      }))));
}

function renderList() {
  const ms = state.meetings;
  const open = ms.filter((m) => m.status === 'open');
  const planned = ms.filter((m) => m.status === 'planned').sort((a, b) => a.held_on.localeCompare(b.held_on));
  const closed = ms.filter((m) => m.status === 'closed').sort((a, b) => b.held_on.localeCompare(a.held_on));
  const group = (title, list) => (list.length ? [h('div', { class: 'overline' }, title), list.map(listItem)] : null);
  return h('aside', { class: 'card side mlist', 'aria-label': 'Список заседаний' },
    group('Идёт сейчас', open),
    group('Запланированы', planned),
    group('Проведены', closed.slice(0, 5)),
    closed.length ? h('a', { href: 'history.html', style: { padding: '12px 16px 4px', fontSize: '15px', fontWeight: 500 } }, 'Все итоги — в истории') : null);
}

function listItem(m) {
  const p = dateParts(m.held_on);
  let b = null;
  if (m.status === 'open') b = badge('Идёт', 'badge-live', { dot: true, pulse: true });
  else if (m.status === 'closed') b = badge('Проведено', 'badge-ok');
  else {
    const d = daysUntil(m.held_on);
    if (d === 0) b = badge('Сегодня', 'badge-ok');
    else if (d === 1) b = badge('Завтра', 'badge-info');
    else if (d > 1 && d <= 30) b = badge(`через ${d} ${d % 10 === 1 && d !== 11 ? 'день' : 'дн.'}`, 'badge-info');
    else if (d < 0) b = badge('Дата прошла', 'badge-warn');
  }
  return h('button', {
    class: 'mitem', type: 'button', id: `m-${m.id}`,
    'aria-current': m.id === state.selectedId ? 'true' : 'false',
    onClick: () => { if (m.id !== state.selectedId) { state.selectedId = m.id; loadDetail().catch((e) => toastError(e)); } },
  },
  h('span', { class: 'date-tile' }, h('b', null, p.day), h('span', null, p.mon)),
  h('span', { class: 'm-body' },
    h('b', null, m.title),
    h('span', null, `${p.wd} · ${m.votes_count ? nPlural(m.votes_count, W.vote) : 'голосований пока нет'}`),
    b ? h('span', { class: 'm-badge' }, b) : null));
}

function renderDetail() {
  const m = state.detail;
  if (!m || state.loadingDetail && (!m || m.id !== state.selectedId)) {
    return h('section', { class: 'card main', 'aria-busy': 'true' }, loadingState('Загружаем заседание…'));
  }
  const p = dateParts(m.held_on);
  const st = MEETING_STATUS[m.status];
  const editable = m.status !== 'closed';
  return h('section', { class: 'card card-pad main stack', 'aria-labelledby': 'mtitle', style: { gap: '28px' } },
    h('div', { class: 'row-between', style: { alignItems: 'flex-start' } },
      h('div', { class: 'stack-s' },
        h('div', { class: 'row', style: { gap: '12px' } },
          h('span', { class: 'overline' }, `${p.weekday} · ${fmtDate(m.held_on)}`),
          badge(st.text, st.cls)),
        h('h2', { id: 'mtitle', style: { fontSize: '28px', fontWeight: 700 } }, m.title)),
      editable ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', id: 'edit-meeting', onClick: () => meetingDialog(m) }, icon('pencil'), 'Изменить') : null),
    m.status === 'closed' ? closedPanel(m) : readinessPanel(m),
    votesSection(m));
}

function readinessPanel(m) {
  const votes = m.votes;
  const ready = votes.filter((v) => v.status === 'ready').length;
  const drafts = votes.filter((v) => v.status === 'draft');
  const checks = [];
  if (!votes.length) checks.push(['bad', 'alert', 'Голосований нет — добавьте хотя бы одно']);
  else if (drafts.length) checks.push(['warn', 'alert', `${ready} из ${votes.length} голосований готовы, ${nPlural(drafts.length, ['черновик', 'черновика', 'черновиков'])} — дополните`]);
  else checks.push(['ok', 'check', `Все ${nPlural(votes.length, W.vote)} готовы к запуску`]);

  if (state.devices) {
    const active = state.devices.filter((d) => d.is_active);
    const online = active.filter((d) => Date.now() - Date.parse(d.last_seen_at) < ONLINE_WINDOW_MS);
    const off = active.filter((d) => !online.includes(d));
    checks.push(off.length
      ? ['warn', 'alert', `${online.length} из ${active.length} пультов на связи — не отвечает: ${off.map((d) => d.label.replace('Пульт ', '№')).join(', ')}`]
      : ['ok', 'check', `Все ${active.length} пультов на связи`]);
  }
  checks.push(['ok', 'info', 'Число присутствующих вы укажете в пульте управления']);

  const cta = m.status === 'open'
    ? h('a', { class: 'btn btn-primary btn-lg', href: `control.html?id=${m.id}` }, icon('play'), 'Перейти к пульту управления')
    : h('button', {
      class: 'btn btn-primary btn-lg', type: 'button', id: 'open-meeting',
      onClick: (e) => withLoading(e.currentTarget, async () => {
        try {
          await api.meetings.update(m.id, { status: 'open' });
          location.href = `control.html?id=${m.id}`;
        } catch (err) { toastError(err); }
      }),
    }, icon('play'), 'Открыть заседание');

  return h('div', { class: 'inner row-between', style: { alignItems: 'center', gap: '24px' } },
    h('ul', { class: 'checklist', 'aria-label': 'Готовность к заседанию' },
      checks.map(([cls, ic, text]) => h('li', { class: cls }, icon(ic), h('span', null, text)))),
    h('div', { class: 'stack-s', style: { alignItems: 'flex-start' } },
      cta,
      m.status === 'planned' ? h('span', { class: 'tiny muted' }, 'Статус сменится на «Идёт», экран покажет повестку по кнопке') : null));
}

function closedPanel(m) {
  const done = m.votes.filter((v) => ['finished', 'stopped'].includes(v.status)).length;
  return h('div', { class: 'inner row-between' },
    h('div', { class: 'stack-s' },
      h('b', { style: { fontSize: '17px' } }, 'Заседание проведено'),
      h('span', { class: 'muted' }, `${nPlural(done, W.vote)} с итогами. Изменить их нельзя — только выгрузить.`)),
    h('a', { class: 'btn btn-secondary', href: `history.html?meeting=${m.id}` }, icon('history'), 'Итоги в истории'));
}

function voteMeta(v) {
  if (v.kind === 'single') return `${KIND.single} · ${v.item_seconds} с`;
  const total = v.items_count * v.item_seconds;
  return `${KIND.batch} · ${nPlural(v.items_count, W.candidate)} · по ${v.item_seconds} с · около ${fmtDuration(total)}`;
}

function votesSection(m) {
  const canEdit = m.status !== 'closed';
  const canSort = canEdit && !m.votes.some((v) => v.status === 'running') && m.votes.length > 1;
  const list = h('div', { class: 'stack-s', id: 'votes-list', role: 'list', 'aria-label': 'Голосования заседания' },
    m.votes.map((v, i) => voteRow(v, i, canSort)));
  if (canSort) {
    makeSortable(list, {
      itemSelector: '.vrow',
      handleSelector: '.grip',
      onReorder: (from, to) => reorder(from, to),
    });
  }
  return h('div', { class: 'stack-s', style: { gap: '12px' } },
    h('div', { class: 'row-between' },
      h('h3', null, 'Голосования ', h('span', { class: 'muted', style: { fontWeight: 500 } }, `· ${m.votes.length}`)),
      canSort ? h('span', { class: 'small muted' }, 'Порядок на экране = порядок в списке. Перетащите за ручку или стрелками ↑ ↓.') : null),
    m.votes.length ? list : h('p', { class: 'muted' }, 'В этом заседании пока нет голосований.'),
    canEdit ? h('a', { class: 'add-tile', href: `editor.html?meeting=${m.id}` },
      icon('docPlus'), 'Добавить голосование', h('span', { class: 'muted' }, '— одиночное или пакетное')) : null);
}

function voteRow(v, i, canSort) {
  const st = VOTE_STATUS[v.status];
  const hasProblems = v.status === 'draft' && v.problems.length;
  const editable = ['draft', 'ready'].includes(v.status);
  const statusBadge = v.status === 'finished' && v.invalid_count
    ? badge(`Недействительных: ${v.invalid_count}`, 'badge-warn')
    : badge(st.text, st.cls, { dot: v.status === 'ready' || v.status === 'running', pulse: v.status === 'running' });
  return h('div', { class: 'vrow' + (hasProblems ? ' is-warn' : '') + (v.status === 'running' ? ' is-live' : ''), role: 'listitem', dataset: { id: v.id } },
    canSort ? h('button', { class: 'grip', type: 'button', id: `grip-${v.id}`, 'aria-label': `Переместить «${v.title}». Стрелки вверх и вниз меняют порядок` }, icon('drag')) : null,
    h('span', { class: 'num-circle', 'aria-hidden': 'true' }, String(i + 1)),
    h('div', { class: 'v-body' },
      h('b', null, v.title),
      h('span', null, voteMeta(v), hasProblems ? h('span', { style: { color: 'var(--c-yellow-text)', fontWeight: 500 } }, ` · ${v.problems.join(', ')}`) : null)),
    statusBadge,
    h('div', { class: 'v-actions' },
      editable ? h('a', { class: `btn ${hasProblems ? 'btn-secondary' : 'btn-ghost'} btn-sm`, href: `editor.html?meeting=${v.meeting_id}&vote=${v.id}` }, hasProblems ? 'Дополнить' : 'Изменить') : null,
      editable ? h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': `Удалить «${v.title}»`, title: 'Удалить', onClick: () => removeVote(v) }, icon('trash')) : null));
}

/* ================= действия ================= */
async function reorder(from, to) {
  const m = state.detail;
  const before = m.votes;
  m.votes = moveItem(before, from, to);
  const movedId = m.votes[to].id;
  render();
  const grip = document.getElementById(`grip-${movedId}`);
  if (grip) grip.focus();
  try {
    await api.meetings.reorderVotes(m.id, m.votes.map((v) => v.id));
  } catch (e) {
    m.votes = before;
    render();
    toastError(e, 'Не удалось сохранить порядок');
  }
}

async function removeVote(v) {
  const ok = await confirmDialog({
    title: 'Удалить голосование?',
    text: `«${v.title}» и все его пункты будут удалены. Это действие нельзя отменить.`,
    ok: 'Удалить',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.votes.remove(v.id);
    toast('Голосование удалено');
    await loadList(state.selectedId);
  } catch (e) { toastError(e); }
}

/** Диалог создания или изменения заседания. */
function meetingDialog(m) {
  const isEdit = !!m;
  const dateId = nextId('d');
  const titleId = nextId('t');
  const defaultDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7)); // ближайший четверг
    return toISODate(d);
  })();
  const ay = academicYear(parseDate(defaultDate));
  const countInYear = state.meetings.filter((x) => x.held_on >= ay.from && x.held_on <= ay.to).length;

  const dateInput = h('input', { class: 'input', id: dateId, type: 'date', required: true, value: isEdit ? m.held_on : defaultDate });
  const titleInput = h('input', { class: 'input', id: titleId, type: 'text', required: true, maxlength: '200', value: isEdit ? m.title : `Заседание №${countInYear + 1}` });
  const err = h('div', { class: 'alert alert-err', role: 'alert', hidden: true });

  const dlg = openDialog({
    title: isEdit ? 'Изменить заседание' : 'Новое заседание',
    body: [
      err,
      h('div', { class: 'field' }, h('label', { class: 'label', for: dateId }, 'Дата'), dateInput),
      h('div', { class: 'field' }, h('label', { class: 'label', for: titleId }, 'Название'), titleInput,
        h('div', { class: 'hint' }, 'Так заседание будет подписано на экране и в выгрузке')),
    ],
    actions: [
      { text: 'Отмена', cls: 'btn-tertiary' },
      {
        text: isEdit ? 'Сохранить' : 'Создать', cls: 'btn-primary', submit: true,
        onClick: async (close) => {
          const data = { held_on: dateInput.value, title: titleInput.value.trim() };
          dateInput.setAttribute('aria-invalid', String(!data.held_on));
          titleInput.setAttribute('aria-invalid', String(!data.title));
          if (!data.held_on) return dateInput.focus();
          if (!data.title) return titleInput.focus();
          try {
            const saved = isEdit ? await api.meetings.update(m.id, data) : await api.meetings.create(data);
            close();
            toast(isEdit ? 'Заседание сохранено' : 'Заседание создано');
            await loadList(saved.id);
          } catch (e) {
            mount(err, icon('alert'), h('div', { class: 'alert-body' }, e.message));
            err.hidden = false;
          }
        },
      },
    ],
  });
  setTimeout(() => (isEdit ? titleInput : dateInput).focus(), 0);
  return dlg;
}
