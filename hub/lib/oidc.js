// lib/oidc.js: sign-in through an OAuth 2.1 / OpenID issuer. OMAKO
// (id.omako.dev) by default, any issuer the owner names. Zero dependencies:
// tokens are checked by lib/jwt.js with the issuer's published keys.
// The plan of record is bureau-internal/30-identity-plan.md (doc 30).
//
// Two kinds of sign-in:
//   - An agent, through an app (claude.ai, the CLI, a routine's connector).
//     The door per agent is https://<hub>/mcp/agent/<name>; that address is
//     the OAuth resource, signed into the token's audience, so a token for sol
//     can never act as kassad. The same token works on /api/* as that agent.
//     A token passes when: the issuer signed it, it is an access token for one
//     of this hub's agent addresses, it holds the bureau scope, the person is
//     an owner of the hub, the owner turned sign-in on for that agent
//     (settings agents.<name>.oauth), and the owner allowed that app for that
//     agent (state.oauth_apps, D13).
//   - A person, in the dashboard (code flow + PKCE, server side; the hub then
//     keeps its own session, see server.js /auth/*). Owner, approver or viewer.
//
// Where the configuration comes from:
//   BUREAU_OIDC_ISSUER, BUREAU_OIDC_CLIENT_ID, BUREAU_OIDC_CLIENT_SECRET, or a
//   pairing with OMAKO (<data dir>/omako.json, written by hub/tools/omako.js).
//   BUREAU_PUBLIC_URL: the hub's address, for the resources and the callback.
//   BUREAU_OIDC_OWNERS: emails or subject ids, seeding the owners.
//   BUREAU_OIDC_SCOPE: the scope an agent token must carry (default bureau).
//   BUREAU_OIDC_CLI_CLIENT_ID: the CLI's client at the issuer (default bureau-cli).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { JwtError, createJwks, verifyJwt, looksLikeJwt } = require('./jwt');

const AGENT_NAME = store.OAUTH_AGENT_NAME;
const META_TTL_MS = 60 * 60 * 1000;
const EMAIL_TTL_MS = 60 * 60 * 1000;
const DATA_DIR = process.env.BUREAU_DATA_DIR || path.join(__dirname, '..', 'data');
const PAIRING_FILE = path.join(DATA_DIR, 'omako.json');
const CHALLENGE_FILE = path.join(DATA_DIR, 'omako-challenge.txt');

class AuthError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; Object.assign(this, extra || {}); }
}

// The pairing with OMAKO (C1), re-read when the file changes. Never logged.
let pairingCache = { mtime: -1, value: null };
function pairing() {
  let mtime = -1;
  try { mtime = fs.statSync(PAIRING_FILE).mtimeMs; } catch { /* not paired */ }
  if (mtime !== pairingCache.mtime) {
    let value = null;
    if (mtime >= 0) { try { value = JSON.parse(fs.readFileSync(PAIRING_FILE, 'utf8')); } catch { value = null; } }
    pairingCache = { mtime, value };
  }
  return pairingCache.value;
}
function challengeText() {
  try { return fs.readFileSync(CHALLENGE_FILE, 'utf8').trim(); } catch { return null; }
}

function config() {
  const pair = pairing();
  const issuer = (process.env.BUREAU_OIDC_ISSUER || (pair && pair.issuer) || '').replace(/\/$/, '');
  const base = (process.env.BUREAU_PUBLIC_URL || '').replace(/\/$/, '');
  const owners = store.envOwners();
  // The dashboard's client: the env's, else the pairing's (only for the same issuer).
  const fromPair = pair && pair.issuer && pair.issuer.replace(/\/$/, '') === issuer;
  const clientId = process.env.BUREAU_OIDC_CLIENT_ID || (fromPair ? pair.client_id : '') || '';
  const clientSecret = process.env.BUREAU_OIDC_CLIENT_SECRET || (fromPair ? pair.client_secret : '') || '';
  return {
    issuer, base, owners, clientId, clientSecret,
    scope: process.env.BUREAU_OIDC_SCOPE || 'bureau',
    cliClientId: process.env.BUREAU_OIDC_CLI_CLIENT_ID || 'bureau-cli',
    hubId: fromPair ? pair.hub_id || null : null,
    on: !!(issuer && base),
    webOn: !!(issuer && base && clientId),
  };
}

