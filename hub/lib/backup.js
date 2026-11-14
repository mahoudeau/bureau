// lib/backup.js: the nightly off-server backup (doc 31, D1 to D4). Dossier's
// pattern, in plain JavaScript. Only on the SQLite store, and only when the
// backup settings are all there.
//
// Every night at 03:30 Paris time (two minutes after boot when a night was
// missed), into the operator's Nextcloud, under <BUREAU_NEXTCLOUD_DIR>/<hub_id>/:
//
//   db/bureau-YYYY-MM-DD.db.gz.enc   the whole database: a VACUUM INTO copy,
//                                    checked with PRAGMA integrity_check,
//                                    gzipped, encrypted (lib/backup-crypto.js)
//   current/<name>.json.enc          missions, agents, projects and settings as
//                                    JSON, encrypted too: readable without the
//                                    hub. No token, hash or session in them.
//
// The server holds only the public key, so it cannot read what it sent. It
// fetches every file back and compares it byte for byte with what it sent.
// The nightly copies are kept 30 days, the copy of the 1st of each month for
// a year. Once a month the Mac decrypts the newest copy and opens it (bureau
// backup verify) and tells the hub (POST /api/backups/verified).
//
// Each run is a row in backup_runs; each check from the Mac a row in
// backup_checks (lib/sqlite-store.js). Only the operator sees any of it
// (lib/auth.js isOperator): no event goes to the log the hub's users read.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const store = require('./store');
const bcrypto = require('./backup-crypto');
const { createRemote } = require('./webdav');
const { VERSION } = require('../version');

const KEEP_DAYS = 30;
const KEEP_MONTHS = 12;
const HOUR = 3600_000;
const STALE_MS = 36 * HOUR;
const CHECK_DAYS = 35;
const CATCH_UP_MS = 26 * HOUR;
const NAME_RE = /^bureau-(\d{4}-\d{2}-\d{2})\.db\.gz\.enc$/;
const HUB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SETTINGS = ['BUREAU_BACKUP_PUBLIC_KEY', 'BUREAU_NEXTCLOUD_URL', 'BUREAU_NEXTCLOUD_USER', 'BUREAU_NEXTCLOUD_PASSWORD'];
const DEFAULT_DIR = 'Bureau-backup';

// ---- The clock: days and the 03:30 run follow Paris ----
function paris(d) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const parisDay = (d) => paris(d).day;

// Milliseconds until the next hh:mm in Paris. A daylight-saving night can be
// an hour off, which a nightly job does not mind.
function msUntilNext(d, hour = 3, minute = 30) {
  let diff = hour * 60 + minute - paris(d).minutes;
  if (diff <= 0) diff += 24 * 60;
  return diff * 60_000 - d.getSeconds() * 1000 - d.getMilliseconds();
}

// Which nightly copies the remote keeps: the last 30 days, and the 1st of
// each month for a year. Names that are not nightly copies are left alone.
function keepRemote(names, today) {
  const t = Date.parse(`${today}T00:00:00Z`);
  const keep = [], drop = [];
  for (const name of names) {
    const m = NAME_RE.exec(name);
    if (!m) continue;
    const age = (t - Date.parse(`${m[1]}T00:00:00Z`)) / 86400_000;
    const monthly = m[1].endsWith('-01') && age <= KEEP_MONTHS * 31;
    (age <= KEEP_DAYS || monthly ? keep : drop).push(name);
  }
  return { keep, drop };
}

// ---- Settings ----
const isLoopback = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
// { on: true, publicKey, remote } when everything is set, else { on: false,
// problem }: problem is null when nothing at all is set (a hub without the
// off-server backup), and a plain sentence when something is half set.
function configFromEnv(env = process.env, storeKind = store.STORE_KIND) {
  const given = SETTINGS.filter((k) => env[k]);
  if (!given.length) return { on: false, problem: null };
  if (storeKind !== 'sqlite') return { on: false, problem: 'The off-server backup needs the SQLite store (BUREAU_STORE=sqlite).' };
  const missing = SETTINGS.filter((k) => !env[k]);
  if (missing.length) return { on: false, problem: `The off-server backup is half set up: ${missing.join(', ')} missing.` };
  try { bcrypto.parsePublicKey(env.BUREAU_BACKUP_PUBLIC_KEY); } catch (e) { return { on: false, problem: `BUREAU_BACKUP_PUBLIC_KEY: ${e.message}.` }; }
  let u;
  try { u = new URL(env.BUREAU_NEXTCLOUD_URL); } catch { return { on: false, problem: 'BUREAU_NEXTCLOUD_URL is not an address.' }; }
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && isLoopback(u.hostname)))) return { on: false, problem: 'BUREAU_NEXTCLOUD_URL must use https.' };
  const dir = String(env.BUREAU_NEXTCLOUD_DIR || DEFAULT_DIR).trim().replace(/^\/+|\/+$/g, '');
  if (!dir || dir.split('/').some((s) => !s || s === '.' || s === '..')) return { on: false, problem: 'BUREAU_NEXTCLOUD_DIR is not a folder name.' };
  return {
    on: true, problem: null, publicKey: env.BUREAU_BACKUP_PUBLIC_KEY.trim(),
    remote: { url: env.BUREAU_NEXTCLOUD_URL, user: env.BUREAU_NEXTCLOUD_USER, password: env.BUREAU_NEXTCLOUD_PASSWORD, dir },
  };
}

