// lib/auth.js: who is calling, and what that credential may reach. The rule
// table is in docs/protocol.md, "Who can do what"; this file is that table.
//
// A request becomes a principal here, once, from its credential:
//   boss    BUREAU_BOSS_TOKEN (strict mode). Acts as human, and only as human.
//   agent   a minted token. One name, one project list (or all).
//   shared  BUREAU_TOKEN in strict mode: any agent but human, no project list.
//           The old MCP URL too, as consul.
//   legacy  BUREAU_TOKEN in legacy mode, or no token at all: identity is
//           whatever the client declares, as it always was.
'use strict';
const crypto = require('crypto');
const store = require('./store');
const knowledge = require('./knowledge');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
// Constant time, whatever the caller sent.
function secretEqual(candidate, expected) {
  if (typeof candidate !== 'string' || !candidate || !expected) return false;
  return crypto.timingSafeEqual(sha(candidate), sha(expected));
}

const LEGACY = Object.freeze({ kind: 'legacy', name: null, projects: '*' });
const BOSS = Object.freeze({ kind: 'boss', name: 'human', projects: '*' });

let sharedLastUsed = null;

// The principal behind a bearer, or null when it is not one.
function fromBearer(candidate) {
  const mode = store.authMode();
  if (mode === 'open') return LEGACY;
  if (mode === 'strict' && secretEqual(candidate, process.env.BUREAU_BOSS_TOKEN)) return BOSS;
  const minted = store.findAgentToken(candidate);
  if (minted) return fromMinted(minted);
  if (secretEqual(candidate, process.env.BUREAU_TOKEN)) {
    if (mode === 'legacy') return LEGACY;
    sharedLastUsed = new Date().toISOString();
    return { kind: 'shared', name: null, projects: '*' };
  }
  return null;
}
function fromMinted(t) {
  return { kind: 'agent', name: t.agent, projects: t.projects.includes('*') ? '*' : t.projects, tokenId: t.id };
}
// The credential in an MCP URL: a minted token, or the URL issued before strict.
function fromMcpToken(candidate, legacyUrlToken) {
  const minted = store.findAgentToken(candidate);
  if (minted) return fromMinted(minted);
  if (legacyUrlToken && secretEqual(candidate, legacyUrlToken)) return store.authMode() === 'strict' ? { kind: 'shared', name: 'consul', projects: '*' } : { kind: 'legacy', name: 'consul', projects: '*' };
  return null;
}

// A principal carried over from an earlier request (an SSE ticket). A token
// revoked in between has no standing.
function stillCurrent(p) {
  return p.kind !== 'agent' || store.listTokens().some((t) => t.id === p.tokenId && !t.revoked_at);
}

// Names no credential but the boss may wear. 'system' writes lease expiries.
const RESERVED_NAME = /^\s*(human|system)\s*$/i;

// Checks a declared agent, author or from against the credential. Returns
// {name} (null when nothing was declared and the credential names nobody) or
// {error}: the caller answers 403.
function actor(p, declared) {
  const d = declared === undefined || declared === null || declared === '' ? null : String(declared);
  if (p.kind === 'legacy') return { name: d !== null ? d : p.name };
  // A viewer acts as nobody; an approver rules as the boss (human), and the
  // person behind it is recorded as via (doc 30, D5).
  if (p.kind === 'viewer') return { error: 'a viewer reads only' };
  if (p.kind === 'boss' || p.kind === 'approver') {
    if (d && d !== 'human') return { error: `the boss credential acts as human, not as ${d}; to act as an agent use that agent's token` };
    return { name: 'human' };
  }
  if (p.name) { // a minted token, or the old MCP URL
    if (d && d !== p.name) return { error: `this credential is bound to agent ${p.name}; it cannot act as ${d}` };
    return { name: p.name };
  }
  if (d && RESERVED_NAME.test(d)) return { error: `the shared token cannot act as ${d}: only the boss credential does` };
  return { name: d };
}

// ---- The walls ----
const seesAll = (p) => p.projects === '*';
function projectAllowed(p, id) { return seesAll(p) || (typeof id === 'string' && p.projects.includes(id)); }
const seesTask = (p, t) => projectAllowed(p, t.project);
function allowedEntities(p) {
  if (seesAll(p)) return null;
  return new Set(store.load().projects.filter((x) => p.projects.includes(x.id) && x.entity).map((x) => x.entity));
}
const isOwnAgentFile = (p, rel) => !!p.name && (rel === `agents/${p.name}.md` || rel.startsWith(`agents/${p.name}/`));

