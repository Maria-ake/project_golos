/**
 * Демо-сервер в браузере: повторяет контракт API из ТЗ (раздел 11) и логику VotingService,
 * чтобы фронтенд можно было разрабатывать и показывать без FastAPI и пультов.
 *
 * — Данные лежат в localStorage, поэтому вкладки «Пульт управления» и «Экран» видят одно состояние.
 * — 15 пультов эмулируются: при открытии пункта заранее «разыгрываются» моменты нажатий;
 *   иногда один член совета не голосует — так видно недействительный пункт и повтор.
 * — Счётчики открытого пункта наружу не отдаются (как на настоящем сервере).
 * — Сбросить демо-данные: localStorage.removeItem('golos.mock.db.v2') или ?reset=1 на любой странице.
 */
const KEY = 'golos.mock.db.v2';
const SESSION = 'golos.mock.session';
const COUNCIL = 15;

if (new URLSearchParams(location.search).has('reset')) {
  try { localStorage.removeItem(KEY); localStorage.removeItem(SESSION); } catch (e) { /* ignore */ }
}

/* ================= хранилище ================= */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* повреждено — пересоздаём */ }
  const db = seed();
  save(db);
  return db;
}
function save(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* квота */ }
}
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const nextId = (db, k) => (db.seq[k] = (db.seq[k] || 0) + 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

class HttpError extends Error { constructor(status, detail) { super(detail); this.status = status; this.detail = detail; } }
const fail = (status, detail) => { throw new HttpError(status, detail); };

/* ================= начальные данные ================= */
function seed() {
  const db = {
    seq: {},
    users: [
      { id: 1, login: 'secretary', password: 'secretary', role: 'secretary', name: 'Ковалёва Е. А.' },
      { id: 2, login: 'admin', password: 'admin', role: 'admin', name: 'Савельев Д. И.' },
    ],
    meetings: [], votes: [], items: [], attempts: [], sim: {}, devices: [],
    screen: { mode: 'idle' }, audit: [], backup_at: Date.now() - 6 * 3600e3,
  };
  const at = (date, h = 14, m = 0) => { const [y, mo, d] = date.split('-').map(Number); return new Date(y, mo - 1, d, h, m).getTime(); };

  const meeting = (held_on, title, status, present) => {
    const m = { id: nextId(db, 'meeting'), held_on, title, status, present_count: present, created_at: Date.now() };
    db.meetings.push(m);
    return m;
  };
  const vote = (m, kind, title, sec, status, rows) => {
    const v = { id: nextId(db, 'vote'), meeting_id: m.id, kind, title, item_seconds: sec, position: db.votes.filter((x) => x.meeting_id === m.id).length + 1, status, started_at: null, finished_at: null, queue: [], cursor: 0 };
    db.votes.push(v);
    rows.forEach((r, i) => {
      const isBatch = kind === 'batch';
      db.items.push({
        id: nextId(db, 'item'), vote_id: v.id, position: i + 1,
        text: isBatch ? r[0] : r, candidate_name: isBatch ? r[0] : null, candidate_post: isBatch ? r[1] : null, status: 'pending',
      });
    });
    return v;
  };
  const itemsOf = (v) => db.items.filter((i) => i.vote_id === v.id).sort((a, b) => a.position - b.position);
  const attempt = (item, no, present, counts, t, endReason = 'timer') => {
    const [f, a, ab] = counts;
    const valid = endReason === 'timer' && f + a + ab === present;
    db.attempts.push({
      id: nextId(db, 'attempt'), item_id: item.id, attempt_no: no, present_count: present,
      opened_at: t, closes_at: t + 10000, closed_at: t + 10000, for_count: f, against_count: a, abstain_count: ab, is_valid: valid, end_reason: endReason,
    });
    item.status = valid ? 'valid' : 'invalid';
  };

  /* ---- прошлый учебный год ---- */
  const m9 = meeting('2026-05-21', 'Заседание №9', 'closed', 12);
  const v9 = vote(m9, 'single', 'Представление к учёному званию доцента', 60, 'finished',
    ['Представить Медведеву Ольгу Николаевну к присвоению учёного звания доцента по научной специальности 2.3.1']);
  attempt(itemsOf(v9)[0], 1, 12, [10, 1, 1], at('2026-05-21', 14, 10));
  v9.started_at = v9.finished_at = at('2026-05-21', 14, 11);

  const m10 = meeting('2026-06-18', 'Заседание №10', 'closed', 14);
  const v10a = vote(m10, 'single', 'Избрание заведующего лабораторией', 60, 'finished',
    ['Избрать Соколова Михаила Евгеньевича заведующим лабораторией промышленной робототехники']);
  attempt(itemsOf(v10a)[0], 1, 14, [13, 1, 0], at('2026-06-18', 14, 5));
  const v10b = vote(m10, 'batch', 'Выдвижение на стипендию Президента РФ', 30, 'stopped', [
    ['Лебедев Константин Алексеевич', 'аспирант, ОИТ'],
    ['Ершова Дарья Валерьевна', 'аспирант, ОАР'],
    ['Тихонов Роман Игоревич', 'аспирант, ОИТ'],
  ]);
  const i10 = itemsOf(v10b);
  attempt(i10[0], 1, 14, [12, 1, 1], at('2026-06-18', 14, 20));
  attempt(i10[1], 1, 14, [14, 0, 0], at('2026-06-18', 14, 21));
  attempt(i10[2], 1, 14, [6, 1, 0], at('2026-06-18', 14, 22), 'stopped');
  i10[2].status = 'paper';
  v10a.finished_at = at('2026-06-18', 14, 6); v10b.finished_at = at('2026-06-18', 14, 23);

  /* ---- текущий учебный год ---- */
  const m1 = meeting('2026-09-24', 'Заседание №1', 'closed', 13);
  const v1a = vote(m1, 'batch', 'Избрание на должности ППС', 10, 'finished', [
    ['Захаров Андрей Михайлович', 'доцент, ОИТ'],
    ['Белова Наталья Сергеевна', 'профессор, ОАР'],
    ['Орлов Кирилл Андреевич', 'старший преподаватель, ОИТ'],
    ['Гусева Ирина Павловна', 'ассистент, ОАР'],
  ]);
  const i1 = itemsOf(v1a);
  attempt(i1[0], 1, 13, [11, 1, 1], at('2026-09-24', 14, 10));
  attempt(i1[1], 1, 13, [13, 0, 0], at('2026-09-24', 14, 11));
  attempt(i1[2], 1, 13, [10, 1, 1], at('2026-09-24', 14, 12));
  attempt(i1[3], 1, 13, [9, 2, 2], at('2026-09-24', 14, 13));
  attempt(i1[2], 2, 13, [10, 2, 1], at('2026-09-24', 14, 15));
  v1a.finished_at = at('2026-09-24', 14, 16);
  const v1b = vote(m1, 'single', 'Представление к учёному званию профессора', 60, 'finished',
    ['Представить Белову Наталью Сергеевну к присвоению учёного звания профессора по научной специальности 2.3.3']);
  attempt(itemsOf(v1b)[0], 1, 13, [12, 0, 1], at('2026-09-24', 14, 25));
  v1b.finished_at = at('2026-09-24', 14, 26);

  const m2 = meeting('2026-10-15', 'Заседание №2', 'planned', null);
  vote(m2, 'single', 'Представление к учёному званию доцента', 60, 'ready',
    ['Представить Иванова Ивана Ивановича к присвоению учёного звания доцента по научной специальности 2.3.1']);
  vote(m2, 'batch', 'Избрание на должности ППС', 10, 'ready', [
    ['Петров Павел Петрович', 'доцент, ОИТ'],
    ['Сидорова Анна Викторовна', 'профессор, ОАР'],
    ['Иванов Иван Иванович', 'доцент, ОИТ'],
    ['Кузнецова Мария Сергеевна', 'старший преподаватель, ОИТ'],
    ['Смирнов Алексей Андреевич', 'доцент, ОАР'],
    ['Попова Елена Николаевна', 'ассистент, ОИТ'],
    ['Васильев Дмитрий Олегович', 'доцент, ОИТ'],
    ['Морозова Ольга Игоревна', 'профессор, ОАР'],
    ['Новиков Сергей Владимирович', 'старший преподаватель, ОАР'],
    ['Фёдорова Татьяна Юрьевна', 'доцент, ОИТ'],
  ]);
  vote(m2, 'batch', 'Выдвижение на премию ТПУ для молодых учёных', 30, 'draft', [
    ['Ершова Дарья Валерьевна', 'аспирант, ОАР'],
    ['Лебедев Константин Алексеевич', 'ассистент, ОИТ'],
    ['Тихонов Роман Игоревич', ''],
  ]);

  const m3 = meeting('2026-11-19', 'Заседание №3', 'planned', null);
  vote(m3, 'single', 'Избрание на должность профессора', 60, 'draft', ['']);
  meeting('2026-12-17', 'Заседание №4', 'planned', null);

  /* ---- пульты: 15 в работе + 2 запасных; №09 не отвечает ---- */
  const macTail = ['01', '14', '2A', '33', '47', '52', '6C', '71', '88', '9D', 'A4', 'B1', 'C6', 'DE', 'E5', 'F2', 'F9'];
  for (let n = 1; n <= 17; n++) {
    db.devices.push({
      id: nextId(db, 'device'),
      label: `Пульт ${String(n).padStart(2, '0')}`,
      mac: `A4:CF:12:3B:7E:${macTail[n - 1]}`,
      is_active: n <= 15,
      sim: n === 9 ? 'offline' : n > 15 ? 'shelf' : 'online',
      last_seen_fixed: n === 9 ? Date.now() - 3 * 60e3 : n > 15 ? Date.now() - 12 * 86400e3 : null,
      battery_mv: null,
      firmware_version: '1.2.0',
    });
  }
  return db;
}

/* ================= логика голосования (как VotingService) ================= */
const meetingOf = (db, v) => db.meetings.find((m) => m.id === v.meeting_id);
const itemsOfVote = (db, v) => db.items.filter((i) => i.vote_id === v.id).sort((a, b) => a.position - b.position);
const attemptsOf = (db, item) => db.attempts.filter((a) => a.item_id === item.id).sort((a, b) => a.attempt_no - b.attempt_no);
const openAttemptOf = (db, v) => {
  const ids = new Set(itemsOfVote(db, v).map((i) => i.id));
  return db.attempts.find((a) => ids.has(a.item_id) && a.closed_at == null);
};

function simulatePresses(present, seconds, openedAt) {
  // Иногда кто-то не успевает или не нажимает — пункт станет недействительным.
  const missing = Math.random() < 0.15 ? 1 : 0;
  const windowMs = Math.min(seconds * 1000 - 1500, 8000);
  const presses = [];
  for (let i = 0; i < present - missing; i++) {
    const r = Math.random();
    presses.push({ at: openedAt + rnd(1200, 1200 + windowMs), choice: r < 0.76 ? 'for' : r < 0.88 ? 'against' : 'abstain' });
  }
  return presses.sort((a, b) => a.at - b.at);
}

function openAttempt(db, v, itemId, t) {
  const item = db.items.find((i) => i.id === itemId);
  const m = meetingOf(db, v);
  const no = attemptsOf(db, item).length + 1;
  const a = {
    id: nextId(db, 'attempt'), item_id: item.id, attempt_no: no, present_count: m.present_count,
    opened_at: t, closes_at: t + v.item_seconds * 1000, closed_at: null,
    for_count: 0, against_count: 0, abstain_count: 0, is_valid: null, end_reason: null,
  };
  db.attempts.push(a);
  item.status = 'open';
  db.sim[a.id] = simulatePresses(m.present_count, v.item_seconds, t);
  db.screen = { mode: 'voting', meeting_id: m.id, vote_id: v.id };
}

function closeAttempt(db, a, t, reason) {
  const presses = (db.sim[a.id] || []).filter((p) => p.at < t);
  a.for_count = presses.filter((p) => p.choice === 'for').length;
  a.against_count = presses.filter((p) => p.choice === 'against').length;
  a.abstain_count = presses.filter((p) => p.choice === 'abstain').length;
  a.closed_at = t;
  a.end_reason = reason;
  a.is_valid = reason === 'timer' && a.for_count + a.against_count + a.abstain_count === a.present_count;
  const item = db.items.find((i) => i.id === a.item_id);
  item.status = a.is_valid ? 'valid' : 'invalid';
  delete db.sim[a.id]; // аналог очистки ballot_receipt после закрытия пункта
}

/** Ленивое продвижение таймеров: вызывается на каждом запросе. */
function advance(db, now) {
  let changed = false;
  for (const v of db.votes) {
    if (v.status !== 'running') continue;
    let guard = 0;
    while (v.status === 'running' && guard++ < 500) {
      const a = openAttemptOf(db, v);
      if (!a) break;
      if (now < a.closes_at) break;
      closeAttempt(db, a, a.closes_at, 'timer');
      v.cursor += 1;
      if (v.cursor < v.queue.length) {
        openAttempt(db, v, v.queue[v.cursor], a.closes_at);
      } else {
        v.status = 'finished';
        v.finished_at = a.closes_at;
        db.screen = { mode: 'results', meeting_id: v.meeting_id, vote_id: v.id };
      }
      changed = true;
    }
  }
  return changed;
}

/* ================= сериализация ================= */
function serAttempt(a) {
  return {
    id: a.id, attempt_no: a.attempt_no, present_count: a.present_count,
    opened_at: iso(a.opened_at), closes_at: iso(a.closes_at), closed_at: iso(a.closed_at),
    for_count: a.for_count, against_count: a.against_count, abstain_count: a.abstain_count,
    total: a.for_count + a.against_count + a.abstain_count, is_valid: a.is_valid, end_reason: a.end_reason,
  };
}

function serVote(db, v) {
  const running = v.status === 'running';
  const items = itemsOfVote(db, v).map((it) => ({
    id: it.id, position: it.position, text: it.text, candidate_name: it.candidate_name, candidate_post: it.candidate_post,
    status: it.status,
    // Пока голосование идёт, итоги закрытых пунктов не раскрываются (FR-12, FR-13).
    attempts: running ? [] : attemptsOf(db, it).filter((a) => a.closed_at != null).map(serAttempt),
  }));
  const problems = [];
  if (!v.title.trim()) problems.push('нет заголовка');
  if (v.kind === 'single' && !items[0]?.text?.trim()) problems.push('нет текста вопроса');
  if (v.kind === 'batch') {
    const noPost = items.filter((i) => !String(i.candidate_post || '').trim()).length;
    const noName = items.filter((i) => !String(i.candidate_name || '').trim()).length;
    if (!items.length) problems.push('нет кандидатур');
    if (noName) problems.push(`без ФИО: ${noName}`);
    if (noPost) problems.push(`без должности: ${noPost}`);
  }
  return {
    id: v.id, meeting_id: v.meeting_id, kind: v.kind, title: v.title, item_seconds: v.item_seconds,
    position: v.position, status: v.status, started_at: iso(v.started_at), finished_at: iso(v.finished_at),
    items_count: items.length,
    invalid_count: running ? null : items.filter((i) => i.status === 'invalid').length,
    problems,
    items,
  };
}

function serMeetingSummary(db, m) {
  const votes = db.votes.filter((v) => v.meeting_id === m.id);
  return {
    id: m.id, held_on: m.held_on, title: m.title, status: m.status, present_count: m.present_count,
    votes_count: votes.length,
    ready_count: votes.filter((v) => v.status === 'ready').length,
    items_count: votes.reduce((s, v) => s + db.items.filter((i) => i.vote_id === v.id).length, 0),
    has_running: votes.some((v) => v.status === 'running'),
  };
}

function serMeeting(db, m) {
  return {
    ...serMeetingSummary(db, m),
    votes: db.votes.filter((v) => v.meeting_id === m.id).sort((a, b) => a.position - b.position).map((v) => serVote(db, v)),
  };
}

function serDevice(d, now) {
  const last = d.sim === 'online' ? now - Math.round(rnd(100, 500)) : d.last_seen_fixed;
  return {
    id: d.id, label: d.label, mac: d.mac, is_active: d.is_active, last_seen_at: iso(last),
    battery_mv: d.battery_mv, firmware_version: d.firmware_version,
  };
}

function screenState(db, now) {
  const s = db.screen || { mode: 'idle' };
  const m = s.meeting_id ? db.meetings.find((x) => x.id === s.meeting_id) : null;
  const meeting = m ? { id: m.id, title: m.title, held_on: m.held_on } : null;
  if (s.mode === 'agenda' && m) {
    return {
      mode: 'agenda', meeting,
      votes: db.votes.filter((v) => v.meeting_id === m.id && v.status !== 'draft').sort((a, b) => a.position - b.position)
        .map((v) => ({ title: v.title, kind: v.kind, items_count: db.items.filter((i) => i.vote_id === v.id).length, status: v.status })),
    };
  }
  const v = s.vote_id ? db.votes.find((x) => x.id === s.vote_id) : null;
  if (s.mode === 'voting' && v && v.status === 'running') {
    const a = openAttemptOf(db, v);
    if (a) {
      const item = db.items.find((i) => i.id === a.item_id);
      const all = itemsOfVote(db, v);
      return {
        mode: 'voting', meeting, present: a.present_count,
        vote: { id: v.id, title: v.title, kind: v.kind },
        item: { position: item.position, total: all.length, text: item.text, candidate_name: item.candidate_name, candidate_post: item.candidate_post, attempt_no: a.attempt_no },
        seconds_left: Math.max(0, (a.closes_at - now) / 1000),
        item_seconds: v.item_seconds,
        // Ни одного счётчика во время голосования (ТЗ 11.3).
      };
    }
  }
  if ((s.mode === 'results' || s.mode === 'stopped') && v) {
    const sv = serVote(db, v);
    return {
      mode: s.mode, meeting, present: m ? m.present_count : null,
      vote: { id: v.id, title: v.title, kind: v.kind, status: v.status },
      items: sv.items.map((it) => {
        const last = it.attempts[it.attempts.length - 1] || null;
        return { position: it.position, text: it.text, candidate_name: it.candidate_name, candidate_post: it.candidate_post, status: it.status, attempt: last };
      }),
    };
  }
  return { mode: 'idle', meeting };
}

/* ================= валидация ================= */
function cleanVotePayload(body, { requireReady }) {
  const kind = body.kind;
  if (!['single', 'batch'].includes(kind)) fail(422, 'Укажите тип голосования.');
  const title = String(body.title || '').trim();
  if (!title) fail(422, 'Укажите заголовок голосования.');
  if (title.length > 200) fail(422, 'Заголовок длиннее 200 символов.');
  const sec = Number(body.item_seconds);
  if (!Number.isInteger(sec) || sec < 10 || sec > 300) fail(422, 'Длительность пункта — от 10 до 300 секунд.');
  const items = Array.isArray(body.items) ? body.items : [];
  const clean = items.map((it) => ({
    text: String(it.text ?? it.candidate_name ?? '').trim(),
    candidate_name: kind === 'batch' ? String(it.candidate_name || '').trim() : null,
    candidate_post: kind === 'batch' ? String(it.candidate_post || '').trim() : null,
  }));
  if (kind === 'single' && clean.length !== 1) fail(422, 'У одиночного голосования ровно один вопрос.');
  if (kind === 'batch' && clean.length > 60) fail(422, 'Не больше 60 кандидатур в одном пакете.');
  if (requireReady) {
    if (!clean.length) fail(422, 'Добавьте хотя бы одну кандидатуру.');
    if (kind === 'single' && !clean[0].text) fail(422, 'Введите текст вопроса.');
    if (kind === 'batch' && clean.some((c) => !c.candidate_name || !c.candidate_post)) fail(422, 'У каждой кандидатуры нужны ФИО и должность.');
  }
  return { kind, title, item_seconds: sec, items: clean, status: requireReady ? 'ready' : 'draft' };
}

function writeItems(db, v, items) {
  db.items = db.items.filter((i) => i.vote_id !== v.id);
  items.forEach((it, idx) => db.items.push({ id: nextId(db, 'item'), vote_id: v.id, position: idx + 1, ...it, text: v.kind === 'batch' ? it.candidate_name : it.text, status: 'pending' }));
}

function audit(db, user, action, objectType, objectId) {
  db.audit.push({ id: nextId(db, 'audit'), ts: Date.now(), user_id: user ? user.id : null, action, object_type: objectType, object_id: objectId });
  if (db.audit.length > 500) db.audit.shift();
}

/* ================= маршруты ================= */
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>\\d+)') + '$'), handler, ...opts });