// ---- The readable export ----
// Keys that hold a credential or its hash, wherever they sit. The chosen
// parts hold none today; this keeps a later field from leaking.
const SECRET_KEYS = new Set(['hash', 'token', 'id_token', 'access_token', 'refresh_token', 'password', 'secret', 'client_secret', 'mcp_token', 'review_links', 'answer_link', 'view_token']);
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (!SECRET_KEYS.has(k)) out[k] = scrub(x);
  return out;
}
const json = (v) => Buffer.from(JSON.stringify(v, null, 1) + '\n', 'utf8');
// The files under current/, before encryption: name -> bytes.
function readableFiles(state, hubId, at = new Date()) {
  const files = new Map();
  files.set('missions.json', json(scrub(state.tasks || [])));
  files.set('agents.json', json(scrub(state.agents || [])));
  files.set('projects.json', json(scrub(state.projects || [])));
  files.set('settings.json', json(scrub(store.settingsOf(state))));
  files.set('manifest.json', json({
    kind: 'bureau-backup-current', format: 1, hub_id: hubId, at: at.toISOString(), bureau_version: VERSION, schema_version: state.schema_version || 0,
    counts: { missions: (state.tasks || []).length, agents: (state.agents || []).length, projects: (state.projects || []).length },
  }));
  return files;
}

// ---- The operator's red line ----
// Pure, for the tests and the Desk: what the operator must hear about.
// since: when the backup started being expected (its first run, else boot),
// so a hub set up an hour ago is not already late.
function alertsFor({ configured, problem, lastOkAt, lastRun, lastOkCheckAt, since }, now = new Date()) {
  if (problem) return [problem];
  if (!configured) return [];
  const t = now.getTime();
  const out = [];
  const okRef = lastOkAt || since;
  if (!okRef || t - Date.parse(okRef) > STALE_MS) {
    const why = lastRun && !lastRun.ok && lastRun.detail ? ` The last run: ${lastRun.detail}` : '';
    out.push(`No good off-server backup in 36 hours${lastOkAt ? ` (last good one ${lastOkAt})` : ''}.${why}`);
  }
  const checkRef = lastOkCheckAt || since;
  if (!checkRef || t - Date.parse(checkRef) > CHECK_DAYS * 24 * HOUR)
    out.push(`No good check of a backup on the Mac in ${CHECK_DAYS} days. Run bureau backup verify.`);
  return out;
}