// The path is judged where it lands (normRel collapses a ../ and a backslash),
// and the compartment case-blind: a case-insensitive disk must not open a door.
function parts(file) {
  const rel = knowledge.normRel(String(file || ''));
  const [top, second] = rel.split('/');
  return { rel, top: (top || '').toLowerCase(), second };
}
function canRead(p, file) {
  if (seesAll(p)) return true;
  const { rel, top, second } = parts(file);
  if (top === 'knowledge' || top === 'recipes') return true;
  if (top === 'projects') return projectAllowed(p, second);
  if (top === 'entities') return allowedEntities(p).has(second);
  if (top === 'agents') return isOwnAgentFile(p, rel);
  return false;
}
function canWrite(p, file) {
  if (seesAll(p)) return true;
  const { rel, top, second } = parts(file);
  // knowledge/ and recipes/ are global; the curated wall still asks for a role
  if (top === 'knowledge' || top === 'recipes' || top === 'journal' || top === 'daily') return true;
  if (top === 'projects') return projectAllowed(p, second);
  if (top === 'entities') return allowedEntities(p).has(second);
  if (top === 'agents') return isOwnAgentFile(p, rel);
  return false;
}
// What a claim's detail may show, for lib/index.js. Null when walls do not apply.
function viewer(p) {
  if (seesAll(p)) return null;
  return { canRead: (f) => canRead(p, f), seesProject: (id) => projectAllowed(p, id) };
}

// What a credential sees of a mission. Missions no longer carry capability
// links (doc 30, D12), so every credential that reaches one sees all of it.
function taskView(p, t) { return t; }