const getMeeting = (db, id) => db.meetings.find((m) => m.id === Number(id)) || fail(404, 'Заседание не найдено.');
const getVote = (db, id) => db.votes.find((v) => v.id === Number(id)) || fail(404, 'Голосование не найдено.');
const getDevice = (db, id) => db.devices.find((d) => d.id === Number(id)) || fail(404, 'Пульт не найден.');

/* --- авторизация --- */
route('POST', '/api/auth/login', ({ db, body }) => {
  const u = db.users.find((x) => x.login === String(body?.login || '').trim() && x.password === body?.password);
  if (!u) fail(401, 'Неверный логин или пароль.');
  localStorage.setItem(SESSION, String(u.id));
  audit(db, u, 'auth.login', 'user', u.id);
  return { id: u.id, login: u.login, name: u.name, role: u.role };
}, { public: true });
route('POST', '/api/auth/logout', () => { localStorage.removeItem(SESSION); return null; }, { public: true });
route('GET', '/api/auth/me', ({ user }) => ({ id: user.id, login: user.login, name: user.name, role: user.role }));

/* --- заседания --- */
route('GET', '/api/meetings', ({ db }) => db.meetings.slice().sort((a, b) => a.held_on.localeCompare(b.held_on)).map((m) => serMeetingSummary(db, m)));
route('POST', '/api/meetings', ({ db, body, user }) => {
  const held_on = String(body?.held_on || '');
  const title = String(body?.title || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(held_on)) fail(422, 'Укажите дату заседания.');
  if (!title) fail(422, 'Укажите название заседания.');
  const m = { id: nextId(db, 'meeting'), held_on, title, status: 'planned', present_count: null, created_at: Date.now() };
  db.meetings.push(m);
  audit(db, user, 'meeting.create', 'meeting', m.id);
  return [201, serMeeting(db, m)];
});
route('GET', '/api/meetings/:id', ({ db, p }) => serMeeting(db, getMeeting(db, p.id)));
route('PATCH', '/api/meetings/:id', ({ db, p, body, user }) => {
  const m = getMeeting(db, p.id);
  const running = db.votes.some((v) => v.meeting_id === m.id && v.status === 'running');
  if ('present_count' in body) {
    if (running) fail(409, 'Число присутствующих нельзя менять во время голосования.');
    const n = body.present_count === null ? null : Number(body.present_count);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > COUNCIL)) fail(422, `Число присутствующих — от 1 до ${COUNCIL}.`);
    m.present_count = n;
  }
  if ('title' in body) { const t = String(body.title || '').trim(); if (!t) fail(422, 'Укажите название заседания.'); m.title = t; }
  if ('held_on' in body) { if (!/^\d{4}-\d{2}-\d{2}$/.test(body.held_on)) fail(422, 'Укажите дату заседания.'); m.held_on = body.held_on; }
  if ('status' in body) {
    const to = body.status;
    const ok = (m.status === 'planned' && to === 'open') || (m.status === 'open' && to === 'closed') || (m.status === 'open' && to === 'planned');
    if (!ok && to !== m.status) fail(409, 'Такой переход статуса заседания невозможен.');
    if (to === 'closed' && running) fail(409, 'Сначала дождитесь окончания голосования или остановите его.');
    m.status = to;
    if (to === 'closed' && db.screen.meeting_id === m.id) db.screen = { mode: 'idle' };
  }
  audit(db, user, 'meeting.update', 'meeting', m.id);
  return serMeeting(db, m);
});
route('POST', '/api/meetings/:id/show-agenda', ({ db, p, user }) => {
  const m = getMeeting(db, p.id);
  if (db.votes.some((v) => v.status === 'running')) fail(409, 'Во время голосования экран показывает голосование.');
  db.screen = { mode: 'agenda', meeting_id: m.id };
  audit(db, user, 'screen.agenda', 'meeting', m.id);
  return null;
});
route('PUT', '/api/meetings/:id/votes/order', ({ db, p, body }) => {
  const m = getMeeting(db, p.id);
  const ids = (body?.vote_ids || []).map(Number);
  const votes = db.votes.filter((v) => v.meeting_id === m.id);
  if (ids.length !== votes.length || votes.some((v) => !ids.includes(v.id))) fail(422, 'Передайте все голосования заседания.');
  ids.forEach((id, i) => { votes.find((v) => v.id === id).position = i + 1; });
  return serMeeting(db, m);
});

