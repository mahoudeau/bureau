// Office screenshots and regression guard: seeds a scratch hub through the
// API, then shoots /office at several viewports plus the dashboard's mini
// office at each phase of a short scripted day. At every phase it also
// runs the office's test mode on each canvas (nothing drawn outside
// 384x216, every pixel one of the palette's 4 shades) and exits 1 on any
// violation. Boots nothing: point it at a hub that is already running,
// never at the live one.
//
// Usage: BASE=http://localhost:4714 TOKEN=demo OUT=/tmp/shots node test/office-shots.js
// Guard only, no screenshots: SHOTS=0 (OUT not needed), see office-guard.sh.
// Optional: PLAYWRIGHT (module path), CHROMIUM (executable), DPR (default 1).
// All names and missions are fictional.
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE || '').replace(/\/$/, '');
const TOKEN = process.env.TOKEN || '';
const OUT = process.env.OUT || '';
const DPR = +(process.env.DPR || 1);
const SHOTS = process.env.SHOTS !== '0';
if (!BASE || !TOKEN || (SHOTS && !OUT)) {
  console.error('usage: BASE=http://localhost:4714 TOKEN=demo OUT=/tmp/shots node test/office-shots.js (or SHOTS=0 without OUT)');
  process.exit(2);
}
const pw = require(process.env.PLAYWRIGHT || 'playwright');

const PROJECT = 'office-shots';
const AGENTS = [
  { name: 'wren', kind: 'claude-code', capabilities: ['code', 'critic'] },
  { name: 'otto', kind: 'cowork', capabilities: ['research'] },
  { name: 'juniper', kind: 'claude-code', capabilities: ['code'] },
  { name: 'basil', kind: 'cowork', capabilities: ['writing'] },
  { name: 'marlo', kind: 'claude-code', capabilities: ['code'] },
];
const VIEWS = [
  { id: 'desk-1440', width: 1440, height: 900, url: '/office' },
  { id: 'laptop-1024', width: 1024, height: 768, url: '/office' },
  { id: 'wide-1280', width: 1280, height: 720, url: '/office' }, // 16:9, the tight fit
  { id: 'phone-390', width: 390, height: 844, url: '/office' },
  { id: 'mini-v2', width: 1440, height: 900, url: '/v2', clip: '#v2-office-card' },
  { id: 'mini-v2-2x', width: 1440, height: 900, url: '/v2', clip: '#v2-office-card', dpr: 2 },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, p, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 409) throw new Error(method + ' ' + p + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j;
}
const beat = (name, activity) => api('POST', '/api/agents/heartbeat', { name, activity });
async function mission(title) {
  return (await api('POST', '/api/tasks', { title, project: PROJECT, priority: 3 })).task.id;
}
const claim = (agent, id) => api('POST', '/api/tasks/claim', { agent, id });
const patch = (id, body) => api('PATCH', '/api/tasks/' + id, body);

async function seed() {
  await api('POST', '/api/projects', { label: 'Office Shots', id: PROJECT });
  for (const a of AGENTS) {
    await api('POST', '/api/agents/register', a);
    await sleep(30); // distinct last_seen, so the roster order is known
  }
  const ids = {};
  ids.sign = await mission('Repaint the lobby sign');
  ids.clips = await mission('Sort the paperclip archive');
  ids.music = await mission('Tune the elevator music');
  ids.fern = await mission('Water the fern by the window');
  ids.stapler = await mission('Recount the stapler inventory');
  ids.picnic = await mission('Draft the picnic memo');
  await claim('otto', ids.clips);
  await patch(ids.clips, { agent: 'otto', status: 'in_progress', note: 'opened the archive boxes' });
  await claim('juniper', ids.fern);
  await claim('basil', ids.stapler);
  await patch(ids.stapler, { agent: 'basil', status: 'done', note: 'forty-two staplers, all accounted for' });
  await claim('wren', ids.picnic);
  for (const a of AGENTS) { await beat(a.name, 'editing'); await sleep(30); }
  return ids;
}

