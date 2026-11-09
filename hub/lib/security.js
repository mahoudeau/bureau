// lib/security.js: the hub's network and boot rules, in one place. Zero
// dependencies. Who may start without a token, which browser origins may call
// the API, the Content-Security-Policy on the pages, the SSE ticket, and what
// an error is allowed to say to a client.
'use strict';
const crypto = require('crypto');

const TOKEN_HINT = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
const DEMO_VAR = 'BUREAU_ALLOW_INSECURE_LOCAL';

// .env.example ships the first one (test/storage.sh keeps the two in step).
// The rest are what docs and tutorials tend to leave behind.
const PLACEHOLDERS = new Set(['change-me-long-random-string', 'change-me', 'changeme', 'change_me', 'replace-me', 'your-token', 'your-token-here', 'yourtoken', 'token', 'secret', 'password', '...', '<token>', '<your-token>']);
const isPlaceholder = (t) => PLACEHOLDERS.has(String(t).trim().toLowerCase());

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const isLoopback = (host) => LOOPBACK.has(String(host).trim().toLowerCase().replace(/^\[|\]$/g, ''));

// What is wrong with the credentials this hub was given, one entry each. Empty
// when they are all real. Strict mode with no BUREAU_TOKEN is fine: that is the
// last step of the upgrade, the shared token retired. A shared token left at a
// placeholder still authenticates as an agent on every project, so it counts.
function credentialGaps({ token, bossToken }) {
  const gaps = [];
  if (!token && !bossToken) gaps.push('neither BUREAU_TOKEN nor BUREAU_BOSS_TOKEN is set');
  if (bossToken && isPlaceholder(bossToken)) gaps.push('BUREAU_BOSS_TOKEN is still a placeholder anyone can read');
  if (token && isPlaceholder(token)) gaps.push('BUREAU_TOKEN is still a placeholder anyone can read');
  return gaps;
}
// A hub that started on the demo opt-in answers loopback names only.
const insecureCredentials = (creds) => credentialGaps(creds).length > 0;

// Null when the hub may start, else what to print before refusing to. The
// opt-in is for a demo on one machine, so it never covers a wider bind. It
// never covers boss and shared tokens that match either: nothing can tell the
// boss from an agent then, and that is no demo.
function bootRefusal({ token, bossToken = '', host, env = process.env }) {
  if (bossToken && token && bossToken.trim() === token.trim()) return 'BUREAU_BOSS_TOKEN and BUREAU_TOKEN are the same value: the boss credential would be the one every agent holds. Refusing to boot. Give the boss a token of his own.';
  const gaps = credentialGaps({ token, bossToken });
  if (!gaps.length) return null;
  const why = gaps.join(', and ');
  if (env[DEMO_VAR] !== '1') return `${why}, so the hub will not start: anyone who can reach it could drive the API. Set your own in hub/.env, for example from ${TOKEN_HINT}. For a local demo only, ${DEMO_VAR}=1 starts it anyway, on loopback.`;
  if (!isLoopback(host)) return `${why}, and ${DEMO_VAR}=1 covers loopback only, but HOST is ${host}. Set a real token, or bind 127.0.0.1.`;
  return null;
}

const portless = (h) => String(h || '').trim().toLowerCase().replace(/:\d+$/, '');

// A tokenless demo hub answers loopback names only, so a site that points its
// own DNS name at 127.0.0.1 cannot pass for a local page.
function loopbackRequest(req) { return isLoopback(portless(req.headers.host)); }

// Browsers send Origin on every cross-origin request, and on same-origin
// writes. A client with no Origin is not a browser page, and the token is what
// stops it. A form post or a text/plain fetch reaches the handler without any
// preflight, so the origin is judged here rather than left to CORS headers.
function originPolicy(env = process.env) {
  const allowed = new Set(String(env.BUREAU_ALLOWED_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean));
  let publicHost = '';
  try { publicHost = new URL(env.BUREAU_PUBLIC_URL).host.toLowerCase(); } catch { /* not set */ }
  return {
    allowed: (origin) => allowed.has(origin),
    // Same origin is judged on what the browser asked for: Host, or the name a
    // reverse proxy says it was given, or the public URL the owner configured.
    permits(req) {
      const origin = req.headers.origin;
      if (origin === undefined || allowed.has(origin)) return true;
      let host;
      try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
      const forwarded = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
      return !!host && (host === String(req.headers.host || '').toLowerCase() || host === forwarded || host === publicHost);
    },
  };
}

// The dashboards. A per-response nonce for their inline scripts, which also
// means no inline event handler runs, and nothing leaves for another origin.
// The one exception is GitHub's API: v2's awaiting-merge rail reads pull
// request state straight from it, anonymous, and writes nothing there.
function dashboardCsp(nonce) {
  return [`default-src 'none'`, `script-src 'self' 'nonce-${nonce}'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' blob: data:`, `font-src 'self'`, `connect-src 'self' https://api.github.com`,
    `frame-src 'self'`, `form-action 'self'`, `base-uri 'none'`, `object-src 'none'`, `frame-ancestors 'self'`].join('; ');
}
// The review and mission record pages run no script at all.
const PAGE_CSP = [`default-src 'none'`, `style-src 'unsafe-inline'`, `img-src 'self'`, `form-action 'self'`, `base-uri 'none'`, `frame-ancestors 'none'`].join('; ');

// A dashboard shell, with its nonce on every script tag. The files are ours,
// so this is a plain substitution over text no client wrote.
function dashboardPage(html) {
  const nonce = crypto.randomBytes(16).toString('base64');
  return { nonce, csp: dashboardCsp(nonce), html: String(html).replace(/<script\b/g, `<script nonce="${nonce}"`) };
}

// EventSource cannot set a header, so the browser trades its Bearer for this:
// good once, for a minute, on the event stream and nothing else. A ticket holds
// the principal that minted it, so the stream it opens is cut to that
// principal's view and answers to the same route rule.
const TICKET_TTL_MS = 60_000, TICKET_MAX = 1000;
const tickets = new Map();
function issueTicket(principal, now = Date.now()) {
  for (const [t, v] of tickets) if (v.exp <= now) tickets.delete(t);
  while (tickets.size >= TICKET_MAX) tickets.delete(tickets.keys().next().value);
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, { exp: now + TICKET_TTL_MS, principal });
  return { ticket, expires_in: TICKET_TTL_MS / 1000 };
}
// The principal behind a ticket, or null. One use, valid or not.
function takeTicket(ticket, now = Date.now()) {
  if (typeof ticket !== 'string' || !ticket) return null;
  const v = tickets.get(ticket);
  tickets.delete(ticket);
  return v && v.exp > now ? v.principal : null;
}

// An error the caller can act on. Anything else stays in the server log.
const requestError = (status, message) => Object.assign(new Error(message), { status, expose: true });
// A plain Error thrown on purpose carries a message written for the caller. A
// system error or a git failure carries paths and stderr instead.
function publicMessage(e) {
  if (!e || typeof e.message !== 'string' || e.constructor !== Error) return 'internal error';
  if (e.syscall || e.errno !== undefined || e.cmd || e.stderr !== undefined) return 'internal error';
  return e.message;
}

module.exports = { TOKEN_HINT, DEMO_VAR, isPlaceholder, isLoopback, bootRefusal, insecureCredentials, loopbackRequest, originPolicy, dashboardPage, PAGE_CSP, issueTicket, takeTicket, requestError, publicMessage };