/* --- голосования --- */
route('POST', '/api/meetings/:id/votes', ({ db, p, body, user }) => {
  const m = getMeeting(db, p.id);
  if (m.status === 'closed') fail(409, 'Заседание уже проведено.');
  const data = cleanVotePayload(body || {}, { requireReady: body?.status === 'ready' });
  const v = {
    id: nextId(db, 'vote'), meeting_id: m.id, kind: data.kind, title: data.title, item_seconds: data.item_seconds,
    position: db.votes.filter((x) => x.meeting_id === m.id).length + 1, status: data.status,
    started_at: null, finished_at: null, queue: [], cursor: 0,
  };
  db.votes.push(v);
  writeItems(db, v, data.items);
  audit(db, user, 'vote.create', 'vote', v.id);
  return [201, serVote(db, v)];
});
route('GET', '/api/votes/:id', ({ db, p }) => serVote(db, getVote(db, p.id)));
route('PUT', '/api/votes/:id', ({ db, p, body, user }) => {
  const v = getVote(db, p.id);
  if (!['draft', 'ready'].includes(v.status)) fail(409, 'Запущенное голосование изменить нельзя.');
  const data = cleanVotePayload(body || {}, { requireReady: body?.status === 'ready' });
  Object.assign(v, { kind: data.kind, title: data.title, item_seconds: data.item_seconds, status: data.status });
  writeItems(db, v, data.items);
  audit(db, user, 'vote.update', 'vote', v.id);
  return serVote(db, v);
});
route('DELETE', '/api/votes/:id', ({ db, p, user }) => {
  const v = getVote(db, p.id);
  if (!['draft', 'ready'].includes(v.status)) fail(409, 'Проведённое голосование удалить нельзя.');
  db.items = db.items.filter((i) => i.vote_id !== v.id);
  db.votes = db.votes.filter((x) => x.id !== v.id);
  db.votes.filter((x) => x.meeting_id === v.meeting_id).sort((a, b) => a.position - b.position).forEach((x, i) => { x.position = i + 1; });
  audit(db, user, 'vote.delete', 'vote', v.id);
  return null;
});
route('POST', '/api/votes/:id/start', ({ db, p, user, now }) => {
  const v = getVote(db, p.id);
  const m = meetingOf(db, v);
  if (m.status !== 'open') fail(409, 'Сначала откройте заседание.');
  if (!m.present_count) fail(422, 'Укажите число присутствующих.');
  if (v.status === 'draft') fail(409, 'Голосование ещё черновик — заполните его в редакторе.');
  if (v.status !== 'ready') fail(409, 'Это голосование уже проводилось.');
  if (db.votes.some((x) => x.status === 'running')) fail(409, 'Уже идёт другое голосование.');
  v.status = 'running';
  v.started_at = now;
  v.queue = itemsOfVote(db, v).map((i) => i.id);
  v.cursor = 0;
  openAttempt(db, v, v.queue[0], now);
  audit(db, user, 'vote.start', 'vote', v.id);
  return serVote(db, v);
});
route('POST', '/api/votes/:id/stop', ({ db, p, user, now }) => {
  const v = getVote(db, p.id);
  if (v.status !== 'running') fail(409, 'Голосование не идёт.');
  const a = openAttemptOf(db, v);
  if (a) closeAttempt(db, a, now, 'stopped');
  v.status = 'stopped';
  v.finished_at = now;
  db.screen = { mode: 'stopped', meeting_id: v.meeting_id, vote_id: v.id };
  audit(db, user, 'vote.stop', 'vote', v.id);
  return serVote(db, v);
});
route('POST', '/api/votes/:id/repeat', ({ db, p, user, now }) => {
  const v = getVote(db, p.id);
  if (v.status === 'stopped') fail(409, 'Остановленное голосование проводится на бумаге (FR-19).');
  if (v.status !== 'finished') fail(409, 'Повторить можно только после окончания голосования.');
  if (db.votes.some((x) => x.status === 'running')) fail(409, 'Уже идёт другое голосование.');
  const invalid = itemsOfVote(db, v).filter((i) => i.status === 'invalid');
  if (!invalid.length) fail(409, 'Недействительных пунктов нет.');
  const m = meetingOf(db, v);
  if (m.status !== 'open') fail(409, 'Заседание не открыто.');
  v.status = 'running';
  v.queue = invalid.map((i) => i.id);
  v.cursor = 0;
  openAttempt(db, v, v.queue[0], now);
  audit(db, user, 'vote.repeat', 'vote', v.id);
  return serVote(db, v);
});
route('POST', '/api/votes/:id/paper', ({ db, p, user }) => {
  const v = getVote(db, p.id);
  if (v.status === 'running') fail(409, 'Сначала остановите голосование.');
  itemsOfVote(db, v).forEach((i) => { if (i.status === 'invalid' || i.status === 'pending') i.status = 'paper'; });
  audit(db, user, 'vote.paper', 'vote', v.id);
  return serVote(db, v);
});
route('GET', '/api/votes/:id/progress', ({ db, p, now }) => {
  const v = getVote(db, p.id);
  const all = itemsOfVote(db, v);
  if (v.status !== 'running') return { status: v.status, total_items: all.length };
  const a = openAttemptOf(db, v);
  const item = db.items.find((i) => i.id === a.item_id);
  const received = (db.sim[a.id] || []).filter((x) => x.at <= now).length;
  return {
    status: 'running',
    current_position: item.position,
    total_items: all.length,
    queue_index: v.cursor + 1,
    queue_total: v.queue.length,
    is_repeat: a.attempt_no > 1,
    received,
    present: a.present_count,
    seconds_left: Math.max(0, (a.closes_at - now) / 1000),
    item_seconds: v.item_seconds,
    item: { id: item.id, text: item.text, candidate_name: item.candidate_name, candidate_post: item.candidate_post, attempt_no: a.attempt_no },
  };
});
route('POST', '/api/votes/:id/show-results', ({ db, p }) => {
  const v = getVote(db, p.id);
  if (v.status === 'running') fail(409, 'Итоги появятся после окончания голосования.');
  if (db.votes.some((x) => x.status === 'running')) fail(409, 'Сейчас идёт другое голосование.');
  db.screen = { mode: 'results', meeting_id: v.meeting_id, vote_id: v.id };
  return null;
});

