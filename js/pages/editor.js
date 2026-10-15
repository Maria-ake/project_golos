/** Редактор голосования: одиночное или пакетное (FR-02, FR-03, UC-01). */
import { h, mount, $, nextId } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { initPage, toast, toastError, confirmDialog, loadingState, errorState, makeSortable, moveItem, flash, withLoading, VOTE_STATUS } from '../ui.js';
import { fmtDate, fmtDuration, fmtTimer, nPlural, W } from '../format.js';
import { DEFAULT_SECONDS, SECONDS_RANGE } from '../config.js';

const main = $('#main');
const params = new URLSearchParams(location.search);
const meetingId = Number(params.get('meeting'));
const voteId = Number(params.get('vote')) || null;

let rowKey = 0;
const newRow = (name = '', post = '') => ({ key: ++rowKey, name, post });

const state = {
  meeting: null,
  serverStatus: null,       // статус голосования на сервере (для редактирования)
  kind: 'single',
  title: '',
  sec: DEFAULT_SECONDS.single,
  secTouched: false,
  question: '',
  rows: [newRow()],
  touched: new Set(),       // поля, после которых показываем ошибки
  showAll: false,           // после попытки сохранить — показываем все ошибки
  dirty: false,
};

boot();

async function boot() {
  mount(main, loadingState());
  try {
    await initPage({ active: 'meetings' });
    if (!meetingId) throw new Error('Не указано заседание. Откройте редактор со страницы «Заседания».');
    const [meeting, vote] = await Promise.all([
      api.meetings.get(meetingId),
      voteId ? api.votes.get(voteId) : null,
    ]);
    state.meeting = meeting;
    if (vote) {
      state.serverStatus = vote.status;
      state.kind = vote.kind;
      state.title = vote.title;
      state.sec = vote.item_seconds;
      state.secTouched = true;
      if (vote.kind === 'single') state.question = vote.items[0] ? vote.items[0].text : '';
      else state.rows = vote.items.length ? vote.items.map((i) => newRow(i.candidate_name || '', i.candidate_post || '')) : [newRow()];
      if (vote.status === 'draft') state.showAll = true; // сразу видно, чего не хватает
    }
    render();
  } catch (e) {
    mount(main, errorState(e, boot));
  } finally {
    main.removeAttribute('aria-busy');
  }
}

/* ================= валидация ================= */
/** @returns {{id: string, text: string, ready: boolean}[]} ready=true — ошибка мешает только статусу «готово» */
function validate() {
  const errs = [];
  if (!state.title.trim()) errs.push({ id: 'v-title', text: 'Укажите заголовок голосования', ready: false });
  if (state.sec < SECONDS_RANGE.min || state.sec > SECONDS_RANGE.max) errs.push({ id: 'v-sec', text: `Время — от ${SECONDS_RANGE.min} до ${SECONDS_RANGE.max} с`, ready: false });
  if (state.kind === 'single') {
    if (!state.question.trim()) errs.push({ id: 'v-question', text: 'Введите текст вопроса', ready: true });
  } else {
    const rows = filledRows();
    if (!rows.length) errs.push({ id: 'paste', text: 'Добавьте хотя бы одну кандидатуру', ready: true });
    state.rows.forEach((r, i) => {
      const empty = !r.name.trim() && !r.post.trim();
      if (empty && state.rows.length > 1) return; // пустая строка просто не сохранится
      if (!r.name.trim()) errs.push({ id: `name-${r.key}`, text: `Строка ${i + 1}: укажите ФИО`, ready: true });
      if (!r.post.trim()) errs.push({ id: `post-${r.key}`, text: `Строка ${i + 1}: укажите должность`, ready: true });
    });
  }
  return errs;
}
const filledRows = () => state.rows.filter((r) => r.name.trim() || r.post.trim());

