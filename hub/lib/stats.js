'use strict';
// Stats over the missions (doc 24, A4): what was filed, closed, ruled and
// waited on, per day, week or month, per project and per agent. Computed from
// the missions in memory, so it answers the same on both stores. Days are
// calendar days in the caller's time zone: a mission closed at 00:30 in Paris
// counts for that Paris day, not the UTC one.
//
// Missions from before the log recorded status changes (from and to) carry
// only notes. For those, the close time is the last log entry and the claim
// is the first "claimed" note; they are counted in `estimated`.

const CLOSED = ['done', 'failed', 'discarded'];
const GROUPS = ['day', 'week', 'month'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 800;
const HOUR = 3600000;
const DEFAULT_SPAN = { day: 30, week: 12 * 7, month: 365 };
const NOTE_MAX = 160;

// ---- Calendar days, as YYYY-MM-DD strings ----
const fmtCache = new Map();
function dayFormat(tz) {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return fmtCache.get(tz);
}
function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { dayFormat(tz); return true; } catch { return false; }
}
function dayOf(ts, tz) {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? dayFormat(tz).format(ms) : null;
}
function validDay(d) {
  if (typeof d !== 'string' || !DAY_RE.test(d)) return false;
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
}
const utcOf = (d) => Date.parse(`${d}T00:00:00Z`);
const dayFromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => dayFromUtc(utcOf(d) + n * 86400000);
const daysBetween = (a, b) => Math.round((utcOf(b) - utcOf(a)) / 86400000);
function addMonths(d, n) {
  const x = new Date(utcOf(d));
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  return dayFromUtc(x.getTime());
}
// The first day of the period holding d. Weeks start on Monday.
function periodOf(d, group) {
  if (group === 'day') return d;
  if (group === 'month') return `${d.slice(0, 7)}-01`;
  const dow = new Date(utcOf(d)).getUTCDay();
  return addDays(d, -((dow + 6) % 7));
}
function nextPeriod(p, group) {
  if (group === 'day') return addDays(p, 1);
  if (group === 'week') return addDays(p, 7);
  return addMonths(p, 1);
}

// Local midnight at the start of day d in tz, as epoch ms.
const partsCache = new Map();
function offsetAt(ms, tz) {
  if (!partsCache.has(tz)) partsCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const p = Object.fromEntries(partsCache.get(tz).formatToParts(ms).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - (ms - (ms % 1000));
}
function midnight(d, tz) {
  const utc = utcOf(d);
  let t = utc - offsetAt(utc, tz);
  const again = offsetAt(t, tz);
  if (utc - again !== t) t = utc - again;
  return t;
}

// ---- Reading the query ----
// Returns { from, to, group, tz, project, agent } or { error }.
function parseQuery(q, { today, tz: fallbackTz = 'UTC' } = {}) {
  const get = (k) => {
    const v = typeof q.get === 'function' ? q.get(k) : q[k];
    return v === null || v === undefined || v === '' ? null : String(v);
  };
  const tz = get('tz') || fallbackTz;
  if (!validTz(tz)) return { error: `unknown time zone: ${tz}. Use an IANA name such as Europe/Paris or UTC.` };
  const group = get('group') || 'week';
  if (!GROUPS.includes(group)) return { error: `group is one of ${GROUPS.join(', ')}` };
  const now = today || dayOf(new Date().toISOString(), tz);
  const to = get('to') || now;
  if (!validDay(to)) return { error: 'to is a date, yyyy-mm-dd' };
  const from = get('from') || addDays(to, -(DEFAULT_SPAN[group] - 1));
  if (!validDay(from)) return { error: 'from is a date, yyyy-mm-dd' };
  if (from > to) return { error: 'from comes after to' };
  if (daysBetween(from, to) + 1 > MAX_DAYS) return { error: `at most ${MAX_DAYS} days at a time` };
  return { from, to, group, tz, project: get('project'), agent: get('agent') };
}

// ---- One mission, read once ----
const isHuman = (l) => l.by === 'human';
const IN_CHAT = /^approved by boss in session\b/;
// What a log entry by the boss was. Older entries have no kind: approvals and
// verdicts are still recognisable by their words.
function rulingKind(l) {
  if (isHuman(l)) {
    if (l.kind && l.kind !== 'edit') return l.kind;
    const note = String(l.note || '');
    if (/^approved\b/i.test(note)) return 'approve';
    if (/^verdicts:/.test(note)) return 'verdict';
    return 'other';
  }
  if (IN_CHAT.test(String(l.note || ''))) return 'in_chat';
  return null;
}
const isSendBack = (l) => l.kind === 'send_back' || (l.from === 'review' && l.to === 'queued');

function facts(t, nowMs) {
  const log = (Array.isArray(t.log) ? t.log : []).filter((l) => l && typeof l.ts === 'string');
  const claimed = log.find((l) => l.to === 'claimed' || (!l.to && /^claimed\b/.test(String(l.note || ''))));
  let closedAt = null;
  let estimated = false;
  if (CLOSED.includes(t.status)) {
    const entry = [...log].reverse().find((l) => CLOSED.includes(l.to));
    if (entry) closedAt = entry.ts;
    else {
      closedAt = log.length ? log[log.length - 1].ts : (t.updated_at || t.created_at || null);
      estimated = true;
    }
  }
  // Time spent waiting: in review (on the boss's gate) or blocked. A wait
  // ends at the next status change; one still open runs to now.
  const waits = [];
  const reviewMs = [];
  for (let i = 0; i < log.length; i++) {
    const l = log[i];
    if (l.to !== 'review' && l.to !== 'blocked') continue;
    const end = log.slice(i + 1).find((x) => x.from || x.to);
    const startMs = Date.parse(l.ts);
    const endMs = end ? Date.parse(end.ts) : (t.status === l.to ? nowMs : startMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    waits.push([startMs, endMs, l.to]);
    if (l.to === 'review') reviewMs.push(Math.max(0, endMs - startMs));
  }
  return {
    claimedAt: claimed ? claimed.ts : null,
    closedAt,
    estimated,
    sendBacks: log.filter(isSendBack).length,
    waits,
    reviewMs: reviewMs.reduce((a, b) => a + b, 0),
    reviewed: reviewMs.length > 0,
    log,
  };
}

// ---- Small numbers ----
function quantile(values, q) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1));
  return v[i];
}
const hours = (ms) => (ms === null ? null : Math.round((ms / HOUR) * 10) / 10);
const spread = (list) => ({ median_h: hours(quantile(list, 0.5)), p90_h: hours(quantile(list, 0.9)), n: list.length });
const RULINGS = ['approve', 'in_chat', 'send_back', 'answer', 'verdict', 'other'];
const emptyRulings = () => Object.fromEntries(RULINGS.map((k) => [k, 0]));