// ---- The runner ----
function create({ env = process.env } = {}) {
  const SQL = store.sql;
  const config = configFromEnv(env);
  const remote = config.on ? createRemote(config.remote) : null;
  const bootedAt = new Date().toISOString();
  let running = null;
  let nextRunAt = null;

  function hubId() {
    const id = SQL.identity().hub_id;
    if (typeof id !== 'string' || !HUB_ID_RE.test(id)) throw new Error(`the hub id ${JSON.stringify(id)} cannot name a folder`);
    return id;
  }

  async function runOnce(at) {
    const day = parisDay(at);
    const id = SQL.backupRuns.start(new Date().toISOString());
    const notes = [];
    let offsite = null, verified = null, ok = false;
    const tmp = path.join(store.DATA_DIR, `offsite-${process.pid}.db`);
    try {
      const hub = hubId();
      // The copy holds what memory holds: a pending save goes first.
      store.flush();
      SQL.copyTo(tmp, SQL.integrity);
      const raw = fs.readFileSync(tmp);
      const state = store.load();
      const name = `bureau-${day}.db.gz.enc`;
      const files = new Map();
      files.set(`${hub}/db/${name}`, bcrypto.encrypt(zlib.gzipSync(raw), config.publicKey));
      for (const [n, body] of readableFiles(state, hub, at)) files.set(`${hub}/current/${n}.enc`, bcrypto.encrypt(body, config.publicKey));
      notes.push(`${(state.tasks || []).length} missions, ${(state.agents || []).length} agents, ${(state.projects || []).length} projects`);
      try {
        await remote.mkdir(`${hub}/db`);
        await remote.mkdir(`${hub}/current`);
        for (const [p, body] of files) await remote.put(p, body);
        offsite = true;
      } catch (e) {
        offsite = false;
        notes.push(`sending to ${remote.where} failed: ${e.message}`);
      }
      if (offsite) {
        // The server cannot decrypt: what it can prove is that the bytes
        // Nextcloud keeps are the bytes it sent.
        try {
          const bad = [];
          for (const [p, body] of files) {
            const back = await remote.get(p);
            if (!back.equals(body)) bad.push(`${p} (${back.length} bytes back, ${body.length} sent)`);
          }
          verified = !bad.length;
          if (bad.length) notes.push(`fetched back, it differs from what was sent: ${bad.join(', ')}`);
          else notes.push(`${name} (${files.get(`${hub}/db/${name}`).length} bytes) sent to ${remote.where} and fetched back identical`);
        } catch (e) {
          verified = false;
          notes.push(`fetching the copy back failed: ${e.message}`);
        }
      }
      if (verified) {
        try {
          const { drop } = keepRemote(await remote.list(`${hub}/db`), day);
          for (const n of drop) await remote.del(`${hub}/db/${n}`);
          if (drop.length) notes.push(`${drop.length} old ${drop.length === 1 ? 'copy' : 'copies'} pruned`);
        } catch (e) { notes.push(`pruning old copies failed: ${e.message}`); }
      }
      ok = offsite === true && verified === true;
    } catch (e) {
      notes.push(`the copy failed: ${e.message}`);
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* not there */ }
    }
    const detail = notes.join('; ');
    SQL.backupRuns.finish(id, { at: new Date().toISOString(), ok, offsite, verified, detail });
    if (ok) console.log(`[backup] ${detail}`);
    else console.error(`[backup] OFF-SERVER BACKUP FAILED: ${detail}`);
    return SQL.backupRuns.get(id);
  }

  // One run at a time: a run asked for during the nightly one gets its result.
  function run({ at } = {}) {
    if (!config.on) return Promise.reject(new Error(config.problem || 'the off-server backup is not set up'));
    if (!running) running = runOnce(at || new Date()).finally(() => { running = null; });
    return running;
  }

  function recordCheck({ ok, file, detail, by }) {
    const id = SQL.backupChecks.add({ at: new Date().toISOString(), ok, file, detail, by });
    return SQL.backupChecks.recent(1).find((c) => c.id === id) || null;
  }

  function status(now = new Date()) {
    const sql = store.STORE_KIND === 'sqlite';
    const lastRun = sql ? (SQL.backupRuns.recent(1)[0] || null) : null;
    const lastOk = sql ? SQL.backupRuns.lastOk() : null;
    const first = sql ? SQL.backupRuns.first() : null;
    const lastCheck = sql ? (SQL.backupChecks.recent(1)[0] || null) : null;
    const lastOkCheck = sql ? SQL.backupChecks.lastOk() : null;
    const inputs = {
      configured: config.on, problem: config.problem, lastRun,
      lastOkAt: lastOk ? lastOk.finished_at : null,
      lastOkCheckAt: lastOkCheck ? lastOkCheck.checked_at : null,
      since: first ? first.started_at : bootedAt,
    };
    const alerts = alertsFor(inputs, now);
    let hub = null;
    if (sql) { try { hub = hubId(); } catch { hub = null; } }
    return {
      configured: config.on, problem: config.problem, store: store.STORE_KIND,
      hub_id: hub, where: remote ? `${remote.where}/${hub || '?'}` : null,
      last_run: lastRun, last_ok_at: inputs.lastOkAt,
      last_check: lastCheck, last_ok_check_at: inputs.lastOkCheckAt,
      next_run_at: nextRunAt, alerts,
    };
  }

  // The short form /api/health carries for the operator.
  function health(now = new Date()) {
    const s = status(now);
    return { configured: s.configured, last_ok_at: s.last_ok_at, last_ok_check_at: s.last_ok_check_at, alerts: s.alerts };
  }

  const runs = (n = 20) => (store.STORE_KIND === 'sqlite' ? SQL.backupRuns.recent(n) : []);
  const checks = (n = 10) => (store.STORE_KIND === 'sqlite' ? SQL.backupChecks.recent(n) : []);

  // Every night at 03:30 Paris time. A hub that comes up after a missed night
  // catches up two minutes in. Returns the stop.
  function schedule() {
    if (!config.on) {
      if (config.problem) console.error(`[backup] ${config.problem}`);
      return () => {};
    }
    let timer;
    const plan = (ms) => {
      nextRunAt = new Date(Date.now() + ms).toISOString();
      timer = setTimeout(() => {
        run().catch((e) => console.error(`[backup] ${e.message}`)).finally(() => plan(msUntilNext(new Date())));
      }, ms);
      timer.unref();
    };
    const lastOk = SQL.backupRuns.lastOk();
    const missed = !lastOk || Date.now() - Date.parse(lastOk.finished_at) > CATCH_UP_MS;
    plan(missed ? 2 * 60_000 : msUntilNext(new Date()));
    let hub = '?';
    try { hub = hubId(); } catch (e) { console.error(`[backup] ${e.message}`); }
    console.log(`[backup] off-server backup to ${remote.where}/${hub}, next run ${nextRunAt}`);
    return () => clearTimeout(timer);
  }

  return { run, status, health, runs, checks, recordCheck, schedule, configured: config.on };
}

module.exports = { create, configFromEnv, keepRemote, msUntilNext, parisDay, alertsFor, readableFiles, NAME_RE, STALE_MS, CHECK_DAYS, DEFAULT_DIR };
