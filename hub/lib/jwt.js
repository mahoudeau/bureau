// lib/jwt.js: JSON Web Tokens from a sign-in issuer, checked with node:crypto
// alone. Ported from Dossier's src/server/jwt.ts, written to be shared.
//
// What a token has to pass, in order: three parts; a header naming an
// asymmetric algorithm we accept (never none, never HMAC, no crit); the type
// when one is asked for (at+jwt for access tokens); a signature from a key in
// the issuer's JWKS, found by kid; then iss exactly, aud containing ours
// exactly, exp, nbf and iat within a small clock skew.
'use strict';
const { createPublicKey, verify } = require('crypto');

// forged: the token itself is junk (malformed, an algorithm we never take, a
// signature that doesn't verify). Only those should count against a client's
// address: an expired or unmapped token is a real person's, a missing key
// list is the issuer's fault, and claude.ai's users share a few IPs.
class JwtError extends Error {
  constructor(message, forged = false) { super(message); this.forged = forged; }
}
const forged = (m) => new JwtError(m, true);

// EdDSA is what id.omako.dev signs with. The other two are there so another
// issuer (a self-hosted Bureau's Keycloak, say) works unchanged.
const ALGS = new Set(['EdDSA', 'ES256', 'RS256']);

function b64json(s) {
  let v;
  try { v = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { throw forged('malformed token'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw forged('malformed token');
  return v;
}

// Which key types can sign with which algorithm.
const fits = (k, alg) =>
  (alg === 'EdDSA' && k.kty === 'OKP' && k.crv === 'Ed25519') || (alg === 'ES256' && k.kty === 'EC' && k.crv === 'P-256') || (alg === 'RS256' && k.kty === 'RSA');

// The issuer's signing keys, cached. A kid we don't have means the issuer may
// have rotated, so the set is fetched again, but at most every refreshMs: a
// stream of tokens with made-up kids can't turn us into a request flood.
// When the issuer is down: keys we already have keep working past their ttl,
// and a fetch that failed isn't tried again for retryMs.
function createJwks(uri, fetchFn = fetch, opts = {}) {
  const ttl = opts.ttlMs ?? 3600_000;
  const refresh = opts.refreshMs ?? 30_000;
  const retry = opts.retryMs ?? 30_000;
  let keys = [];
  let fetchedAt = 0;
  let pending = null;
  let failedAt = 0;
  let triedAt = 0;

  const load = () => (pending ??= (async () => {
    try {
      const res = await fetchFn(await uri(), { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new JwtError(`the issuer's keys answered ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body.keys)) throw new JwtError("the issuer's keys aren't a JWKS");
      keys = body.keys.filter((k) => !!k && typeof k === 'object');
      fetchedAt = Date.now();
    } finally {
      pending = null;
    }
  })());

  const find = (kid, alg) => {
    const usable = keys.filter((k) => fits(k, alg) && (!k.alg || k.alg === alg) && (!k.use || k.use === 'sig'));
    if (kid !== undefined) return usable.find((k) => k.kid === kid);
    // No kid: only when there's no doubt which key it is.
    return usable.length === 1 ? usable[0] : undefined;
  };

  const tryLoad = async () => {
    if (failedAt && Date.now() - failedAt < retry) return;
    triedAt = Date.now();
    try { await load(); failedAt = 0; } catch { failedAt = Date.now(); }
  };

  return {
    async key(kid, alg) {
      if (!fetchedAt || Date.now() - fetchedAt > ttl) await tryLoad();
      if (!keys.length) throw new JwtError("the issuer's keys can't be reached right now");
      let k = find(kid, alg);
      if (!k && Date.now() - triedAt >= refresh) { await tryLoad(); k = find(kid, alg); }
      if (!k) throw new JwtError("signed with a key the issuer doesn't list");
      const { kid: _k, alg: _a, use: _u, key_ops: _o, ...jwk } = k;
      try { return createPublicKey({ key: jwk, format: 'jwk' }); } catch { throw new JwtError('the issuer listed a key that can\'t be read'); }
    },
  };
}

// o: {jwks, issuer, audience, typ, skewSec, now}. audience is a string the
// token's aud must be or contain exactly, or a function (aud list) -> the
// matched audience or null (the hub accepts any of its agent addresses).
// Returns the claims, with the matched audience as `_aud`.
async function verifyJwt(token, o) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw forged('malformed token');
  const header = b64json(parts[0]);
  const alg = header.alg;
  if (typeof alg !== 'string' || !ALGS.has(alg)) throw forged(`algorithm ${String(alg)} isn't accepted`);
  if (!parts[2]) throw forged('malformed token');
  if (header.crit !== undefined) throw forged("critical header parameters aren't supported");
  if (o.typ !== undefined) {
    const typ = typeof header.typ === 'string' ? header.typ.toLowerCase() : '';
    if (typ !== o.typ && typ !== `application/${o.typ}`) throw new JwtError(`the token's type isn't ${o.typ}`);
  }
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  const key = await o.jwks.key(kid, alg);
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2], 'base64url');
  let ok = false;
  try {
    ok = alg === 'EdDSA' ? verify(null, data, key, sig)
      : alg === 'ES256' ? verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig)
        : verify('sha256', data, key, sig);
  } catch { ok = false; }
  if (!ok) throw forged('bad signature');

  const c = b64json(parts[1]);
  const now = Math.floor((o.now ?? Date.now)() / 1000);
  const skew = o.skewSec ?? 60;
  if (c.iss !== o.issuer) throw new JwtError('wrong issuer');
  const aud = typeof c.aud === 'string' ? [c.aud] : Array.isArray(c.aud) ? c.aud.filter((a) => typeof a === 'string') : [];
  const matched = typeof o.audience === 'function' ? o.audience(aud) : (aud.includes(o.audience) ? o.audience : null);
  if (!matched) throw new JwtError('wrong audience');
  if (typeof c.exp !== 'number') throw new JwtError('no expiry');
  if (now > c.exp + skew) throw new JwtError('expired');
  if (c.nbf !== undefined && (typeof c.nbf !== 'number' || now < c.nbf - skew)) throw new JwtError('not valid yet');
  if (c.iat !== undefined && (typeof c.iat !== 'number' || c.iat > now + skew)) throw new JwtError('issued in the future');
  return { ...c, _aud: matched };
}

// A bearer value shaped like a JWT, so it goes to the verifier rather than the
// token table. Hub tokens are hex and never contain dots.
const looksLikeJwt = (t) => typeof t === 'string' && /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(t);

module.exports = { JwtError, createJwks, verifyJwt, looksLikeJwt, b64json };
