// lib/omako.js: the hub's side of the pairing with OMAKO Accounts (doc 30,
// contract C1). A paired hub holds a confidential client at OMAKO, kept in
// <data dir>/omako.json (mode 0600, never logged, never in state.json or an
// export), and uses it to tell OMAKO which agent addresses to accept.
// A hub signing in through another issuer is not paired: every call here is
// then a no-op that says so.
'use strict';
const fs = require('fs');
const oidc = require('./oidc');

const DEFAULT_OMAKO = 'https://id.omako.dev';
const omakoUrl = () => (process.env.BUREAU_OMAKO_URL || DEFAULT_OMAKO).replace(/\/$/, '');

function basic(pair) {
  return `Basic ${Buffer.from(`${encodeURIComponent(pair.client_id)}:${encodeURIComponent(pair.client_secret)}`).toString('base64')}`;
}
async function call(method, path, { pair, body } = {}) {
  const base = (pair && pair.issuer ? pair.issuer : omakoUrl()).replace(/\/$/, '');
  const headers = { accept: 'application/json' };
  if (pair) headers.authorization = basic(pair);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body: j };
}

// What GET /api/omako shows the owner: paired or not, never the secret.
async function status() {
  const pair = oidc.pairing();
  const c = oidc.config();
  const base = { issuer: c.issuer || null, sign_in: c.webOn, agents_door: c.on };
  if (!pair) return { ...base, paired: false };
  const out = { ...base, paired: true, hub_id: pair.hub_id || null, workspace_id: pair.workspace_id || null, paired_at: pair.paired_at || null };
  try {
    const r = await call('GET', '/api/hubs/self', { pair });
    if (r.ok) Object.assign(out, { verified: !!r.body.verified, agents: r.body.agents || [], hub_url: r.body.hub_url || null });
    else out.error = `OMAKO answered ${r.status}`;
  } catch (e) { out.error = `OMAKO can't be reached: ${e.message}`; }
  return out;
}

// After a settings change: open or close each agent's address at OMAKO.
// Returns a summary for the PATCH answer, or null when the hub isn't paired.
async function syncAgents(changes) {
  const pair = oidc.pairing();
  if (!pair) return null;
  const results = [];
  for (const { name, on } of changes) {
    try {
      const r = await call(on ? 'PUT' : 'DELETE', `/api/hubs/self/agents/${encodeURIComponent(name)}`, { pair });
      results.push({ agent: name, on, ok: r.ok, ...(r.ok ? {} : { error: r.body.error || `OMAKO answered ${r.status}` }) });
    } catch (e) {
      results.push({ agent: name, on, ok: false, error: `OMAKO can't be reached: ${e.message}` });
    }
  }
  const failed = results.filter((x) => !x.ok);
  if (failed.length) console.error('[omako] agent sync failed:', failed.map((x) => `${x.agent} ${x.error}`).join('; '));
  return { synced: results };
}

// ---- pairing, used by hub/tools/omako.js on the server ----
async function startPairing(hubUrl) {
  const r = await call('POST', '/api/hubs/pair', { body: { hub_url: hubUrl } });
  if (!r.ok) throw new Error(r.body.error_description || r.body.error || `OMAKO answered ${r.status}`);
  return r.body; // {pairing_id, challenge, verify_url, interval, expires_in}
}
// One poll. {pending} or {slow_down} or the pairing (with its secret).
async function pollPairing(pairingId) {
  const r = await call('POST', '/api/hubs/pair/token', { body: { pairing_id: pairingId } });
  if (r.ok) return { done: r.body };
  const err = r.body.error || `http_${r.status}`;
  if (err === 'authorization_pending') return { pending: true };
  if (err === 'slow_down') return { slow_down: true };
  throw new Error(r.body.error_description || err);
}
function writeChallenge(text) {
  fs.mkdirSync(require('path').dirname(oidc.CHALLENGE_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(oidc.CHALLENGE_FILE, String(text), { mode: 0o644 });
}
function clearChallenge() { try { fs.unlinkSync(oidc.CHALLENGE_FILE); } catch { /* gone */ } }
// Written 0600 from birth; fchmod too, in case an old file kept another mode.
function writePairing(p) {
  const file = oidc.PAIRING_FILE;
  fs.mkdirSync(require('path').dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600); fs.writeSync(fd, JSON.stringify(p, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
async function unpair() {
  const pair = oidc.pairing();
  if (!pair) return { unpaired: false, note: 'not paired' };
  let remote = null;
  try { const r = await call('DELETE', '/api/hubs/self', { pair }); remote = r.ok ? 'revoked at OMAKO' : `OMAKO answered ${r.status}`; } catch (e) { remote = `OMAKO can't be reached: ${e.message}`; }
  try { fs.unlinkSync(oidc.PAIRING_FILE); } catch { /* gone */ }
  return { unpaired: true, remote };
}

module.exports = { status, syncAgents, startPairing, pollPairing, writeChallenge, clearChallenge, writePairing, unpair, omakoUrl };
