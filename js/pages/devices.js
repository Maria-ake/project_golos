/** Реестр пультов — администратор (FR-20, UC-08) + резервная копия (NFR-09). */
import { h, mount, $, preserveFocus, nextId } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { initPage, badge, toast, toastError, openDialog, loadingState, errorState, emptyState, withLoading } from '../ui.js';
import { fmtAgo, fmtTime, fmtDate, toISODate } from '../format.js';
import { POLL, ONLINE_WINDOW_MS } from '../config.js';

const main = $('#main');
const state = { devices: [], filter: 'all', blinking: new Set(), backup: null, key: '' };

boot();

async function boot() {
  mount(main, loadingState());
  try {
    await initPage({ active: 'devices', roles: ['admin'] });
    await load();
    renderShell();
    renderTable();
    setTimeout(poll, POLL.devices);
  } catch (e) {
    mount(main, errorState(e, e.status === 403 ? null : boot));
    if (e.status === 403) main.append(h('div', null, h('a', { class: 'btn btn-secondary', href: 'meetings.html' }, 'К заседаниям')));
  } finally {
    main.removeAttribute('aria-busy');
  }
}

async function load() {
  const [devices, backup] = await Promise.all([api.devices.list(), api.backupInfo().catch(() => null)]);
  state.devices = devices.sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }));
  state.backup = backup;
}

async function poll() {
  try {
    state.devices = (await api.devices.list()).sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }));
    renderStats();
    renderTable();
  } catch (e) { /* шапка покажет «Нет связи» */ }
  setTimeout(poll, POLL.devices);
}

const statusOf = (d) => (!d.is_active ? 'off' : Date.now() - Date.parse(d.last_seen_at) < ONLINE_WINDOW_MS ? 'ok' : 'lost');

/* ================= отрисовка ================= */
function renderShell() {
  mount(main,
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' }, h('span', { class: 'overline' }, 'Администрирование'), h('h1', null, 'Реестр пультов')),
      h('button', { class: 'btn btn-primary', type: 'button', id: 'register', onClick: registerDialog }, icon('plus'), 'Зарегистрировать пульт')),
    h('div', { class: 'card stats', id: 'stats', role: 'list', 'aria-label': 'Сводка' }),
    h('section', { class: 'card', 'aria-labelledby': 'tbl-t', style: { padding: '8px 0' } },
      h('div', { class: 'row-between', style: { padding: '16px 24px' } },
        h('h2', { id: 'tbl-t', style: { fontSize: '20px' } }, 'Пульты'),
        h('div', { class: 'row', style: { gap: '8px' }, role: 'group', 'aria-label': 'Фильтр', id: 'filters' })),
      h('div', { class: 'table-scroll', style: { padding: '0 24px' }, id: 'table' })),
    h('div', { class: 'row', style: { gap: '24px', alignItems: 'stretch' } },
      h('div', { class: 'alert alert-info', style: { flex: '1 1 420px' } }, icon('shieldLock'),
        h('div', { class: 'alert-body' }, 'Пульты не персональные: номер не связан с человеком и не хранится вместе с голосом. Ключ подписи показывается один раз — при регистрации.')),
      h('div', { class: 'card card-pad-m row-between', style: { flex: '1 1 420px' }, id: 'backup' })));
  renderStats();
  renderBackup();
}

function renderStats() {
  const ds = state.devices;
  const active = ds.filter((d) => d.is_active);
  const ok = ds.filter((d) => statusOf(d) === 'ok');
  const lost = ds.filter((d) => statusOf(d) === 'lost');
  const fws = [...new Set(active.map((d) => d.firmware_version).filter(Boolean))];
  const stat = (label, value, sub, color) => h('div', { class: 'stat', role: 'listitem' },
    h('span', { class: 'overline' }, label), h('b', { style: color ? { color } : null }, value), h('span', { class: 'small muted' }, sub));
  mount($('#stats'),
    stat('Зарегистрировано', String(ds.length), `${active.length} в работе, ${ds.length - active.length} запасных`),
    stat('На связи', `${ok.length} из ${active.length}`, `опрос каждые 0,5 с`, 'var(--c-green-text)'),
    stat('Нет связи', String(lost.length), lost.length ? lost.map((d) => d.label).join(', ') : 'все отвечают', lost.length ? 'var(--c-red-text)' : null),
    stat('Прошивка', fws.length === 1 ? fws[0] : fws.length ? `${fws.length} версии` : '—', fws.length > 1 ? 'версии различаются — обновите' : 'одинаковая у всех', fws.length > 1 ? 'var(--c-yellow-text)' : null));
}