/* ================= отрисовка ================= */
function render() {
  const m = state.meeting;
  const locked = state.serverStatus && !['draft', 'ready'].includes(state.serverStatus);
  const isNew = !voteId;
  mount(main,
    h('nav', { 'aria-label': 'Навигация', class: 'row small', style: { gap: '8px' } },
      h('a', { href: 'meetings.html' }, 'Заседания'),
      icon('chevronRight', { size: 18, color: 'rgba(0,0,0,.5)' }),
      h('a', { href: `meetings.html?id=${m.id}` }, `${fmtDate(m.held_on)}, ${m.title}`),
      icon('chevronRight', { size: 18, color: 'rgba(0,0,0,.5)' }),
      h('span', { class: 'muted', 'aria-current': 'page' }, isNew ? 'Новое голосование' : 'Изменение голосования')),
    h('h1', null, isNew ? 'Новое голосование' : 'Изменение голосования'),
    locked
      ? lockedCard()
      : m.status === 'closed'
        ? h('div', { class: 'alert alert-warn' }, icon('alert'), h('div', { class: 'alert-body' }, 'Заседание уже проведено — добавить голосование нельзя.'))
        : h('div', { class: 'split' }, renderForm(), h('aside', { class: 'side stack', id: 'aside', 'aria-label': 'Сводка и сохранение' })));
  if (!locked && m.status !== 'closed') {
    updateAside();
    updateErrors();
  }
}

function lockedCard() {
  const st = VOTE_STATUS[state.serverStatus];
  return h('div', { class: 'card card-pad stack' },
    h('div', { class: 'alert alert-info' }, icon('lock'), h('div', { class: 'alert-body' },
      h('b', null, `Голосование «${state.title}» — ${st.text.toLowerCase()}`),
      h('span', null, 'После запуска состав и порядок пунктов зафиксированы, чтобы итоги нельзя было изменить задним числом.'))),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-secondary', href: `control.html?id=${meetingId}` }, 'К пульту управления'),
      h('a', { class: 'btn btn-ghost', href: `meetings.html?id=${meetingId}` }, 'К заседанию')));
}

function renderForm() {
  const form = h('form', { class: 'card card-pad main stack', id: 'vote-form', novalidate: true, 'aria-label': 'Параметры голосования', style: { gap: '32px' } },
    kindSection(),
    titleSection(),
    state.kind === 'single' ? questionSection() : candidatesSection());
  form.addEventListener('submit', (e) => { e.preventDefault(); save('ready'); });
  return form;
}

function kindSection() {
  const opt = (value, title, desc) => h('label', { class: 'choice' },
    h('input', {
      type: 'radio', name: 'kind', value, checked: state.kind === value,
      onChange: () => {
        state.kind = value;
        if (!state.secTouched) state.sec = DEFAULT_SECONDS[value];
        markDirty();
        render();
        const r = document.querySelector(`input[name="kind"][value="${value}"]`);
        if (r) r.focus();
      },
    }),
    h('span', { class: 'radio', 'aria-hidden': 'true' }),
    h('span', null, h('b', null, title), h('span', { class: 'desc' }, desc)));
  return h('fieldset', { style: { border: 0, margin: 0, padding: 0 } },
    h('legend', { class: 'section-title', style: { padding: 0, marginBottom: '16px' } }, h('span', { class: 'step-num' }, '1'), 'Тип голосования'),
    h('div', { class: 'choice-cards' },
      opt('single', 'Одиночное', 'Один вопрос и таймер. Итог — сразу после окончания.'),
      opt('batch', 'Пакетное', 'Список кандидатур по очереди. Сводная таблица — в конце.')));
}

