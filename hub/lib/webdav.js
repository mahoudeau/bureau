// lib/webdav.js: just enough WebDAV for the off-server backup, on fetch, no
// library (Dossier's client, in plain JavaScript): make a folder, list one,
// put, get and delete a file. Nextcloud serves a user's files at
// <url>/remote.php/dav/files/<user>/, with an app password on Basic auth.
// No error message ever holds the password.
'use strict';

const enc = (p) => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/');

// config: { url, user, password, dir }
function createRemote(config) {
  const root = `${String(config.url).replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(config.user)}/${enc(config.dir)}`;
  const authHeader = `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`;
  const url = (p) => (p ? `${root}/${enc(p)}` : root);

  async function call(method, p, init = {}, ok = []) {
    const body = init.body === undefined || typeof init.body === 'string' ? init.body : new Uint8Array(init.body);
    let res;
    try {
      // No redirects: the password never goes to an address nobody set.
      res = await fetch(url(p), { method, body, redirect: 'manual', headers: { authorization: authHeader, ...init.headers }, signal: AbortSignal.timeout(init.timeoutMs || 120_000) });
    } catch (e) {
      throw new Error(`${method} ${config.dir}/${p}: ${(e && e.cause && e.cause.code) || (e && e.name) || 'network error'}`);
    }
    if (!res.ok && !ok.includes(res.status)) {
      try { await res.body?.cancel(); } catch { /* nothing to drain */ }
      throw new Error(`${method} ${config.dir}/${p}: ${res.status} ${res.statusText}`);
    }
    return res;
  }

  return {
    // Where the backup lives, for messages: never the password.
    where: `${new URL(config.url).host}/${config.dir}`,
    // Every folder on the way. 405 means it is already there.
    async mkdir(dir) {
      const parts = String(dir).split('/').filter(Boolean);
      await call('MKCOL', '', {}, [405]);
      for (let i = 1; i <= parts.length; i++) await call('MKCOL', parts.slice(0, i).join('/'), {}, [405]);
    },
    // File names directly inside dir; an empty list when dir does not exist.
    async list(dir) {
      const res = await call('PROPFIND', dir, { headers: { depth: '1' } }, [404]);
      if (res.status === 404) return [];
      const xml = await res.text();
      const self = decodeURIComponent(new URL(url(dir)).pathname).replace(/\/+$/, '');
      const names = [];
      for (const m of xml.matchAll(/<(?:[\w-]+:)?href>([^<]+)<\/(?:[\w-]+:)?href>/g)) {
        const href = decodeURIComponent(new URL(m[1], root).pathname).replace(/\/+$/, '');
        if (href === self) continue;
        names.push(href.slice(href.lastIndexOf('/') + 1));
      }
      return names;
    },
    async put(file, body) {
      const res = await call('PUT', file, { body, headers: { 'content-type': 'application/octet-stream' } });
      try { await res.body?.cancel(); } catch { /* empty */ }
    },
    async get(file) {
      return Buffer.from(await (await call('GET', file)).arrayBuffer());
    },
    async del(file) {
      const res = await call('DELETE', file, {}, [404]);
      try { await res.body?.cancel(); } catch { /* empty */ }
    },
  };
}

module.exports = { createRemote };
