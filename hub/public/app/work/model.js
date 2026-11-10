// What the work pages need to know about a mission. No DOM, no fetch: every
// rule here was a boss ruling on v2, so it lives once.

const TERMINAL = new Set(['done', 'failed', 'discarded']);
export const isTerminal = (t) => TERMINAL.has(t.status);
export const isGoal = (t) => /^goal:/i.test(t.title || '');

export const byId = (tasks) => new Map((tasks || []).map((t) => [t.id, t]));
export const oldestFirst = (a, b) => String(a.created_at).localeCompare(String(b.created_at));
export const byPriority = (a, b) => (a.priority - b.priority) || String(b.created_at).localeCompare(String(a.created_at));

export function lastEntry(t) {
  const log = t.log || [];
  return log.length ? log[log.length - 1] : null;
}
export const lastTouched = (t) => (lastEntry(t) ? lastEntry(t).ts : t.created_at);

// A blocked mission waits on the boss unless its last note names another open
// mission. An unknown id still counts: over-counting by one beats hiding
// something that might need him.
export function waitingOnId(t) {
  const last = lastEntry(t);
  const m = last && /waiting on:\s*(t-\d+)/i.exec(last.note || '');
  return m ? m[1] : null;
}
export function blockedOnMission(t, tasks) {
  const ref = waitingOnId(t);
  const other = ref ? tasks.get(ref) : null;
  return !!other && !isTerminal(other);
}

// The badge counts only what needs him: a boss-gate review, or a block that
// isn't waiting on another mission. Critic-gate reviews and messages never do.
export function needsMe(state) {
  const tasks = (state && state.tasks) || [];
  const index = byId(tasks);
  return tasks.filter((t) => (t.status === 'review' && t.gate !== 'critic')
    || (t.status === 'blocked' && !blockedOnMission(t, index)));
}

// The next thing waiting after this one, oldest first, wrapping round.
export function nextNeeding(state, current) {
  const queue = needsMe(state).filter((t) => t.id !== current.id).sort(oldestFirst);
  if (!queue.length) return null;
  return queue.find((t) => String(t.created_at) >= String(current.created_at)) || queue[0];
}

export const undecided = (t) => (t.items || []).filter((it) => it.verdict === 'proposed');

// Rounds are counted from the times it was parked for review.
export function roundOf(t) {
  return (t.log || []).filter((l) => l.to === 'review' || /status → review/.test(l.note || '')).length;
}

export function goalRef(t) {
  const m = /goal:\s*(t-\d+)/.exec(t.body || '');
  return m ? m[1] : null;
}
export const goalChildren = (tasks, id) => (tasks || []).filter((t) => t.id !== id && goalRef(t) === id);

// A discarded mission's closing note can name its replacement. Newest wins.
export function findReplacement(t) {
  const re = /(?:replaced by|re-cut as)[^.\n]{0,40}?(t-\d+)/i;
  const log = t.log || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const m = re.exec(log[i].note || '');
    if (m) return m[1];
  }
  return null;
}

export function projectLabel(state, id) {
  const p = ((state && state.projects) || []).find((x) => (typeof x === 'string' ? x : x.id) === id);
  if (!p) return id;
  return typeof p === 'string' ? p : (p.label || id);
}
export function projectIds(state) {
  return ((state && state.projects) || []).map((p) => (typeof p === 'string' ? p : p && p.id)).filter(Boolean).sort();
}

// ---- Evidence ----

const IMAGE = /([\w./-]+\.(?:png|jpe?g|gif))/i;
const FILE_PARAM = /[?&]file=([\w./%-]+\.(?:png|jpe?g|gif))/i;

// The brain or work store path of an image artifact, or null. An outside URL
// that only ends in .png is a link: the hub can't serve it.
export function artifactImage(a) {
  const url = String(a.url || '').slice(0, 2048);
  const param = FILE_PARAM.exec(url);
  if (param) return param[1];
  if (/^https?:/i.test(url)) return null;
  const m = IMAGE.exec(url || String(a.label || '').slice(0, 2048));
  return m ? m[1] : null;
}

// A round's screenshots land together in one upload burst. Anything within
// this window of the newest image is the round being judged.
const ROUND_WINDOW_MS = 10 * 60 * 1000;

export function evidenceOf(artifacts) {
  const images = (artifacts || []).map((a) => {
    const img = artifactImage(a);
    if (!img) return null;
    const ts = Date.parse(a.ts);
    return { a, img, ts: Number.isNaN(ts) ? 0 : ts };
  }).filter(Boolean).sort((x, y) => y.ts - x.ts);
  if (!images.length) return { current: [], history: [] };
  const latest = images[0].ts;
  const current = images.filter((it) => latest - it.ts <= ROUND_WINDOW_MS);
  const seen = new Set(current.map((it) => it.img));
  // A stable path re-uploaded every round holds the newest pixels: showing it
  // under older dates would be a lie. Each path once, and not if it's current.
  const older = new Map();
  for (const it of images) {
    if (seen.has(it.img)) continue;
    if (!older.has(it.img)) older.set(it.img, it);
  }
  return { current, history: [...older.values()] };
}

export const plainArtifacts = (artifacts) => (artifacts || []).filter((a) => !artifactImage(a));

const GITHUB_PR = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/;

// The last PR link wins, so a re-cut branch points at its current PR.
export function prOf(t) {
  const arts = t.artifacts || [];
  for (let i = arts.length - 1; i >= 0; i--) {
    const m = GITHUB_PR.exec(String(arts[i].url || ''));
    if (m) return { owner: m[1], repo: m[2], number: m[3], url: arts[i].url };
  }
  return null;
}

// ---- Who works here ----

export function liveness(a) {
  const mins = (Date.now() - new Date(a.last_seen)) / 60000;
  return mins < 5 ? 'active' : mins < 60 ? 'idle' : 'offline';
}

const hasAll = (caps, ...want) => want.every((w) => caps.includes(w));

// Role is a label read from capabilities. The live lead carries planning and
// decomposition, not the word "lead"; the live critic review and verification.
export function roleOf(a) {
  const caps = a.capabilities || [];
  if (caps.includes('lead') || hasAll(caps, 'planning', 'decomposition')) return 'Lead';
  if (caps.includes('critic') || hasAll(caps, 'review', 'verification')) return 'Critic';
  if (caps.includes('librarian') || caps.includes('curation')) return 'Librarian';
  if (caps.includes('counsel')) return 'Envoy';
  return 'Builder';
}

// A visitor shows a positive sign of not being the team. No capabilities yet
// is not one: that's how every new hire starts.
const FIXTURE_CAPS = new Set(['curl', 'test', 'throwaway-verification']);
export function isVisitor(a) {
  if (a.kind === 'dummy' || a.kind === 'demo' || a.kind === 'other') return true;
  const caps = a.capabilities || [];
  return caps.length > 0 && caps.every((c) => FIXTURE_CAPS.has(c));
}

const TIER = { active: 0, idle: 1, offline: 2 };

// Live first, then idle, then gone, each by recency. Tiers never interleave.
export function teamOf(agents) {
  return (agents || []).filter((a) => !isVisitor(a)).sort((x, y) => {
    const rx = TIER[liveness(x)];
    const ry = TIER[liveness(y)];
    return rx !== ry ? rx - ry : new Date(y.last_seen) - new Date(x.last_seen);
  });
}