// Seeded Math.random so the random cast is the same on every run.
function seededRandom() {
  let s = 1234567;
  Math.random = function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  if (SHOTS) fs.mkdirSync(OUT, { recursive: true });
  const ids = await seed();
  const launch = {};
  if (process.env.CHROMIUM) launch.executablePath = process.env.CHROMIUM;
  const browser = await pw.chromium.launch(launch);
  const pages = [];
  const violations = [];
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.dpr || DPR });
    await ctx.addInitScript(tok => {
      try { localStorage.setItem('bureau_token', tok); } catch (e) {}
    }, TOKEN);
    await ctx.addInitScript(seededRandom);
    await ctx.addInitScript(() => { window.__OFFICE_TEST = true; }); // the office's test mode, mini iframe included
    const page = await ctx.newPage();
    page.on('pageerror', e => violations.push(v.id + ': page error: ' + e.message));
    // /api/events is a stream: wait for load, never networkidle
    await page.goto(BASE + v.url, { waitUntil: 'load' });
    pages.push({ v, page });
  }
  // click at an art pixel of the 384x216 canvas, whatever the scale
  async function clickArt(page, x, y) {
    const r = await page.evaluate(() => { const b = document.getElementById('c').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; });
    await page.mouse.click(r.l + (x + 0.5) * r.w / 384, r.t + (y + 0.5) * r.h / 216);
  }
  // the guard: ask the office canvas (the page itself, or the mini iframe)
  // what its test mode saw since the last check
  async function guard(phase, v, page) {
    const frame = v.url === '/office' ? page.mainFrame() : page.frames().find(f => /\/office\?mini/.test(f.url()));
    const r = frame && await frame.evaluate(() => window.__officeTest && window.__officeTest.check()).catch(() => null);
    const where = phase + ' ' + v.id;
    if (!r) { violations.push(where + ': no office test hook found'); return; }
    for (const o of r.outOfBounds) violations.push(where + ': ' + o.what + ' drawn at ' + o.x + ',' + o.y + ' ' + o.w + 'x' + o.h + ', outside 384x216');
    if (r.offPalette) violations.push(where + ': ' + r.offPalette + ' pixels off the ' + r.palette + ' palette, first at ' +
      r.offPaletteAt.map(p => p.x + ',' + p.y + ' rgba(' + p.rgba.join(',') + ')').join('; '));
  }
  let n = 0;
  async function shoot(phase, only) {
    n++;
    for (const { v, page } of only || pages) {
      await guard(phase, v, page);
      if (!SHOTS) continue;
      const file = path.join(OUT, String(n).padStart(2, '0') + '-' + phase + '-' + v.id + '.png');
      if (v.clip) {
        const el = await page.$(v.clip);
        if (el) await el.screenshot({ path: file });
        else await page.screenshot({ path: file });
      } else {
        await page.screenshot({ path: file });
      }
      console.log(file);
    }
  }

  await sleep(3000);
  await shoot('boot');

  // a claim: marlo walks to the board, picks up a folder, walks back
  await claim('marlo', ids.music);
  await sleep(1300);
  await shoot('claim-walk');
  await sleep(5000);
  await shoot('claim-settled');

  // a review park: wren carries the folder to the boss door
  await patch(ids.picnic, { agent: 'wren', status: 'review', note: 'memo drafted, needs a yes' });
  await sleep(1500);
  await shoot('review-walk');
  await sleep(3000);
  await shoot('review-park');

  // heartbeats in reverse seat order, then any event that refreshes the roster
  for (const name of ['basil', 'juniper', 'otto']) { await beat(name, 'thinking'); await sleep(30); }
  await sleep(2100); // outlast the office's 2s refresh throttle
  await mission('Label the new filing cabinet');
  await sleep(2500);
  await shoot('heartbeats');

  // a newcomer clocks in at the front door and walks to a free desk
  await api('POST', '/api/agents/register', { name: 'pip', kind: 'cowork', capabilities: ['support'] });
  await sleep(900);
  await shoot('newcomer');
  await sleep(8000);
  await shoot('settled');

  // interaction, full office only: click a desk for the agent card, then
  // the keyboard path (Tab from the board to the second desk)
  const office = pages.filter(p => p.v.url === '/office');
  for (const { page } of office) await clickArt(page, 180, 160); // wren's desk
  await sleep(400);
  await shoot('card', office);
  for (const { page } of office) {
    await page.keyboard.press('Escape');
    await page.focus('#c');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  }
  await sleep(300);
  await shoot('tab-focus', office);

  await browser.close();
  if (violations.length) {
    console.error('office guard: ' + violations.length + ' violation(s)');
    for (const v of violations) console.error('  ' + v);
    process.exit(1);
  }
  console.log('office guard: clean (bounds and 4-shade palette, every phase, every view)');
}

main().catch(e => { console.error(e); process.exit(1); });