// ---- The route table ----
// any: any credential (the handler applies identity and walls). boss: the boss
// credential in strict mode, any bearer in legacy. strict: the boss credential,
// and only in strict mode. all: sees every project (boss, shared, ["*"] tokens,
// legacy). A route missing here is not served: forgetting a rule closes it.
const RULES = [
  ['GET', /^\/api\/health$/, 'any'],
  ['GET', /^\/api\/events$/, 'all'], ['POST', /^\/api\/events\/ticket$/, 'all'],
  ['GET', /^\/api\/state$/, 'any'], ['POST', /^\/api\/state$/, 'any'],
  ['POST', /^\/api\/agents\/register$/, 'any'],
  ['POST', /^\/api\/agents\/heartbeat$/, 'any'],
  ['DELETE', /^\/api\/agents\/[^/]+$/, 'any'],
  ['GET', /^\/api\/tasks$/, 'any'], ['POST', /^\/api\/tasks$/, 'any'],
  ['POST', /^\/api\/tasks\/claim$/, 'any'],
  ['GET', /^\/api\/tasks\/t-\d+$/, 'any'], ['PATCH', /^\/api\/tasks\/t-\d+$/, 'any'],
  ['POST', /^\/api\/tasks\/t-\d+\/apply$/, 'any'],
  ['GET', /^\/api\/settings$/, 'any'], ['PATCH', /^\/api\/settings$/, 'boss'],
  ['GET', /^\/api\/mcp$/, 'boss'], ['DELETE', /^\/api\/mcp$/, 'boss'],
  ['GET', /^\/api\/projects$/, 'any'], ['POST', /^\/api\/projects$/, 'boss'],
  ['PATCH', /^\/api\/projects\/[A-Za-z0-9._-]+$/, 'boss'], ['DELETE', /^\/api\/projects\/[A-Za-z0-9._-]+$/, 'boss'],
  ['POST', /^\/api\/projects\/rename$/, 'boss'],
  ['POST', /^\/api\/tokens$/, 'strict'], ['GET', /^\/api\/tokens$/, 'strict'], ['DELETE', /^\/api\/tokens\/[A-Za-z0-9-]+$/, 'strict'],
  ['GET', /^\/api\/messages$/, 'any'], ['POST', /^\/api\/messages$/, 'any'], ['POST', /^\/api\/messages\/inbox$/, 'any'],
  ['POST', /^\/api\/knowledge$/, 'any'], ['GET', /^\/api\/knowledge$/, 'any'],
  ['POST', /^\/api\/knowledge\/sweep$/, 'boss'],
  ['GET', /^\/api\/knowledge\/map$/, 'any'], ['GET', /^\/api\/knowledge\/search$/, 'any'],
  ['POST', /^\/api\/context$/, 'any'],
  ['POST', /^\/api\/journal$/, 'any'], ['GET', /^\/api\/journal$/, 'any'],
  ['GET', /^\/api\/memory\/health$/, 'all'],
  ['POST', /^\/api\/work$/, 'any'], ['GET', /^\/api\/work$/, 'any'],
  // Sign-in (doc 30): who am I, the apps acting as agents, dashboard sessions,
  // the pairing with OMAKO. Apps and sessions are the owner's to rule.
  ['GET', /^\/api\/me$/, 'any'],
  ['GET', /^\/api\/apps$/, 'boss'], ['POST', /^\/api\/apps\/app-[a-f0-9]+$/, 'boss'], ['DELETE', /^\/api\/apps\/app-[a-f0-9]+$/, 'boss'],
  ['GET', /^\/api\/sessions$/, 'boss'], ['POST', /^\/api\/sessions\/revoke-all$/, 'boss'],
  ['GET', /^\/api\/omako$/, 'boss'],
  // The first-run guide's status: who of consul and sol is connected.
  ['GET', /^\/api\/setup$/, 'boss'],
];
function ruleFor(method, pathname) {
  for (const [m, re, rule] of RULES) if (m === method && re.test(pathname)) return rule;
  return null;
}
// What a signed-in approver may change (doc 30, C3): rule on a mission (verdicts,
// approve, send back, answer) and comment. Everything else is the owner's.
const APPROVER_WRITES = [['PATCH', /^\/api\/tasks\/t-\d+$/]];
// POSTs that only read: the cache-proof snapshot and a ticket for the stream.
const READ_POSTS = [['POST', /^\/api\/state$/], ['POST', /^\/api\/events\/ticket$/]];
const matches = (list, method, pathname) => list.some(([m, re]) => m === method && re.test(pathname || ''));
// null when the credential passes the rule, else {status, error}.
function checkRule(rule, p, method, pathname) {
  // People signed in to the dashboard below owner: a viewer reads, an approver
  // reads and rules. Judged before the rule, whatever it says.
  const reads = !method || method === 'GET' || matches(READ_POSTS, method, pathname);
  if (p.kind === 'viewer' && !reads) return { status: 403, error: 'a viewer reads only' };
  if (p.kind === 'approver' && !reads && !matches(APPROVER_WRITES, method, pathname)) return { status: 403, error: 'an approver rules on missions; this needs an owner' };
  if ((p.kind === 'approver' || p.kind === 'viewer') && (rule === 'boss' || rule === 'strict')) return { status: 403, error: 'this needs an owner' };
  if (rule === 'any') return null;
  if (rule === 'all') return seesAll(p) ? null : { status: 403, error: 'this needs a credential that sees every project' };
  if (rule === 'boss') return p.kind === 'boss' || p.kind === 'legacy' ? null : { status: 403, error: 'this needs the boss credential' };
  if (rule === 'strict') {
    if (store.authMode() !== 'strict') return { status: 403, error: 'token minting needs strict mode: set BUREAU_BOSS_TOKEN and restart' };
    return p.kind === 'boss' ? null : { status: 403, error: 'this needs the boss credential' };
  }
  return { status: 403, error: `no rule ${rule}` };
}

// ---- MCP tools: same words as the table above ----
const MCP_RULES = {
  whoami: 'any', list_projects: 'any', list_missions: 'any', create_mission: 'any', start_mission: 'any', update_mission: 'any',
  apply_item: 'any', write_knowledge: 'any', capture: 'any', read_knowledge: 'any', get_context: 'any', brain_map: 'any',
  search_knowledge: 'any', memory_health: 'all', write_work: 'any', read_work: 'any',
  clock_in: 'any', heartbeat: 'any', read_inbox: 'any', send_message: 'any', claim_mission: 'any', get_mission: 'any',
  list_missions_full: 'any', read_settings: 'any', read_journal: 'any', recent_activity: 'any',
};

module.exports = {
  secretEqual, fromBearer, fromMcpToken, stillCurrent, actor, projectAllowed, seesTask, seesAll, canRead, canWrite, viewer, taskView, ruleFor, checkRule, RULES, MCP_RULES, sharedLastUsed: () => sharedLastUsed,
};