function renderFilters() {
  const counts = { all: state.devices.length, ok: 0, lost: 0, off: 0 };
  state.devices.forEach((d) => { counts[statusOf(d)] += 1; });
  const defs = [['all', 'Все'], ['ok', 'На связи'], ['lost', 'Нет связи'], ['off', 'Отключены']];
  mount($('#filters'), defs.map(([id, label]) => h('button', {
    class: 'chip', type: 'button', id: `f-${id}`, 'aria-pressed': String(state.filter === id),
    onClick: () => { state.filter = id; renderTable(); },
  }, label, h('span', { class: 'count' }, String(counts[id])))));
}

function renderTable() {
  preserveFocus(() => {
    renderFilters();
    const rows = state.devices.filter((d) => state.filter === 'all' || statusOf(d) === state.filter);
    const host = $('#table');
    if (!rows.length) {
      mount(host, emptyState({ iconName: 'cellphone', title: 'Нет пультов с таким статусом', text: 'Выберите другой фильтр.' }));
      return;
    }
    mount(host, h('table', { class: 'table' },
      h('caption', { class: 'sr-only' }, 'Пульты'),
      h('thead', null, h('tr', null,
        ['Пульт', 'Статус', 'Последний отклик', 'MAC', 'Питание', 'Прошивка', 'В работе'].map((t) => h('th', { scope: 'col' }, t)),
        h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Действия')))),
      h('tbody', null, rows.map(deviceRow))));
  });
}

function deviceRow(d) {
  const st = statusOf(d);
  const blinking = state.blinking.has(d.id);
  const statusBadge = st === 'ok' ? badge('На связи', 'badge-ok', { dot: true }) : st === 'lost' ? badge('Нет связи', 'badge-err', { dot: true }) : badge('Отключён', 'badge-mute', { dot: true });
  const power = d.battery_mv ? `${(d.battery_mv / 1000).toFixed(2).replace('.', ',')} В` : st === 'off' ? '—' : 'USB';
  return h('tr', { class: st === 'lost' ? 'is-off' : st === 'off' ? 'is-dim' : '' },
    h('td', null, h('span', { class: 'row', style: { gap: '10px', flexWrap: 'nowrap' } },
      h('span', { class: 'num-circle', style: { borderRadius: '6px' }, 'aria-hidden': 'true' }, icon('cellphone', { size: 20, color: 'rgba(0,0,0,.75)' })),
      h('b', { class: 'nowrap' }, d.label))),
    h('td', null, statusBadge),
    h('td', { class: 'nowrap' }, st === 'off' ? `в запасе · ${fmtAgo(d.last_seen_at)}` : fmtAgo(d.last_seen_at)),
    h('td', { class: 'mono nowrap' }, d.mac),
    h('td', null, badge(power, 'badge-mute')),
    h('td', { class: 'mono' }, d.firmware_version || '—'),
    h('td', null, h('label', { class: 'switch' },
      h('input', { type: 'checkbox', id: `act-${d.id}`, checked: d.is_active, onChange: (e) => toggleActive(d, e.target) }),
      h('span', { class: 'track' }),
      h('span', { class: 'sr-only' }, `${d.label} в работе`))),
    h('td', { style: { textAlign: 'right' } }, h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', id: `id-${d.id}`, disabled: st !== 'ok',
      'aria-label': `Мигнуть светодиодами: ${d.label}`, title: 'Мигнуть светодиодами, чтобы найти пульт',
      onClick: () => identify(d),
    }, icon('flash', { color: '#E09F00' }), blinking ? 'Мигает…' : 'Найти')));
}

function renderBackup() {
  const b = state.backup;
  const when = b && b.backup_at ? (() => {
    const d = new Date(b.backup_at);
    return toISODate(d) === toISODate(new Date()) ? `Сегодня, ${fmtTime(d)}` : `${fmtDate(toISODate(d))}, ${fmtTime(d)}`;
  })() : 'ещё не делалась';
  mount($('#backup'),
    h('div', { class: 'row', style: { gap: '12px', flexWrap: 'nowrap' } },
      icon('save', { size: 24, color: 'var(--c-green-active)' }),
      h('div', { class: 'stack-s', style: { gap: '2px' } },
        h('b', null, 'Резервная копия базы'),
        h('span', { class: 'small muted' }, `${when}${b && b.target ? ' · ' + b.target : ''}`))),
    h('button', {
      class: 'btn btn-secondary btn-sm', type: 'button', id: 'backup-now',
      onClick: (e) => withLoading(e.currentTarget, async () => {
        try { state.backup = await api.backup(); renderBackup(); toast('Резервная копия сохранена'); } catch (err) { toastError(err); }
      }),
    }, 'Сделать копию сейчас'));
}

/* ================= действия ================= */
async function toggleActive(d, input) {
  const want = input.checked;
  try {
    const upd = await api.devices.update(d.id, { is_active: want });
    Object.assign(d, upd);
    toast(want ? `${d.label} введён в работу` : `${d.label} выведен из работы`);
  } catch (e) {
    input.checked = !want;
    toastError(e);
  }
  renderStats();
  renderTable();
}

