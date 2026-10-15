/** Форматирование дат, чисел и русских окончаний. */

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** '2026-10-15' → Date в локальном времени (без сдвига часового пояса). */
export function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date → '2026-10-15' (локально). */
export function toISODate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export const pad2 = (n) => String(n).padStart(2, '0');

/** '15 октября 2026' */
export function fmtDate(iso, { year = true } = {}) {
  const d = parseDate(iso);
  if (!d) return '—';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`;
}

/** '15.10.2026' */
export function fmtDateNum(iso) {
  const d = parseDate(iso);
  return d ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}` : '—';
}

export function dateParts(iso) {
  const d = parseDate(iso);
  return {
    day: d ? String(d.getDate()) : '—',
    mon: d ? MONTHS_SHORT[d.getMonth()] : '',
    weekday: d ? WEEKDAYS[d.getDay()] : '',
    wd: d ? WEEKDAYS_SHORT[d.getDay()] : '',
  };
}

/** Дней до даты (0 — сегодня, отрицательное — прошло). */
export function daysUntil(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d - t) / 86400000);
}

/** plural(5, ['пункт', 'пункта', 'пунктов']) → 'пунктов' */
export function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
export const nPlural = (n, forms) => `${n} ${plural(n, forms)}`;

export const W = {
  vote: ['голосование', 'голосования', 'голосований'],
  item: ['пункт', 'пункта', 'пунктов'],
  candidate: ['кандидатура', 'кандидатуры', 'кандидатур'],
  meeting: ['заседание', 'заседания', 'заседаний'],
  day: ['день', 'дня', 'дней'],
  device: ['пульт', 'пульта', 'пультов'],
};

/** 100 → '1 мин 40 с' */
export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return `${r} с`;
  return r ? `${m} мин ${r} с` : `${m} мин`;
}

/** 7 → '0:07' */
export function fmtTimer(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** Время с момента (ms или ISO) по-русски: «0,4 с назад», «3 мин назад», «12 дн. назад». */
export function fmtAgo(ts) {
  if (!ts) return 'нет данных';
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 10) return `${diff.toFixed(1).replace('.', ',')} с назад`;
  if (diff < 60) return `${Math.round(diff)} с назад`;
  if (diff < 3600) return `${Math.round(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.round(diff / 3600)} ч назад`;
  return `${Math.round(diff / 86400)} дн. назад`;
}

/** '14:32' */
export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** «Иванов Иван Иванович» → «Иванов И. И.» */
export function shortName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  if (parts.length < 2) return full || '';
  return `${parts[0]} ${parts.slice(1).map((p) => p[0] + '.').join(' ')}`;
}

/** Инициалы для аватарки: «Ковалёва Е. А.» → «ЕК» */
export function initials(name) {
  const parts = String(name || '').replace(/\./g, ' ').trim().split(/\s+/);
  if (!parts[0]) return '?';
  return ((parts[1] ? parts[1][0] : '') + parts[0][0]).toUpperCase();
}

/** Учебный год для даты: сентябрь–июнь. */
export function academicYear(date = new Date()) {
  const y = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  return { from: `${y}-09-01`, to: `${y + 1}-06-30`, label: `${y}/${String(y + 1).slice(2)}` };
}