function titleSection() {
  const titleInput = h('input', {
    class: 'input', id: 'v-title', type: 'text', maxlength: '200', value: state.title,
    placeholder: state.kind === 'batch' ? 'Например, Избрание на должности ППС' : 'Например, Представление к учёному званию доцента',
    'aria-describedby': 'v-title-hint v-title-err',
    onInput: (e) => { state.title = e.target.value; markDirty(); updateAside(); updateErrors(); },
    onBlur: () => { state.touched.add('v-title'); updateErrors(); },
  });
  const secInput = h('input', {
    id: 'v-sec', type: 'number', inputmode: 'numeric', min: SECONDS_RANGE.min, max: SECONDS_RANGE.max, step: SECONDS_RANGE.step,
    value: state.sec, 'aria-describedby': 'v-sec-hint v-sec-err',
    onInput: (e) => { state.sec = Number(e.target.value) || 0; state.secTouched = true; markDirty(); syncPresets(); updateAside(); updateErrors(); },
    onBlur: () => { state.touched.add('v-sec'); updateErrors(); },
  });
  const setSec = (v) => {
    state.sec = Math.max(SECONDS_RANGE.min, Math.min(SECONDS_RANGE.max, v));
    state.secTouched = true;
    secInput.value = state.sec;
    markDirty(); syncPresets(); updateAside(); updateErrors();
  };
  const presets = [10, 15, 30, 60].map((v) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(state.sec === v), dataset: { sec: v }, onClick: () => setSec(v),
  }, `${v} с`));
  return h('div', { class: 'stack', style: { gap: '16px' } },
    h('div', { class: 'section-title' }, h('span', { class: 'step-num' }, '2'), 'Заголовок и время'),
    h('div', { class: 'row', style: { gap: '24px', alignItems: 'flex-start' } },
      h('div', { class: 'field', style: { flex: '1 1 320px' } },
        h('label', { class: 'label', for: 'v-title' }, 'Заголовок голосования'),
        titleInput,
        h('div', { class: 'error-text', id: 'v-title-err', hidden: true }),
        h('div', { class: 'hint', id: 'v-title-hint' }, 'Так голосование будет называться на экране и в протоколе')),
      h('div', { class: 'field' },
        h('label', { class: 'label', for: 'v-sec' }, state.kind === 'batch' ? 'Время на одну кандидатуру' : 'Время на голосование'),
        h('div', { class: 'row', style: { gap: '12px' } },
          h('div', { class: 'stepper' },
            h('button', { type: 'button', 'aria-label': `Меньше на ${SECONDS_RANGE.step} с`, onClick: () => setSec(state.sec - SECONDS_RANGE.step) }, icon('minus')),
            secInput,
            h('button', { type: 'button', 'aria-label': `Больше на ${SECONDS_RANGE.step} с`, onClick: () => setSec(state.sec + SECONDS_RANGE.step) }, icon('plus'))),
          h('span', { class: 'muted' }, 'сек'),
          h('div', { class: 'row', style: { gap: '8px' }, role: 'group', 'aria-label': 'Быстрый выбор времени', id: 'presets' }, presets)),
        h('div', { class: 'error-text', id: 'v-sec-err', hidden: true }),
        h('div', { class: 'hint', id: 'v-sec-hint' }, `От ${SECONDS_RANGE.min} до ${SECONDS_RANGE.max} секунд`))));
}

function syncPresets() {
  document.querySelectorAll('#presets .chip').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.sec) === state.sec)));
}

function questionSection() {
  return h('div', { class: 'stack', style: { gap: '16px' } },
    h('div', { class: 'section-title' }, h('span', { class: 'step-num' }, '3'), 'Вопрос'),
    h('div', { class: 'field' },
      h('label', { class: 'label', for: 'v-question' }, 'Текст вопроса'),
      h('textarea', {
        class: 'input', id: 'v-question', rows: '4', maxlength: '1000', value: state.question,
        placeholder: 'Например: Представить Иванова Ивана Ивановича к присвоению учёного звания доцента по научной специальности 2.3.1',
        'aria-describedby': 'v-question-err v-question-hint',
        onInput: (e) => { state.question = e.target.value; markDirty(); updateAside(); updateErrors(); },
        onBlur: () => { state.touched.add('v-question'); updateErrors(); },
      }),
      h('div', { class: 'error-text', id: 'v-question-err', hidden: true }),
      h('div', { class: 'hint', id: 'v-question-hint' }, 'Ответы всегда: За · Против · Воздержался. Переголосование невозможно.')));
}

/* ---------- пакет: вставка из Excel и список ---------- */
function parseRows(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const cols = (line.includes('\t') ? line.split('\t') : line.split(';')).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
    return { name: cols[0] || '', post: cols.slice(1).filter(Boolean).join(', ') };
  }).filter((r) => r.name && !/^(фио|ф\.и\.о\.?|кандидат(ура)?)$/i.test(r.name));
}