function wanted(t, f, opts) {
  if (opts.project && t.project !== opts.project) return false;
  if (opts.agent && t.assignee !== opts.agent && !f.log.some((l) => l.by === opts.agent)) return false;
  return true;
}

// ---- The report ----
// tasks: the missions the caller sees. commits: brain commits
// [{author, date, files}] or null when the caller may not see the brain.
function compute(tasks, opts, commits = null, now = new Date()) {
  const { from, to, group, tz } = opts;
  const nowMs = now.getTime();
  const inRange = (d) => d !== null && d >= from && d <= to;

  // The periods, each with its first and last day.
  const periods = [];
  for (let p = periodOf(from, group); p <= to; p = nextPeriod(p, group)) {
    const last = addDays(nextPeriod(p, group), -1);
    periods.push({ start: p, end: last, created: 0, done: 0, failed: 0, discarded: 0, send_backs: 0, entries: 0, rulings: 0, waiting_end: 0 });
  }
  const periodIndex = new Map(periods.map((p, i) => [p.start, i]));
  const at = (d) => periods[periodIndex.get(periodOf(d, group))];

  const days = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { day: d, entries: 0, created: 0, done: 0 });

  const totals = { created: 0, done: 0, failed: 0, discarded: 0, send_backs: 0, estimated: 0, waiting_now: 0 };
  const rulings = emptyRulings();
  const projects = new Map();
  const agents = new Map();
  const cycle = [];
  const claimToClose = [];
  const reviewWaits = [];
  let doneWithSendBack = 0;
  const waits = [];
  const project = (id) => {
    const k = id || 'none';
    if (!projects.has(k)) projects.set(k, { project: k, created: 0, done: 0, failed: 0, discarded: 0, send_backs: 0, cycle: [] });
    return projects.get(k);
  };
  const agent = (name) => {
    if (!agents.has(name)) agents.set(name, { agent: name, claims: 0, notes: 0, done: 0, failed: 0, discarded: 0 });
    return agents.get(name);
  };

  for (const t of tasks) {
    const f = facts(t, nowMs);
    if (!wanted(t, f, opts)) continue;
    const pj = project(t.project);

    const created = dayOf(t.created_at, tz);
    if (inRange(created)) {
      totals.created++; pj.created++; at(created).created++; days.get(created).created++;
    }

    if (f.closedAt) {
      const closed = dayOf(f.closedAt, tz);
      if (inRange(closed)) {
        const kind = t.status;
        totals[kind]++; pj[kind]++; at(closed)[kind]++;
        if (kind === 'done') days.get(closed).done++;
        if (f.estimated) totals.estimated++;
        agent(t.assignee || 'unassigned')[kind]++;
        if (kind === 'done') {
          const c = Date.parse(f.closedAt) - Date.parse(t.created_at);
          if (Number.isFinite(c) && c >= 0) { cycle.push(c); pj.cycle.push(c); }
          if (f.claimedAt) {
            const k = Date.parse(f.closedAt) - Date.parse(f.claimedAt);
            if (Number.isFinite(k) && k >= 0) claimToClose.push(k);
          }
          if (f.reviewed) reviewWaits.push(f.reviewMs);
          if (f.sendBacks > 0) doneWithSendBack++;
        }
      }
    }

    if ((t.status === 'review' && t.gate === 'boss') || t.status === 'blocked') totals.waiting_now++;
    for (const w of f.waits) if (w[2] === 'blocked' || t.gate === 'boss') waits.push(w);

    // What happened in the log, day by day. One in-chat approval per mission
    // and day: the quote is often written twice (the note and the hub's echo).
    const inChatDays = new Set();
    for (const l of f.log) {
      const d = dayOf(l.ts, tz);
      if (!inRange(d) || l.by === 'system') continue;
      if (opts.agent && l.by !== opts.agent && !isHuman(l)) continue;
      days.get(d).entries++;
      at(d).entries++;
      if (isSendBack(l)) { totals.send_backs++; pj.send_backs++; at(d).send_backs++; }
      const r = rulingKind(l);
      if (r === 'in_chat') {
        if (inChatDays.has(d)) continue;
        inChatDays.add(d);
      }
      if (r) {
        // A send-back by the boss is counted once, as a ruling of that kind.
        rulings[r === 'other' && isSendBack(l) ? 'send_back' : r]++;
        at(d).rulings++;
      }
      if (!isHuman(l) && l.by) {
        const a = agent(l.by);
        if (l.to === 'claimed' || (!l.to && /^claimed\b/.test(String(l.note || '')))) a.claims++;
        else a.notes++;
      }
    }
  }

  // How many missions waited on the boss at the end of each period.
  for (const p of periods) {
    const cut = Math.min(midnight(addDays(p.end, 1), tz), nowMs);
    p.waiting_end = waits.filter(([s, e]) => s <= cut && e > cut).length;
  }

  let brain = null;
  if (Array.isArray(commits)) {
    const authors = new Map();
    const compartments = new Map();
    const perPeriod = periods.map(() => 0);
    let n = 0;
    for (const c of commits) {
      const d = dayOf(c.date, tz);
      if (!inRange(d)) continue;
      n++;
      authors.set(c.author, (authors.get(c.author) || 0) + 1);
      // A compartment is a top folder; files at the root (.gitattributes) are not one.
      for (const top of new Set((c.files || []).filter((file) => String(file).includes('/')).map((file) => String(file).split('/')[0]))) compartments.set(top, (compartments.get(top) || 0) + 1);
      perPeriod[periodIndex.get(periodOf(d, group))]++;
    }
    const sorted = (m, key) => [...m].map(([k, v]) => ({ [key]: k, commits: v })).sort((a, b) => b.commits - a.commits || String(a[key]).localeCompare(String(b[key])));
    brain = { commits: n, authors: sorted(authors, 'author'), compartments: sorted(compartments, 'compartment'), periods: perPeriod };
  }

  const done = totals.done;
  return {
    from, to, group, tz, project: opts.project || null, agent: opts.agent || null, generated_at: now.toISOString(),
    totals: {
      ...totals,
      send_back_rate: done ? Math.round((doneWithSendBack / done) * 1000) / 1000 : null,
      cycle: spread(cycle),
      claim_to_close: spread(claimToClose),
      review_wait: spread(reviewWaits),
      rulings,
    },
    periods,
    projects: [...projects.values()]
      .filter((p) => p.created || p.done || p.failed || p.discarded || p.send_backs)
      .map(({ cycle: c, ...p }) => ({ ...p, cycle_median_h: hours(quantile(c, 0.5)) }))
      .sort((a, b) => b.done - a.done || b.created - a.created || a.project.localeCompare(b.project)),
    agents: [...agents.values()]
      .filter((a) => a.claims || a.notes || a.done || a.failed || a.discarded)
      .sort((a, b) => b.done - a.done || b.notes - a.notes || a.agent.localeCompare(b.agent)),
    days: [...days.values()],
    brain,
  };
}

