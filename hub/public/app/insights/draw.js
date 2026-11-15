// What the Insights page and the Desk card draw with: day arithmetic in the
// browser's time zone, words for durations, the calendar of days, the bar and
// line charts, and one tooltip. Ink and paper only: the dither steps stand in
// for a second colour, and the legend says which is which.

import { h, s } from '../dom.js';

export const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---- Days, as yyyy-mm-dd ----
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const today = () => dayFmt.format(new Date());
const utc = (d) => Date.parse(`${d}T12:00:00Z`);
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => fromUtc(utc(d) + n * 86400000);
export function addMonths(d, n) {
  const x = new Date(utc(d));
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  return fromUtc(x.getTime());
}
export const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && fromUtc(utc(d)) === d;
export const monday = (d) => addDays(d, -((new Date(utc(d)).getUTCDay() + 6) % 7));
export const firstOfMonth = (d) => `${d.slice(0, 7)}-01`;
export const shortDay = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
export const monthName = (d) => `${MONTHS_LONG[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
export function longDay(d) {
  const x = new Date(utc(d));
  return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS_LONG[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}
export const weekdayName = (d) => DAYS[new Date(utc(d)).getUTCDay()];
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const hm = (ts) => hmFmt.format(new Date(ts));

// ---- Durations ----
export function duration(hours) {
  if (hours === null || hours === undefined) return 'n/a';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

// ---- A headline number ----
export function stat(label, value, sub) {
  return h('div', { class: 'om-stat' },
    h('span', { class: 'om-label' }, label),
    h('span', { class: 'om-stat-value' }, value),
    sub ? h('span', { class: 'om-caption' }, sub) : null);
}

// ---- Levels for the calendar: empty, then four dither steps by quartile ----
export function levels(values) {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => (nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 0);
  const cuts = [q(0.25), q(0.5), q(0.75)];
  return (v) => (v <= 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4);
}
export const LEVEL_CLASS = ['ins-l0', 'ins-l1 om-d25', 'ins-l2 om-d50', 'ins-l3 om-d75', 'ins-l4'];

export function levelKey() {
  return h('span', { class: 'ins-key' }, 'Fewer',
    LEVEL_CLASS.map((c) => h('i', { class: `ins-cell ${c}`, 'aria-hidden': 'true' })), 'More');
}

// ---- One tooltip per page ----
// Marks carry data-tip="line|line|line". The tip follows the pointer inside
// its sheet and also shows on keyboard focus.
export function tooltips(root) {
  const tip = h('div', { class: 'ins-tip', role: 'tooltip', hidden: true });
  const place = (el, x, y) => {
    const sheet = el.closest('.om-sheet') || root;
    if (tip.parentNode !== sheet) sheet.append(tip);
    const lines = el.dataset.tip.split('|');
    tip.replaceChildren(h('b', null, lines[0]), ...lines.slice(1).map((l) => h('span', { class: 'om-data-s' }, l)));
    tip.hidden = false;
    const box = sheet.getBoundingClientRect();
    let left = x - box.left + 14;
    if (left + 236 > box.width) left = x - box.left - 246;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${y - box.top + 14}px`;
  };
  const move = (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el || !root.contains(el)) { tip.hidden = true; return; }
    place(el, e.clientX, e.clientY);
  };
  const focus = (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    place(el, r.right, r.bottom);
  };
  const hide = () => { tip.hidden = true; };
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focusin', focus);
  root.addEventListener('focusout', hide);
  return tip;
}

// ---- The calendar: weeks as columns, Monday on top ----
// days: [{ day, entries, done, created }]; href(day) for each cell.
export function calendar(days, href, mark) {
  const level = levels(days.map((d) => d.entries));
  const grid = h('div', { class: 'ins-cal', role: 'group', 'aria-label': 'Log entries per day' });
  const labels = ['', 'Mon', '', 'Wed', '', 'Fri', '', ''];
  labels.forEach((l) => grid.append(h('span', { class: 'ins-lab' }, l)));
  if (!days.length) return grid;
  const pad = (new Date(utc(days[0].day)).getUTCDay() + 6) % 7;
  const cells = Array(pad).fill(null).concat(days);
  let lastMonth = '';
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    const first = week.find(Boolean);
    const m = first ? first.day.slice(5, 7) : '';
    grid.append(h('span', { class: 'ins-lab' }, m && m !== lastMonth ? MONTHS[Number(m) - 1] : ''));
    if (m) lastMonth = m;
    for (let k = 0; k < 7; k++) {
      const d = week[k];
      if (!d) { grid.append(h('span')); continue; }
      grid.append(h('a', {
        class: ['ins-cell', LEVEL_CLASS[level(d.entries)], d.day === mark ? 'is-mark' : null],
        href: href(d.day),
        'aria-label': `${longDay(d.day)}: ${d.entries} log entries, ${d.done} done, ${d.created} filed`,
        dataset: { tip: `${longDay(d.day)}|${d.entries} log entries|${d.done} done, ${d.created} filed` },
      }));
    }
  }
  return grid;
}

