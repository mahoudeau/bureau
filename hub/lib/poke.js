// lib/poke.js: optional outbound wake-up pokes (the summoner's bell).
// Set BUREAU_POKES to a JSON array of subscriptions to enable; otherwise every
// call is a silent no-op, exactly like the Discord mirror. A poke is a wake-up
// bell, never an authenticated surface: payloads are trimmed and never carry
// capability links or tokens. The hub knows URLs, never vendors.
//
// BUREAU_POKES example:
//   [{"url":"https://example/hook","headers":{"X-Key":"k"},
//     "events":["task.review"],"filter":{"gate":"critic"}}]
// events: hub event types to match (empty/absent = all).
// filter: every key must strictly equal the same key in the payload
//         (top level first, then inside .task).
// wrap: "text" posts {"text":"<one human-readable line>"} instead of the raw
//       payload, for endpoints that append the body as a message to a session
//       (the woken agent reads why it was summoned). Absent = raw payload.
//
// Standing work (the second bell): a subscription whose events include
// "work.waiting" is evaluated on the hub's periodic sweep against work that is
// ALREADY sitting there (queued or in review), not just fresh transitions.
// Extra keys for these subscriptions:
//   unless_seen: {"agents":["bettik"],"within_min":10} - stay silent while any
//                named agent has heartbeat within the window (they're awake).
//   every_min:   cooldown between rings while the condition persists
//                (default 20; the condition re-rings, it never floods).
// The filter matches the oldest waiting task's payload (status/gate/etc.).
'use strict';

let SUBS = [];
try {
  const raw = process.env.BUREAU_POKES || '';
  if (raw) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) SUBS = parsed.filter(s => s && typeof s.url === 'string');
    else console.error('[poke] BUREAU_POKES must be a JSON array; pokes disabled');
  }
} catch (e) {
  console.error('[poke] BUREAU_POKES is not valid JSON; pokes disabled:', e.message);
}

// Whitelisted payload: the full task record carries capability links
// (view_token, review_links, answer_link) which must never leave the hub
// through a poke.
function payloadFor(type, data, extra) {
  const d = data || {};
  return {
    event: type,
    ts: new Date().toISOString(),
    ...(d.id ? {
      task: {
        id: d.id, title: d.title, status: d.status, gate: d.gate,
        project: d.project, priority: d.priority,
        assignee: d.assignee, reserved_for: d.reserved_for,
      },
    } : {}),
    ...(typeof d.note === 'string' ? { note: d.note.slice(0, 300) } : {}),
    ...(extra || {}),
  };
}

function matches(sub, p) {
  if (Array.isArray(sub.events) && sub.events.length && !sub.events.includes(p.event)) return false;
  if (sub.filter && typeof sub.filter === 'object') {
    for (const k of Object.keys(sub.filter)) {
      const actual = k in p ? p[k] : (p.task ? p.task[k] : undefined);
      if (actual !== sub.filter[k]) return false;
    }
  }
  return true;
}

function asLine(p) {
  const t = p.task || {};
  const bits = [
    `poke: ${p.event}`,
    t.id ? `${t.id} "${t.title || ''}"` : '',
    t.status ? `status=${t.status}` : '', t.gate ? `gate=${t.gate}` : '',
    t.reserved_for ? `reserved_for=${t.reserved_for}` : '',
    p.by ? `by=${p.by}` : '', p.prev_status ? `prev=${p.prev_status}` : '',
    p.note ? `note: ${p.note}` : '',
  ].filter(Boolean);
  return bits.join(' · ');
}

async function send(type, data, extra) {
  if (!SUBS.length) return;
  const p = payloadFor(type, data, extra);
  for (const sub of SUBS) {
    if (!matches(sub, p)) continue;
    try {
      await fetch(sub.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(sub.headers || {}) },
        body: JSON.stringify(sub.wrap === 'text' ? { text: asLine(p) } : p),
      });
    } catch (e) {
      console.error('[poke] send failed:', String(sub.url).split('?')[0], e.message);
    }
  }
}

// Standing-work sweep: called periodically by the server with the full state.
// In-memory cooldowns (reset on restart, which only means one extra ring).
const lastRing = new Map();
function standing(state) {
  if (!SUBS.length || !state) return;
  const now = Date.now();
  const tasks = state.tasks || [], agents = state.agents || [];
  for (let i = 0; i < SUBS.length; i++) {
    const sub = SUBS[i];
    if (!Array.isArray(sub.events) || !sub.events.includes('work.waiting')) continue;
    const everyMs = (sub.every_min !== undefined ? +sub.every_min : 20) * 60000;
    if (lastRing.has(i) && now - lastRing.get(i) < everyMs) continue;
    if (sub.unless_seen && Array.isArray(sub.unless_seen.agents)) {
      const withinMs = (+sub.unless_seen.within_min || 10) * 60000;
      const awake = agents.some(a => sub.unless_seen.agents.includes(a.name) &&
        a.last_seen && now - Date.parse(a.last_seen) < withinMs);
      if (awake) continue;
    }
    // Oldest waiting task whose payload matches the subscription's filter.
    const waiting = tasks
      .filter(t => t.status === 'queued' || t.status === 'review')
      .filter(t => matches({ ...sub, events: undefined }, payloadFor('work.waiting', t, undefined)))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (!waiting.length) continue;
    lastRing.set(i, now);
    const oldest = waiting[0];
    const p = payloadFor('work.waiting', oldest, { waiting: waiting.length });
    (async () => {
      try {
        await fetch(sub.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(sub.headers || {}) },
          body: JSON.stringify(sub.wrap === 'text' ? { text: asLine(p) + ` · waiting=${waiting.length}` } : p),
        });
      } catch (e) {
        console.error('[poke] standing send failed:', String(sub.url).split('?')[0], e.message);
      }
    })();
  }
}

module.exports = { send, standing };