// ---- One day, in order ----
function timeline(tasks, { day, tz, project, agent }, commits = null) {
  const entries = [];
  for (const t of tasks) {
    if (project && t.project !== project) continue;
    for (const l of Array.isArray(t.log) ? t.log : []) {
      if (!l || typeof l.ts !== 'string' || l.by === 'system') continue;
      if (dayOf(l.ts, tz) !== day) continue;
      if (agent && l.by !== agent) continue;
      entries.push({
        ts: l.ts, mission: t.id, title: t.title, project: t.project || null, by: l.by || null,
        ...(l.from ? { from: l.from } : {}), ...(l.to ? { to: l.to } : {}),
        ...(rulingKind(l) ? { ruling: rulingKind(l) } : {}),
        note: String(l.note || '').slice(0, NOTE_MAX),
      });
    }
  }
  entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const brain = Array.isArray(commits)
    ? commits.filter((c) => dayOf(c.date, tz) === day && (!agent || c.author === agent)).map((c) => ({ ts: new Date(Date.parse(c.date)).toISOString(), author: c.author, message: String(c.message || '').slice(0, NOTE_MAX) })).sort((a, b) => (a.ts < b.ts ? -1 : 1))
    : null;
  return { day, tz, project: project || null, agent: agent || null, entries, commits: brain };
}

module.exports = { compute, timeline, parseQuery, validTz, validDay, dayOf, periodOf, midnight, GROUPS, MAX_DAYS };
