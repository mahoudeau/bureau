// Every call to the hub. Bearer token on, errors turned into sentences, and a
// 401 sends you back to sign in.

const KEY = 'bureau_token';

export function getToken() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function setToken(token) {
  try { localStorage.setItem(KEY, token); } catch { /* signing in will just not stick */ }
}
function clearToken() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// A page that left doesn't need its error shown.
export const isAbort = (e) => !!e && e.name === 'AbortError';

// /sign-in, remembering the page you wanted.
export function signInPath() {
  const here = location.pathname + location.search + location.hash;
  return location.pathname === '/sign-in' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(here)}`;
}

// Where sign-in goes next. Only ever a path on this hub.
export function nextPath(search = location.search) {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/')) return '/';
  try {
    const url = new URL(next, location.origin);
    if (url.origin !== location.origin || url.pathname === '/sign-in') return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

// A full page load on purpose: it drops the event stream and all held state.
export function signOut() {
  clearToken();
  location.assign('/sign-in');
}

let leaving = false;
function sessionEnded() {
  if (leaving) return;
  leaving = true;
  clearToken();
  location.replace(signInPath());
}

function sentence(status, body) {
  if (body && typeof body.error === 'string' && body.error) return body.error;
  if (status === 403) return "You don't have access to that.";
  if (status === 404) return 'Not found.';
  if (status >= 500) return `The hub had a problem (${status}).`;
  return `The hub refused that (${status}).`;
}

// opts: method, body, headers, signal, token (use this one instead of the
// stored one), keepSession (a 401 throws instead of leaving for sign-in).
async function send(path, opts = {}) {
  const { method = 'GET', body, headers, signal, token = getToken(), keepSession = false } = opts;
  const allHeaders = { authorization: `Bearer ${token}`, ...headers };
  let payload = body;
  if (body !== undefined && typeof body !== 'string' && !(body instanceof Blob) && !(body instanceof FormData)) {
    payload = JSON.stringify(body);
    allHeaders['content-type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(path, { method, headers: allHeaders, body: payload, signal });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError("Can't reach the hub.", 0, null);
  }
  if (res.ok) return res;
  const parsed = await res.json().catch(() => null);
  if (res.status === 401 && !keepSession) sessionEnded();
  throw new ApiError(sentence(res.status, parsed), res.status, parsed);
}

// Parsed JSON, or null for an empty answer.
export async function request(path, opts) {
  const res = await send(path, opts);
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new ApiError('The hub sent something unreadable.', res.status, text); }
}

export const get = (path, opts) => request(path, { ...opts, method: 'GET' });
export const post = (path, body, opts) => request(path, { ...opts, method: 'POST', body });
export const patch = (path, body, opts) => request(path, { ...opts, method: 'PATCH', body });
export const del = (path, opts) => request(path, { ...opts, method: 'DELETE' });

// The Response itself, for text and blobs. Errors throw the same way.
export const raw = (path, opts) => send(path, opts);