function addParsed(text) {
  const parsed = parseRows(text);
  if (!parsed.length) { toast('Не нашли строк для добавления: нужен столбец ФИО и, через Tab или «;», должность', 'info', 6000); return 0; }
  const onlyEmpty = state.rows.length === 1 && !state.rows[0].name && !state.rows[0].post;
  state.rows = (onlyEmpty ? [] : state.rows).concat(parsed.map((r) => newRow(r.name, r.post)));
  markDirty();
  render();
  const noPost = parsed.filter((r) => !r.post).length;
  toast(`Добавлено: ${nPlural(parsed.length, W.candidate)}${noPost ? `. Без должности: ${noPost} — дополните` : ''}`, noPost ? 'info' : 'ok');
  return parsed.length;
}

function candidatesSection() {
  const paste = h('textarea', {
    class: 'input', id: 'paste', rows: '2', 'aria-describedby': 'paste-hint paste-err',
    placeholder: 'Скопируйте два столбца — ФИО и должность — и нажмите Ctrl+V. Каждая строка станет кандидатурой.',
    onPaste: (e) => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (/[\n\t;]/.test(text.trim())) {
        e.preventDefault();
        addParsed(text);
        const p = $('#paste'); if (p) p.focus();
      }
    },
  });
  const zone = h('div', { class: 'paste-zone' },
    h('label', { for: 'paste', class: 'row', style: { gap: '10px', fontWeight: 600, fontSize: '15px' } },
      icon('paste', { size: 22, color: 'var(--c-green-active)' }), 'Вставьте список из Excel'),
    paste,
    h('div', { class: 'row-between' },
      h('span', { class: 'tiny muted', id: 'paste-hint' }, 'Разделитель — табуляция или «;». Строка-заголовок «ФИО» пропускается.'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { if (addParsed(paste.value)) { const p = $('#paste'); if (p) p.value = ''; } } }, 'Добавить из поля')),
    h('div', { class: 'error-text', id: 'paste-err', hidden: true }));
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.add('is-over')));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('is-over')));

  const list = h('div', { role: 'table', 'aria-label': 'Список кандидатур', id: 'rows' },
    h('div', { class: 'crow head', role: 'row' },
      h('span', { role: 'columnheader' }, h('span', { class: 'sr-only' }, 'Порядок')),
      h('span', { role: 'columnheader', style: { textAlign: 'center' } }, '№'),
      h('span', { role: 'columnheader' }, 'ФИО'),
      h('span', { role: 'columnheader' }, 'Должность, подразделение'),
      h('span', { role: 'columnheader' }, h('span', { class: 'sr-only' }, 'Удалить'))),
    state.rows.map((r, i) => candidateRow(r, i)));
  makeSortable(list, {
    itemSelector: '.crow:not(.head)',
    handleSelector: '.grip',
    onReorder: (from, to) => {
      const key = state.rows[from].key;
      state.rows = moveItem(state.rows, from, to);
      markDirty();
      render();
      const g = document.getElementById(`grip-${key}`);
      if (g) g.focus();
    },
  });

  return h('div', { class: 'stack', style: { gap: '16px' } },
    h('div', { class: 'row-between' },
      h('div', { class: 'section-title' }, h('span', { class: 'step-num' }, '3'), 'Кандидатуры ', h('span', { class: 'muted', style: { fontWeight: 500 } }, `· ${filledRows().length}`)),
      h('span', { class: 'small muted' }, 'Порядок на экране = порядок в списке')),
    zone,
    list,
    h('div', null, h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', id: 'add-row',
      onClick: () => {
        const r = newRow();
        state.rows.push(r);
        markDirty();
        render();
        const n = document.getElementById(`name-${r.key}`); if (n) n.focus();
      },
    }, icon('plus'), 'Добавить кандидатуру вручную')));
}

