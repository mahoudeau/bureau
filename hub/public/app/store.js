// The live picture of the hub: /api/state, kept fresh by the event stream, with
// an unconditional 60s poll so a dropped stream only costs a minute.

import * as api from './api.js';

const EVENTS = [
  'task.created', 'task.claimed', 'task.updated', 'task.done', 'task.failed', 'task.review',
  'task.approved', 'task.applied', 'task.blocked', 'task.requeued',
  'agent.registered', 'agent.heartbeat', 'agent.removed',
  'message.posted', 'knowledge.written', 'journal.captured',
  'project.created', 'project.renamed', 'project.deleted',
  // Sent to the boss only. Other credentials on the stream never get these.
  'settings.changed', 'agent.roles_changed', 'token.minted', 'token.revoked',
];
// Not from the hub: event subscribers get this when the stream comes back. Any
// of them may have missed anything, so it means "reload what you hold".
export const RECONNECTED = 'stream.reconnected';
const POLL_MS = 60000;
const QUIET_MS = 400;

let started = false;
let state = null;
let live = 'idle'; // idle, connecting, live, polling
let version = '';
const stateSubs = new Set();
const eventSubs = new Set();
const liveSubs = new Set();

function notify(subs, ...args) {
  for (const fn of [...subs]) {
    try { fn(...args); } catch (e) { console.error(e); }
  }
}

let inFlight = null;
let again = false;
// Resolves with the fresh state. Calls during a fetch share it and cause one more.
export function refresh() {
  if (inFlight) { again = true; return inFlight; }
  inFlight = api.get('/api/state').then((next) => {
    state = next;
    notify(stateSubs, state);
    return state;
  }).finally(() => {
    inFlight = null;
    if (again) { again = false; refresh().catch(() => {}); }
  });
  return inFlight;
}

let quiet = null;
function refreshSoon() {
  if (quiet) return;
  quiet = setTimeout(() => {
    quiet = null;
    refresh().catch(() => {});
  }, QUIET_MS);
}

function setLive(next) {
  if (live === next) return;
  live = next;
  notify(liveSubs, live, version);
}

// Called by the gate once there is a token. Safe to call again.
export function start() {
  if (started) return;
  started = true;
  setLive('connecting');
  refresh().catch(() => {});
  api.get('/api/health').then((h) => {
    version = (h && h.version) || '';
    notify(liveSubs, live, version);
  }).catch(() => {});
  let lost = false;
  window.BureauHub.events({
    up() {
      setLive('live');
      if (!lost) return;
      // Nobody told us what happened while the stream was gone, so state is
      // re-read and everything that only listens for events is told to reload.
      lost = false;
      refresh().catch(() => {});
      notify(eventSubs, RECONNECTED, null);
    },
    down() { lost = true; setLive('polling'); },
    ended: api.sessionEnded,
    wire(es) {
      for (const type of EVENTS) {
        es.addEventListener(type, (e) => {
          let payload = null;
          try { payload = JSON.parse(e.data); } catch { /* still worth a refresh */ }
          notify(eventSubs, type, payload);
          refreshSoon();
        });
      }
    },
  });
  setInterval(() => refresh().catch(() => {}), POLL_MS);
}

export const getState = () => state;
export const getLive = () => live;
export const getVersion = () => version;

// The state now, or the first one when it lands. Rejects if that fetch fails.
export const ready = () => (state ? Promise.resolve(state) : refresh());

// fn(state), straight away if there is one, then on every change. Returns the
// unsubscribe, which is a good thing to hand to ctx.onCleanup.
export function subscribe(fn) {
  stateSubs.add(fn);
  if (state) {
    try { fn(state); } catch (e) { console.error(e); }
  }
  return () => stateSubs.delete(fn);
}

// fn(type, payload) on every event from the stream.
export function subscribeEvents(fn) {
  eventSubs.add(fn);
  return () => eventSubs.delete(fn);
}

// fn(live, version) whenever either changes.
export function subscribeLive(fn) {
  liveSubs.add(fn);
  return () => liveSubs.delete(fn);
}