/* --- история и выгрузка --- */
function historyData(db, from, to) {
  return db.meetings
    .filter((m) => (!from || m.held_on >= from) && (!to || m.held_on <= to))
    .map((m) => {
      const votes = db.votes.filter((v) => v.meeting_id === m.id && ['finished', 'stopped'].includes(v.status))
        .sort((a, b) => a.position - b.position).map((v) => serVote(db, v));
      return { id: m.id, held_on: m.held_on, title: m.title, status: m.status, present_count: m.present_count, votes };
    })
    .filter((m) => m.votes.length)
    .sort((a, b) => b.held_on.localeCompare(a.held_on));
}
route('GET', '/api/history', ({ db, query }) => historyData(db, query.get('from'), query.get('to')));

/* --- пульты --- */
route('GET', '/api/devices', ({ db, now }) => db.devices.map((d) => serDevice(d, now)));
route('POST', '/api/devices', ({ db, body, user, now }) => {
  const label = String(body?.label || '').trim();
  const mac = String(body?.mac || '').trim().toUpperCase();
  if (!label) fail(422, 'Укажите номер пульта.');
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) fail(422, 'MAC-адрес в формате A4:CF:12:3B:7E:A2.');
  if (db.devices.some((d) => d.mac === mac)) fail(409, 'Пульт с таким MAC уже зарегистрирован.');
  if (db.devices.some((d) => d.label === label)) fail(409, 'Такой номер уже занят.');
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const d = { id: nextId(db, 'device'), label, mac, is_active: true, sim: 'online', last_seen_fixed: null, battery_mv: null, firmware_version: '1.2.0' };
  db.devices.push(d);
  audit(db, user, 'device.create', 'device', d.id);
  return [201, { ...serDevice(d, now), secret_key: secret }];
}, { admin: true });
route('PATCH', '/api/devices/:id', ({ db, p, body, user, now }) => {
  const d = getDevice(db, p.id);
  if ('is_active' in body) d.is_active = !!body.is_active;
  if ('label' in body) d.label = String(body.label).trim() || d.label;
  audit(db, user, 'device.update', 'device', d.id);
  return serDevice(d, now);
}, { admin: true });
route('POST', '/api/devices/:id/identify', ({ db, p }) => {
  const d = getDevice(db, p.id);
  if (!d.is_active) fail(409, 'Пульт выведен из работы.');
  if (d.sim !== 'online') fail(409, 'Пульт не на связи.');
  return null;
}, { admin: true });
route('GET', '/api/admin/backup', ({ db }) => ({ backup_at: iso(db.backup_at), target: 'USB-накопитель' }), { admin: true });
route('POST', '/api/admin/backup', ({ db, user, now }) => {
  db.backup_at = now;
  audit(db, user, 'backup.run', null, null);
  return { backup_at: iso(now), target: 'USB-накопитель' };
}, { admin: true });