function candidateRow(r, i) {
  const n = i + 1;
  const field = (key, label, placeholder) => {
    const id = `${key}-${r.key}`;
    return h('span', { role: 'cell', class: key === 'post' ? 'post-cell' : null },
      h('input', {
        class: 'input input-sm', id, type: 'text', value: r[key], placeholder, maxlength: '200',
        'aria-label': `${label}, строка ${n}`, 'aria-describedby': `${id}-err`,
        onInput: (e) => { r[key] = e.target.value; markDirty(); updateAside(); updateErrors(); },
        onBlur: () => { state.touched.add(id); updateErrors(); },
        onKeydown: (e) => {
          // Enter в последнем поле — новая строка, как в таблице.
          if (e.key === 'Enter') {
            e.preventDefault();
            if (key === 'name') { const p = document.getElementById(`post-${r.key}`); if (p) p.focus(); return; }
            const idx = state.rows.indexOf(r);
            if (idx === state.rows.length - 1) {
              const nr = newRow(); state.rows.push(nr); markDirty(); render();
              const ni = document.getElementById(`name-${nr.key}`); if (ni) ni.focus();
            } else {
              const ni = document.getElementById(`name-${state.rows[idx + 1].key}`); if (ni) ni.focus();
            }
          }
        },
      }),
      h('div', { class: 'error-text', id: `${id}-err`, hidden: true }));
  };
  return h('div', { class: 'crow', role: 'row' },
    h('button', { class: 'grip', type: 'button', id: `grip-${r.key}`, 'aria-label': `Переместить строку ${n}. Стрелки вверх и вниз` }, icon('drag')),
    h('span', { class: 'n', role: 'cell' }, String(n)),
    field('name', 'ФИО', 'Фамилия Имя Отчество'),
    field('post', 'Должность', 'Например, доцент, ОИТ'),
    h('span', { role: 'cell' }, h('button', {
      class: 'del-btn', type: 'button', 'aria-label': `Удалить строку ${n}`,
      onClick: () => {
        state.rows = state.rows.filter((x) => x !== r);
        if (!state.rows.length) state.rows.push(newRow());
        markDirty();
        render();
        const next = state.rows[Math.min(i, state.rows.length - 1)];
        const g = next && document.getElementById(`name-${next.key}`); if (g) g.focus();
      },
    }, icon('trash'))));
}

/* ---------- ошибки у полей ---------- */
function updateErrors() {
  const errs = validate();
  const byId = new Map(errs.map((e) => [e.id, e]));
  document.querySelectorAll('[id$="-err"]').forEach((el) => {
    const fieldId = el.id.slice(0, -4);
    const err = byId.get(fieldId);
    const show = !!err && (state.showAll || state.touched.has(fieldId));
    el.hidden = !show;
    const t = show ? err.text.replace(/^Строка \d+: /, '') : '';
    el.textContent = t ? t[0].toUpperCase() + t.slice(1) : '';
    const input = document.getElementById(fieldId);
    if (input) input.setAttribute('aria-invalid', String(show));
  });
}