async function identify(d) {
  try {
    await api.devices.identify(d.id);
    state.blinking.add(d.id);
    renderTable();
    setTimeout(() => { state.blinking.delete(d.id); renderTable(); }, 3000);
  } catch (e) { toastError(e); }
}

function registerDialog() {
  const used = new Set(state.devices.map((d) => d.label));
  let n = state.devices.length + 1;
  while (used.has(`Пульт ${String(n).padStart(2, '0')}`)) n += 1;
  const labelId = nextId('l');
  const macId = nextId('m');
  const label = h('input', { class: 'input', id: labelId, type: 'text', value: `Пульт ${String(n).padStart(2, '0')}`, required: true, maxlength: '40' });
  const mac = h('input', {
    class: 'input mono', id: macId, type: 'text', placeholder: 'A4:CF:12:3B:7E:A2', required: true, autocomplete: 'off', spellcheck: 'false',
    'aria-describedby': `${macId}-h`,
    onInput: (e) => {
      // Автоформат: A4CF123B7EA2 → A4:CF:12:3B:7E:A2
      const hex = e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12);
      e.target.value = hex.match(/.{1,2}/g)?.join(':') || '';
    },
  });
  const err = h('div', { class: 'alert alert-err', role: 'alert', hidden: true });
  const steps = h('ol', { class: 'stack-s small', style: { paddingLeft: '20px' } },
    h('li', null, 'Подключите пульт по USB и узнайте MAC в мониторе порта (печатается при загрузке).'),
    h('li', null, 'Нажмите «Зарегистрировать» — сервер создаст ключ подписи.'),
    h('li', null, 'Запишите ключ в пульт утилитой прошивки (NVS). Пульт мигнёт зелёным и появится в списке.'));

  openDialog({
    title: 'Новый пульт',
    body: [steps, err,
      h('div', { class: 'row', style: { gap: '16px', alignItems: 'flex-start' } },
        h('div', { class: 'field', style: { flex: '0 1 180px' } }, h('label', { class: 'label', for: labelId }, 'Номер'), label),
        h('div', { class: 'field', style: { flex: '1 1 240px' } }, h('label', { class: 'label', for: macId }, 'MAC-адрес'), mac,
          h('div', { class: 'hint', id: `${macId}-h` }, 'Можно вводить без двоеточий')))],
    actions: [
      { text: 'Отмена', cls: 'btn-tertiary' },
      {
        text: 'Зарегистрировать', cls: 'btn-primary', submit: true,
        onClick: async (close) => {
          const okMac = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac.value);
          mac.setAttribute('aria-invalid', String(!okMac));
          label.setAttribute('aria-invalid', String(!label.value.trim()));
          if (!label.value.trim()) return label.focus();
          if (!okMac) { mount(err, icon('alert'), h('div', { class: 'alert-body' }, 'MAC-адрес — 12 шестнадцатеричных символов, например A4:CF:12:3B:7E:A2.')); err.hidden = false; return mac.focus(); }
          try {
            const created = await api.devices.create({ label: label.value.trim(), mac: mac.value });
            close();
            await load();
            renderStats();
            renderTable();
            showKey(created);
          } catch (e) {
            mount(err, icon('alert'), h('div', { class: 'alert-body' }, e.message));
            err.hidden = false;
          }
        },
      },
    ],
  });
  setTimeout(() => mac.focus(), 0);
}

function showKey(device) {
  const keyBox = h('code', { class: 'mono', style: { display: 'block', padding: '12px 14px', background: 'var(--c-globe)', borderRadius: '4px', wordBreak: 'break-all', fontSize: '14px' } }, device.secret_key);
  openDialog({
    title: `${device.label} зарегистрирован`,
    body: [
      h('div', { class: 'alert alert-warn' }, icon('alert'), h('div', { class: 'alert-body' },
        h('b', null, 'Ключ показывается один раз'),
        h('span', null, 'Запишите его в пульт утилитой прошивки. Потерянный ключ не восстановить — пульт придётся зарегистрировать заново.'))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Ключ HMAC (32 байта, hex)'), keyBox),
    ],
    actions: [
      {
        text: 'Скопировать ключ', cls: 'btn-secondary',
        onClick: async () => {
          try { await navigator.clipboard.writeText(device.secret_key); toast('Ключ скопирован'); } catch (e) {
            const r = document.createRange(); r.selectNodeContents(keyBox);
            const s = getSelection(); s.removeAllRanges(); s.addRange(r);
            toast('Выделили ключ — нажмите Ctrl+C', 'info');
          }
        },
      },
      { text: 'Готово, ключ записан', cls: 'btn-primary', autofocus: true },
    ],
  });
}