/* --- экран --- */
route('GET', '/api/screen/state', ({ db, now }) => screenState(db, now), { public: true });

/* ================= точка входа ================= */
export async function handle(method, fullPath, body) {
  await sleep(rnd(60, 160)); // имитация сети
  const url = new URL(fullPath, location.origin);
  const r = routes.find((x) => x.method === method && x.re.test(url.pathname));
  if (!r) return { status: 404, data: { detail: 'Маршрут не найден в демо-сервере.' } };
  const db = load();
  const now = Date.now();
  const changed = advance(db, now);
  const userId = Number(localStorage.getItem(SESSION));
  const user = db.users.find((u) => u.id === userId) || null;
  if (!r.public && !user) return { status: 401, data: { detail: 'Нужно войти.' } };
  if (r.admin && user.role !== 'admin' && method !== 'GET') return { status: 403, data: { detail: 'Действие доступно администратору.' } };
  if (r.admin && user.role !== 'admin' && method === 'GET' && url.pathname.startsWith('/api/admin')) return { status: 403, data: { detail: 'Раздел доступен администратору.' } };
  try {
    const p = url.pathname.match(r.re).groups || {};
    let out = r.handler({ db, p, body: body || {}, user, now, query: url.searchParams });
    let status = 200;
    if (Array.isArray(out) && out.length === 2 && typeof out[0] === 'number') [status, out] = out;
    if (out === null) status = status === 200 ? 204 : status;
    if (method !== 'GET' || changed) save(db);
    return { status, data: out === undefined ? null : JSON.parse(JSON.stringify(out)) };
  } catch (e) {
    if (changed) save(db);
    if (e instanceof HttpError) return { status: e.status, data: { detail: e.detail } };
    console.error(e);
    return { status: 500, data: { detail: 'Внутренняя ошибка демо-сервера.' } };
  }
}