/* ---------- боковая панель ---------- */
function updateAside() {
  const aside = $('#aside');
  if (!aside) return;
  const errs = validate();
  const blockingDraft = errs.filter((e) => !e.ready);
  const count = state.kind === 'single' ? 1 : filledRows().length;
  const first = state.kind === 'single' ? null : filledRows()[0];
  const total = count * state.sec;
  const kicker = state.kind === 'batch' ? `Кандидатура 1 из ${count || 1}` : (state.title || 'Голосование');
  const mainText = state.kind === 'batch' ? (first && first.name) || 'ФИО кандидата' : (state.question.trim() || 'Текст вопроса');
  const subText = state.kind === 'batch' ? (first && first.post) || 'должность не указана' : 'За · Против · Воздержался';

  const status = errs.length
    ? h('div', { class: 'alert alert-err', role: 'status' }, icon('alert'),
      h('div', { class: 'alert-body' },
        h('b', null, `Чтобы подготовить к запуску, исправьте: ${errs.length}`),
        h('ul', { class: 'err-list small' }, errs.slice(0, 5).map((e) => h('li', null, h('a', {
          href: `#${e.id}`,
          onClick: (ev) => { ev.preventDefault(); state.touched.add(e.id); updateErrors(); const el = document.getElementById(e.id); if (el) el.focus(); },
        }, e.text))), errs.length > 5 ? h('li', null, `и ещё ${errs.length - 5}`) : null)))
    : h('div', { class: 'alert alert-ok', role: 'status' }, icon('check'), h('div', { class: 'alert-body' }, 'Всё заполнено — можно готовить к запуску'));

  mount(aside,
    h('div', { class: 'card card-pad-m stack', style: { gap: '20px' } },
      h('div', { class: 'overline' }, 'Так будет на проекторе'),
      h('div', { class: 'mini-screen', 'aria-hidden': 'true' },
        h('div', { class: 'k' }, h('span', null, kicker), h('span', { class: 'live' }, 'идёт голосование')),
        h('div', null, h('div', { class: 'm' }, mainText), h('div', { class: 's' }, subText)),
        h('div', { class: 'b' },
          h('div', { class: 'legend' },
            h('span', null, h('i', { style: { background: '#28BE46' } }), 'За'),
            h('span', null, h('i', { style: { background: '#FF4460' } }), 'Против'),
            h('span', null, h('i', { style: { background: '#FFB600' } }), 'Возд.')),
          h('div', { class: 't' }, fmtTimer(state.sec)))),
      h('div', null,
        sumRow('Тип', state.kind === 'batch' ? 'Пакетное' : 'Одиночное'),
        sumRow('Пунктов', String(count)),
        sumRow('На пункт', `${state.sec} с`),
        sumRow('Всего примерно', fmtDuration(total)),
        sumRow('Варианты', 'За · Против · Возд.')),
      status,
      h('div', { class: 'stack-s', style: { gap: '10px' } },
        h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit', form: 'vote-form', id: 'save-ready' }, icon('save'), 'Сохранить — готово к запуску'),
        h('button', {
          class: 'btn btn-secondary btn-block', type: 'button', id: 'save-draft',
          'aria-describedby': blockingDraft.length ? 'draft-why' : null,
          onClick: () => save('draft'),
        }, 'Сохранить черновик'),
        blockingDraft.length ? h('span', { class: 'tiny muted', id: 'draft-why' }, 'Для черновика достаточно заголовка') : null,
        h('button', { class: 'btn btn-ghost btn-block', type: 'button', onClick: cancel }, 'Отмена'))),
    h('div', { class: 'note' }, icon('info'),
      h('span', null, 'Изменить голосование можно, пока оно не запущено. После запуска состав и порядок пунктов зафиксированы.')));
}

const sumRow = (k, v) => h('div', { class: 'sum-row' }, h('span', { class: 'muted' }, k), h('b', null, v));

/* ================= сохранение ================= */
async function save(status) {
  const errs = validate().filter((e) => status === 'ready' || !e.ready);
  if (errs.length) {
    state.showAll = true;
    updateErrors();
    updateAside();
    const el = document.getElementById(errs[0].id);
    if (el) el.focus();
    toast(status === 'ready' ? 'Не всё заполнено — проверьте отмеченные поля' : errs[0].text, 'err');
    return;
  }
  const payload = {
    kind: state.kind,
    title: state.title.trim(),
    item_seconds: state.sec,
    status,
    items: state.kind === 'single'
      ? [{ text: state.question.trim() }]
      : filledRows().map((r) => ({ candidate_name: r.name.trim(), candidate_post: r.post.trim() })),
  };
  const btn = document.getElementById(status === 'ready' ? 'save-ready' : 'save-draft');
  await withLoading(btn, async () => {
    try {
      if (voteId) await api.votes.update(voteId, payload);
      else await api.votes.create(meetingId, payload);
      state.dirty = false;
      flash(status === 'ready' ? `«${payload.title}» готово к запуску` : `Черновик «${payload.title}» сохранён`);
      location.href = `meetings.html?id=${meetingId}`;
    } catch (e) {
      toastError(e);
    }
  });
}

async function cancel() {
  if (state.dirty) {
    const ok = await confirmDialog({ title: 'Уйти без сохранения?', text: 'Изменения в голосовании пропадут.', ok: 'Уйти', cancel: 'Остаться' });
    if (!ok) return;
  }
  state.dirty = false;
  location.href = `meetings.html?id=${meetingId}`;
}

function markDirty() { state.dirty = true; }
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});