const resourceFor = (base, agent) => `${base}/mcp/agent/${agent}`;
const metadataUrlFor = (base, agent) => `${base}/.well-known/oauth-protected-resource/mcp/agent/${agent}`;
const validAgent = (name) => AGENT_NAME.test(name) && !store.RESERVED_OAUTH_AGENT.test(name);

// RFC 9728: what a client fetches to learn where to sign in for this agent.
function resourceMetadata(agent) {
  const c = config();
  return {
    resource: resourceFor(c.base, agent),
    authorization_servers: [c.issuer],
    // email: owners named by email are checked through userinfo, which only
    // answers with the address when the token carries this scope.
    scopes_supported: [c.scope, 'openid', 'email', 'offline_access'],
    bearer_methods_supported: ['header'],
    resource_name: `Bureau (${agent})`,
  };
}
// /.well-known/bureau: what the CLI needs to sign in to this hub (C5). Public.
function discovery() {
  const c = config();
  return { issuer: c.issuer || null, cli_client_id: c.on ? c.cliClientId : null, agents_url_template: c.on ? `${c.base}/mcp/agent/{agent}` : null, sign_in: c.webOn };
}

// ---- the issuer's metadata and keys, cached ----
let meta = null, metaAt = 0, metaFor = '';
async function getJson(url, headers) {
  const r = await fetch(url, { headers: { accept: 'application/json', ...(headers || {}) }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function issuerMeta() {
  const { issuer } = config();
  if (meta && metaFor === issuer && Date.now() - metaAt < META_TTL_MS) return meta;
  let m;
  try { m = await getJson(`${issuer}/.well-known/oauth-authorization-server`); }
  catch { m = await getJson(`${issuer}/.well-known/openid-configuration`); }
  if (String(m.issuer).replace(/\/$/, '') !== issuer) throw new Error('issuer metadata names another issuer');
  meta = m; metaAt = Date.now(); metaFor = issuer;
  return m;
}
let jwks = null, jwksFor = '';
function keys() {
  const { issuer } = config();
  if (!jwks || jwksFor !== issuer) { jwks = createJwks(async () => (await issuerMeta()).jwks_uri); jwksFor = issuer; }
  return jwks;
}

// sub -> {email, at}, from the issuer's userinfo, for people named by email
const emails = new Map();
async function emailOf(token, sub) {
  const hit = emails.get(sub);
  if (hit && Date.now() - hit.at < EMAIL_TTL_MS) return hit.email;
  const m = await issuerMeta();
  if (!m.userinfo_endpoint) return null;
  const info = await getJson(m.userinfo_endpoint, { authorization: `Bearer ${token}` }).catch(() => null);
  if (!info || info.sub !== sub || info.email_verified === false || !info.email) return null;
  emails.set(sub, { email: String(info.email).toLowerCase(), at: Date.now() });
  return emails.get(sub).email;
}

// A person's role on this hub (C3): settings.members by subject, then by
// email, then BUREAU_OIDC_OWNERS, then the OMAKO workspace role the token
// carries when it comes from the issuer this hub is paired with.
// email: when already known (an ID token); otherwise fetched only if needed.
async function roleOf(claims, { token, email } = {}) {
  const c = config();
  const members = store.settingsOf(store.load()).members;
  const sub = String(claims.sub || '');
  // source: where the role came from. Only a role from the issuer's claim is
  // kept on a session; the others are read again from Settings on every request.
  if (members[sub]) return { role: members[sub].role, email: email || null, source: 'members' };
  if (c.owners.includes(sub)) return { role: 'owner', email: email || null, source: 'owners' };
  const wantsEmail = Object.keys(members).some((k) => k.includes('@')) || c.owners.some((o) => o.includes('@'));
  let mail = email ? String(email).toLowerCase() : null;
  if (!mail && wantsEmail && token) mail = await emailOf(token, sub);
  if (mail && members[mail]) return { role: members[mail].role, email: mail, source: 'members' };
  if (mail && c.owners.includes(mail)) return { role: 'owner', email: mail, source: 'owners' };
  // OMAKO workspace roles (C2): only for a token from the paired issuer about this hub.
  if (c.hubId && claims.hub === c.hubId && store.MEMBER_ROLES.includes(claims.hub_role)) return { role: claims.hub_role, email: mail, source: 'claim' };
  return { role: null, email: mail, source: null };
}

// The agent named by a token's audience: exactly one of this hub's agent addresses.
function agentAudience(base, hint) {
  const prefix = `${base}/mcp/agent/`;
  return (auds) => {
    const mine = auds.filter((a) => a.startsWith(prefix) && validAgent(a.slice(prefix.length)));
    if (hint) return mine.includes(prefix + hint) ? prefix + hint : null;
    return mine.length === 1 ? mine[0] : null;
  };
}

// The principal behind an agent token, on /mcp/agent/<hint> or /api/* (no
// hint: the audience names the agent). Throws AuthError.
async function agentPrincipal(token, hint) {
  const c = config();
  if (!c.on) throw new AuthError(404, 'not_found', 'sign-in is not set up on this hub');
  if (hint !== undefined && !validAgent(hint)) throw new AuthError(404, 'not_found', 'no such agent');
  if (!token) throw new AuthError(401, 'invalid_request', 'sign in to use this agent');
  let claims;
  try {
    claims = await verifyJwt(token, { jwks: keys(), issuer: c.issuer, audience: agentAudience(c.base, hint), typ: 'at+jwt' });
  } catch (e) {
    if (e instanceof JwtError) throw new AuthError(401, 'invalid_token', e.message, { forged: e.forged });
    throw e;
  }
  const agent = claims._aud.slice(`${c.base}/mcp/agent/`.length);
  if (!String(claims.scope || '').split(' ').includes(c.scope)) throw new AuthError(403, 'insufficient_scope', `the token lacks the ${c.scope} scope`, { agent });
  const sub = String(claims.sub || '');
  if (!sub) throw new AuthError(401, 'invalid_token', 'no subject', { agent });
  const who = await roleOf(claims, { token });
  // Only owners connect agents: an approver or a viewer rules or reads in the
  // dashboard, never through an agent's door.
  if (who.role !== 'owner') throw new AuthError(403, 'access_denied', who.role ? `a ${who.role} cannot connect an agent; an owner does` : 'this account does not own this hub', { agent });
  const grant = store.settingsOf(store.load()).agents[agent];
  const projects = grant && grant.oauth && grant.oauth.projects;
  if (!Array.isArray(projects) || !projects.length) throw new AuthError(403, 'access_denied', `sign-in is off for ${agent}: an owner turns it on in Settings`, { agent });
  // D13: the app itself must be allowed for this agent by an owner.
  const clientId = String(claims.client_id || claims.azp || '');
  if (!clientId) throw new AuthError(401, 'invalid_token', 'the token names no app (client_id)', { agent });
  const app = store.seeApp({ client_id: clientId, agent, name: claims.client_name, verified: claims.client_verified === true, sub });
  if (!app) throw new AuthError(429, 'too_many_pending', 'too many apps are waiting for an owner; try again later', { agent });
  if (app.status === 'denied') throw new AuthError(403, 'app_denied', `an owner denied ${app.name || 'this app'} as ${agent}`, { agent, app });
  if (app.status !== 'allowed') throw new AuthError(403, 'app_pending', `${app.name || 'this app'} is waiting for an owner to allow it as ${agent}, on the Desk`, { agent, app });
  return { kind: 'agent', name: agent, projects: projects.includes('*') ? '*' : projects, oauth: true, sub, via: who.email || sub, appId: app.id };
}

// The 401/403 header that tells an MCP client where to sign in.
function challenge(agent, err) {
  const c = config();
  const parts = [`resource_metadata="${metadataUrlFor(c.base, agent)}"`];
  if (err.code && !['invalid_request', 'app_pending', 'app_denied', 'access_denied', 'too_many_pending'].includes(err.code)) parts.push(`error="${err.code}"`);
  if (err.code === 'insufficient_scope') parts.push(`scope="${c.scope}"`);
  return `Bearer ${parts.join(', ')}`;
}

// ---- the dashboard's sign-in (C4): code flow + PKCE + nonce, server side ----
const b64u = (buf) => Buffer.from(buf).toString('base64url');
async function authorizeRequest(next) {
  const c = config();
  const m = await issuerMeta();
  const state = b64u(crypto.randomBytes(24)), nonce = b64u(crypto.randomBytes(24)), verifier = b64u(crypto.randomBytes(32));
  const challengeS = b64u(crypto.createHash('sha256').update(verifier).digest());
  const u = new URL(m.authorization_endpoint);
  u.search = new URLSearchParams({ response_type: 'code', client_id: c.clientId, redirect_uri: `${c.base}/auth/callback`, scope: 'openid email profile', state, nonce, code_challenge: challengeS, code_challenge_method: 'S256' }).toString();
  return { url: u.toString(), flow: { state, nonce, verifier, next, t: Date.now() } };
}
// Returns {sub, email, name, id_token, role}. Throws Error with a message fit for a page.
async function completeSignIn(params, flow) {
  const c = config();
  const m = await issuerMeta();
  if (params.get('error')) throw new Error(`the issuer said: ${params.get('error')}`);
  const state = params.get('state') || '';
  if (!flow || !flow.state || state.length !== flow.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) throw new Error('this sign-in did not start here, or it took too long');
  if (Date.now() - flow.t > 10 * 60 * 1000) throw new Error('this sign-in took too long');
  // RFC 9207: the code came from our issuer.
  const iss = params.get('iss');
  if (iss && iss.replace(/\/$/, '') !== c.issuer) throw new Error('the answer came from another issuer');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code: params.get('code') || '', redirect_uri: `${c.base}/auth/callback`, code_verifier: flow.verifier });
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (c.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`).toString('base64')}`;
  else body.set('client_id', c.clientId);
  const r = await fetch(m.token_endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.id_token) throw new Error(`the issuer refused the sign-in (${tok.error || r.status})`);
  let idc;
  try {
    idc = await verifyJwt(tok.id_token, { jwks: keys(), issuer: c.issuer, audience: c.clientId });
  } catch (e) { throw new Error(`the sign-in answer did not check out (${e.message})`); }
  const auds = Array.isArray(idc.aud) ? idc.aud : [idc.aud];
  if (auds.length > 1 && idc.azp !== c.clientId) throw new Error('the sign-in answer was meant for another app');
  if (typeof idc.nonce !== 'string' || idc.nonce.length !== flow.nonce.length || !crypto.timingSafeEqual(Buffer.from(idc.nonce), Buffer.from(flow.nonce))) throw new Error('the sign-in answer was replayed');
  if (!idc.sub) throw new Error('the sign-in answer names nobody');
  let info = {};
  if (tok.access_token && m.userinfo_endpoint) {
    info = await getJson(m.userinfo_endpoint, { authorization: `Bearer ${tok.access_token}` }).catch(() => ({}));
    if (info.sub && info.sub !== idc.sub) throw new Error('the issuer gave two different people');
  }
  const email = info.email_verified === false ? null : (info.email || (idc.email_verified === false ? null : idc.email) || null);
  const who = await roleOf({ ...idc, ...(tok.access_token ? accessClaims(tok.access_token) : {}) }, { email });
  return { sub: String(idc.sub), email: email ? String(email).toLowerCase() : null, name: info.name || idc.name || null, id_token: tok.id_token, role: who.role, roleSource: who.source };
}
// The hub and hub_role claims of the access token from the same sign-in, read
// without checking them again: they only matter when the ID token checked out
// and both came from the same token endpoint answer.
function accessClaims(at) {
  try { const c = JSON.parse(Buffer.from(String(at).split('.')[1], 'base64url').toString()); return { hub: c.hub, hub_role: c.hub_role }; } catch { return {}; }
}
async function endSessionUrl(idToken) {
  const c = config();
  const m = await issuerMeta().catch(() => null);
  const back = `${c.base}/sign-in`;
  // OMAKO's own sign-out for apps (GET /logout), else the OIDC end_session_endpoint.
  const endpoint = (m && m.end_session_endpoint) || (c.issuer ? `${c.issuer}/logout` : null);
  if (!endpoint) return back;
  const u = new URL(endpoint);
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('post_logout_redirect_uri', back);
  if (idToken) u.searchParams.set('id_token_hint', idToken);
  return u.toString();
}

// Tests swap the caches out between cases.
function _reset() { meta = null; metaAt = 0; metaFor = ''; jwks = null; jwksFor = ''; emails.clear(); pairingCache = { mtime: -1, value: null }; }

module.exports = {
  config, pairing, challengeText, PAIRING_FILE, CHALLENGE_FILE, discovery, resourceMetadata, resourceFor, validAgent,
  agentPrincipal, roleOf, challenge, authorizeRequest, completeSignIn, endSessionUrl, looksLikeJwt, AuthError, AGENT_NAME, _reset,
};