// ---- Charts ----
function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function frame(w, hgt, label) {
  return s('svg', { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, role: 'img', 'aria-label': label, class: 'ins-svg' },
    s('defs', null, s('pattern', { id: 'ins-dith', width: 4, height: 4, patternUnits: 'userSpaceOnUse' },
      s('rect', { width: 2, height: 2, fill: 'currentColor' }), s('rect', { x: 2, y: 2, width: 2, height: 2, fill: 'currentColor' }))));
}
// Whole numbers on every gridline: 50 splits in 5, 20 in 4, 5 in 5.
const stepsFor = (max) => (max % 4 === 0 && max > 5 ? 4 : 5);
function gridLines(svg, { L, R, W, y, max, steps }) {
  for (let k = 0; k <= steps; k++) {
    const v = (max / steps) * k;
    svg.append(s('line', { class: 'ins-grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }),
      s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, String(v)));
  }
}

// Filed (outline) beside closed (done solid, discarded dithered on top), one
// pair per period. periods: [{ label, tip, created, done, discarded, failed }].
export function flowChart(periods, width) {
  const W = Math.max(280, width), H = 240, L = 34, R = 8, T = 18, B = 28;
  const max = niceMax(Math.max(1, ...periods.map((p) => Math.max(p.created, p.done + p.discarded + p.failed))));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const cw = (W - L - R) / Math.max(1, periods.length);
  const bw = Math.max(2, Math.min(18, (cw - 6) / 2));
  const svg = frame(W, H, 'Missions filed and closed per period');
  gridLines(svg, { L, R, W, y, max, steps: stepsFor(max) });
  svg.append(s('line', { class: 'ins-axis', x1: L, x2: W - R, y1: y(0), y2: y(0) }));
  const every = Math.ceil(periods.length / Math.max(1, Math.floor((W - L) / 64)));
  periods.forEach((p, i) => {
    const cx = L + cw * i + cw / 2;
    const closed = p.done + p.discarded + p.failed;
    const g = s('g', { class: 'ins-mark', tabindex: 0, dataset: { tip: p.tip } },
      s('rect', { class: 'ins-hit', x: L + cw * i, y: T, width: cw, height: H - T - B }));
    if (p.created) g.append(s('rect', { class: 'ins-out', x: cx - bw - 1, y: y(p.created), width: bw, height: y(0) - y(p.created) }));
    if (p.done) g.append(s('rect', { class: 'ins-solid', x: cx + 1, y: y(p.done), width: bw, height: y(0) - y(p.done) }));
    const rest = p.discarded + p.failed;
    // A 2px paper gap between the done and discarded parts of the stack.
    if (rest) g.append(s('rect', { class: 'ins-dith', x: cx + 1, y: y(closed), width: bw, height: Math.max(1, y(p.done) - y(closed) - (p.done ? 2 : 0)) }));
    svg.append(g);
    if (i % every === 0) svg.append(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, p.label));
  });
  const last = periods[periods.length - 1];
  if (last) {
    svg.append(s('text', { x: L + cw * (periods.length - 1) + cw / 2, y: y(Math.max(last.created, last.done + last.discarded + last.failed)) - 6, 'text-anchor': 'middle' }, `${last.done} done`));
  }
  return svg;
}

// A count at the end of each period, as a line with its points.
// points: [{ label, tip, value }].
export function lineChart(points, width, label) {
  const W = Math.max(260, width), H = 180, L = 30, R = 26, T = 20, B = 26;
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  const x = (i) => L + ((W - L - R) * i) / Math.max(1, points.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const svg = frame(W, H, label);
  gridLines(svg, { L, R, W, y, max, steps: max % 2 === 0 ? 2 : 5 });
  if (!points.length) return svg;
  const pts = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  svg.append(s('polygon', { class: 'ins-area', points: `${x(0)},${y(0)} ${pts} ${x(points.length - 1)},${y(0)}` }),
    s('polyline', { class: 'ins-line', points: pts }));
  const every = Math.ceil(points.length / Math.max(1, Math.floor((W - L) / 56)));
  points.forEach((p, i) => {
    svg.append(s('g', { class: 'ins-mark', tabindex: 0, dataset: { tip: p.tip } },
      s('rect', { class: 'ins-hit', x: x(i) - 14, y: T, width: 28, height: H - T - B }),
      s('circle', { class: 'ins-dot', cx: x(i), cy: y(p.value), r: 4 })));
    if (i % every === 0) svg.append(s('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, p.label));
  });
  const top = points.reduce((a, p, i) => (p.value > points[a].value ? i : a), 0);
  svg.append(s('text', { x: x(top), y: y(points[top].value) - 9, 'text-anchor': 'middle' }, String(points[top].value)));
  return svg;
}

// A labelled bar and its number, for short ranked lists.
export function barRows(rows) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return h('div', { class: 'ins-rows' }, rows.map((r) => h('div', { class: 'ins-rowbar' },
    h('span', { class: 'om-body-s ins-rowlabel' }, r.label),
    h('span', { class: 'ins-share', 'aria-hidden': 'true' }, h('i', { style: { width: `${max ? (r.value / max) * 100 : 0}%` } })),
    h('span', { class: 'om-data ins-num' }, String(r.value)))));
}
