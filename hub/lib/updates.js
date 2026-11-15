// lib/updates.js: is there a newer Bureau? Once a day the hub reads the
// release tags on GitHub. When one is newer than this hub, it reads that
// release's UPGRADING.md and keeps the sections for every release between the
// two, so the operator sees what to do before upgrading. Only the operator sees
// it (GET /api/updates). It sends nothing about the hub: two plain GET requests
// a day, with no token and no version in them. BUREAU_UPDATE_CHECK=off stops it.
'use strict';
const { VERSION } = require('../version');

const REPO = 'mahoudeau/bureau';
const FIRST_MS = 60_000;
const EVERY_MS = 24 * 3600_000;
const MAX_BYTES = 512 * 1024;

function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}
// Negative, zero or positive, like a sort comparator. Release versions only.
function compare(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
// The highest vX.Y.Z among the tags. Anything else (v0.6.0-rc1, notes) is skipped.
function latestOf(names) {
  return names.map((n) => String(n).replace(/^v/, '')).filter(parse)
    .reduce((best, v) => (!best || compare(v, best) > 0 ? v : best), null);
}

// The `## <version>...` sections of UPGRADING.md for the releases after `from`,
// up to and including `to`, in file order (newest first), plus the general
// `## Upgrade` steps. A section runs to the next `## ` heading.
function sectionsOf(md, from, to) {
  const out = [];
  let steps = null, cur = null;
  for (const line of String(md).split('\n')) {
    const head = /^## (.+)$/.exec(line);
    if (head) {
      cur = null;
      const title = head[1].trim();
      const v = /^(\d+\.\d+\.\d+)\b/.exec(title);
      if (v && compare(v[1], from) > 0 && compare(v[1], to) <= 0) {
        cur = { version: v[1], title, markdown: '' };
        out.push(cur);
      } else if (title === 'Upgrade') {
        steps = cur = { title, markdown: '' };
      }
      continue;
    }
    if (cur) cur.markdown += line + '\n';
  }
  for (const s of out.concat(steps || [])) s.markdown = s.markdown.trim();
  return { sections: out, steps: steps && steps.markdown ? steps.markdown : null };
}

// Links in UPGRADING.md are relative to the repo. On the dashboard they point
// at the file on GitHub, at the release read.
function absoluteLinks(md, base) {
  return md.replace(/\]\((?!https?:|mailto:)([^)\s]+)\)/g, (_, href) =>
    `](${href.startsWith('#') ? `${base}/UPGRADING.md${href}` : `${base}/${href.replace(/^\.\//, '')}`})`);
}

function create({ env = process.env, fetchImpl = globalThis.fetch, current = VERSION, repo = REPO } = {}) {
  const off = /^(off|0|false|no)$/i.test(String(env.BUREAU_UPDATE_CHECK || '').trim());
  let last = { checked_at: null, latest: null, error: null, sections: [], steps: null };
  let running = null;

  async function get(url, accept) {
    const r = await fetchImpl(url, { headers: { accept, 'user-agent': 'bureau-hub' }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
    const text = await r.text();
    if (text.length > MAX_BYTES) throw new Error(`${new URL(url).host} sent more than ${MAX_BYTES} bytes`);
    return text;
  }

  async function checkOnce() {
    const at = new Date().toISOString();
    try {
      const tags = JSON.parse(await get(`https://api.github.com/repos/${repo}/tags?per_page=100`, 'application/vnd.github+json'));
      if (!Array.isArray(tags)) throw new Error('the tag list is not a list');
      const latest = latestOf(tags.map((t) => t && t.name));
      if (!latest) throw new Error('no release tag found');
      let sections = [], steps = null;
      if (parse(current) && compare(latest, current) > 0) {
        const base = `https://github.com/${repo}/blob/v${latest}`;
        const md = await get(`https://raw.githubusercontent.com/${repo}/v${latest}/UPGRADING.md`, 'text/plain');
        const found = sectionsOf(md, current, latest);
        sections = found.sections.map((s) => ({ ...s, markdown: absoluteLinks(s.markdown, base) }));
        steps = found.steps && absoluteLinks(found.steps, base);
        console.log(`[updates] Bureau ${latest} is out; this hub runs ${current}`);
      }
      last = { checked_at: at, latest, error: null, sections, steps };
    } catch (e) {
      // Keep what the last good check found: a failed check says so, it does
      // not forget a release it already saw.
      last = { ...last, checked_at: at, error: e.message };
    }
    return status();
  }

  function check() {
    if (off) return Promise.resolve(status());
    if (!running) running = checkOnce().finally(() => { running = null; });
    return running;
  }

  function status() {
    const behind = !!(last.latest && parse(current) && compare(last.latest, current) > 0);
    const tag = behind ? `v${last.latest}` : 'main';
    return {
      enabled: !off, current, latest: last.latest, behind,
      checked_at: last.checked_at, error: last.error,
      sections: behind ? last.sections : [], steps: behind ? last.steps : null,
      upgrading_url: `https://github.com/${repo}/blob/${tag}/UPGRADING.md`,
      changelog_url: `https://github.com/${repo}/blob/${tag}/CHANGELOG.md`,
    };
  }

  // A minute after boot, then once a day. Returns the stop.
  function schedule() {
    if (off) { console.log('[updates] the daily release check is off (BUREAU_UPDATE_CHECK)'); return () => {}; }
    const first = setTimeout(() => check(), FIRST_MS);
    const daily = setInterval(() => check(), EVERY_MS);
    first.unref(); daily.unref();
    return () => { clearTimeout(first); clearInterval(daily); };
  }

  return { check, status, schedule, enabled: !off };
}

module.exports = { create, parse, compare, latestOf, sectionsOf, absoluteLinks };