/** Выгрузка (в демо — CSV, который открывается в Excel и Р7-Офис; настоящий сервер отдаёт .xlsx). */
export async function exportFile({ meeting_id, from, to } = {}) {
  const db = load();
  advance(db, Date.now());
  let meetings = historyData(db, from, to);
  if (meeting_id) meetings = historyData(db).filter((m) => m.id === Number(meeting_id));
  const head = ['Дата', 'Заседание', 'Голосование', 'Тип', '№ пункта', 'Вопрос / Кандидатура', 'Должность', 'Попытка', 'Присутствовало', 'За', 'Против', 'Воздержался', 'Всего', 'Действительно'];
  const rows = [head];
  for (const m of meetings) {
    for (const v of m.votes) {
      for (const it of v.items) {
        for (const a of it.attempts) {
          rows.push([
            m.held_on.split('-').reverse().join('.'), m.title, v.title, v.kind === 'batch' ? 'пакетное' : 'одиночное', it.position,
            v.kind === 'batch' ? it.candidate_name : it.text, it.candidate_post || '', a.attempt_no, a.present_count,
            a.for_count, a.against_count, a.abstain_count, a.total,
            a.end_reason === 'stopped' ? (it.status === 'paper' ? 'нет (бумага)' : 'нет (остановлено)') : a.is_valid ? 'да' : 'нет',
          ]);
        }
      }
    }
  }
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const name = meeting_id
    ? `golosovanie_${(meetings[0]?.held_on || 'zasedanie')}.csv`
    : `golosovanie_${from || 'start'}_${to || todayISO()}.csv`;
  return { blob, filename: name };
}
