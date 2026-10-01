// site/tools/og-image.js: builds the share image (og.png) and the icon set
// from the site's own pixel font and its texts (i18n/en.json, section "image").
//
//   node site/tools/og-image.js
//
// It draws the title-screen logo exactly like drawTitle in site.js (the word
// in the 3x5 font scaled 4x, a dark extruded side, a 1px outline, the light
// face) on the title's dithered band, and the B of that logo, with one frame
// of the title's shine, for the favicons and the home-screen icons.
//
// Needs a Chromium through Playwright, which the site itself never loads:
// PLAYWRIGHT=path/to/node_modules/playwright (default: resolved from here),
// CHROMIUM=path/to/chrome-headless-shell (default: Playwright's own).
// Writes og.png, favicon.ico, favicon-16/32/48.png, apple-touch-icon.png,
// icon-192.png, icon-512.png, icon-maskable-512.png into site/.
'use strict';
const fs = require('fs');
const path = require('path');
const SITE = path.join(__dirname, '..');
const ASSETS = path.join(SITE, '..', 'hub', 'public');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const texts = JSON.parse(fs.readFileSync(path.join(SITE, 'i18n', 'en.json'), 'utf8')).image;

// Runs in the page: the logo, the B and the band, from office-assets.js.
function brandKit() {
  const A = window.OfficeAssets, P = 'dmg', SH = A.PALETTES[P].shades;
  function layer(text, shade, k) {
    const w = A.textWidth(text) - 1, small = document.createElement('canvas'); small.width = w; small.height = 5;
    A.drawText(small.getContext('2d'), text, P, 0, 0, shade);
    const big = document.createElement('canvas'); big.width = w * k; big.height = 5 * k;
    const b = big.getContext('2d'); b.imageSmoothingEnabled = false; b.drawImage(small, 0, 0, w * k, 5 * k);
    return big;
  }
  // k: font scale (4 on the title screen), depth: extrusion (6 there),
  // sway: lean, shine: where one frame of the title's shine crosses the face
  // (a fraction of its width), or null
  function logo(text, k, depth, sway, shine) {
    const side = layer(text, 0, k), face = layer(text, 3, k);
    const c = document.createElement('canvas'); c.width = face.width + 2 + Math.round(sway * depth / 3); c.height = face.height + depth + 2;
    c.text = text;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    for (let d = depth; d >= 1; d--) x.drawImage(side, Math.round(1 + sway * d / 3), 1 + d);
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach((o) => x.drawImage(side, 1 + o[0], 1 + o[1]));
    x.drawImage(face, 1, 1);
    if (shine != null) {
      const u = k / 4, s = document.createElement('canvas'); s.width = face.width; s.height = face.height;
      const sc = s.getContext('2d');
      sc.drawImage(face, 0, 0); sc.globalCompositeOperation = 'source-atop'; sc.fillStyle = '#fff';
      for (let r = 0; r < face.height; r++) sc.fillRect(Math.round(shine * face.width - r * 0.6 * u), r, Math.max(1, Math.round(5 * u)), 1);
      x.globalAlpha = 0.55; x.drawImage(s, 1, 1); x.globalAlpha = 1;
    }
    return c;
  }
  // the title screen's band: light screen, mid-green dots, solid checker at the edges
  function band(w, h, edge) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = SH[3]; x.fillRect(0, 0, w, h); x.fillStyle = SH[2];
    for (let y = 0; y < h; y++) for (let i = (y % 2); i < w; i += 2) if (y < edge || y >= h - edge || (i + y) % 4 === 0) x.fillRect(i, y, 1, 1);
    return c;
  }
  // Decoration: an ordered (Bayer 4x4) dither ramp, in the screen's own two
  // darker shades, at the logo's pixel size. intensity(u, v) gives 0..1 for
  // each cell (u, v from 0 to 1 across the card); up to 0.5 it fills with
  // mid-green dots, past 0.5 a second layer of dark green comes in.
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const RAMPS = {
    none: () => 0,
    // denser toward the frame on every side, clear in the middle
    vignette: (u, v) => Math.pow(clamp((Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5) * 1.9) * 2 - 0.62) / 0.38), 1.3) * 0.8,
    // only the two side panels outside the centre square, darkening outward
    sides: (u, v) => clamp((Math.abs(u - 0.5) - 0.235) / 0.265) * 0.85,
    // the four corners, fading in toward the middle
    corners: (u, v) => clamp(((Math.abs(u - 0.5) * 2 + Math.abs(v - 0.5) * 2) / 2 - 0.55) / 0.45) * 0.9,
    // top and bottom bands, like light falling off an old screen
    bands: (u, v) => clamp((Math.abs(v - 0.5) * 2 - 0.66) / 0.34) * 0.75,
    // a light falling from the top left, the way the glass catches it
    light: (u, v) => clamp((u * 0.55 + v * 0.45 - 0.42) / 0.58) * 0.7 * (Math.abs(u - 0.5) > 0.235 || v > 0.86 ? 1 : 0),
  };
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function decor(kind, cols, rows, x0, y0, x1, y1) {
    const c = document.createElement('canvas'); c.width = cols; c.height = rows;
    const x = c.getContext('2d'), ramp = RAMPS[kind] || RAMPS.none;
    for (let y = y0; y < y1; y++) for (let i = x0; i < x1; i++) {
      const t = ramp(i / cols, y / rows), b = (BAYER[y % 4][i % 4] + 0.5) / 16;
      if (b < Math.min(1, t * 2)) { x.fillStyle = SH[2]; x.fillRect(i, y, 1, 1); }
      if (b < Math.max(0, t * 2 - 1)) { x.fillStyle = SH[1]; x.fillRect(i, y, 1, 1); }
    }
    return c.toDataURL();
  }
  // fw, fh: the letter's own box (face plus its 1px outline), which is what
  // gets centred; the extruded shadow hangs below and to the right of it
  const url = (c, k) => ({ src: c.toDataURL(), w: c.width, h: c.height, fw: (A.textWidth(c.text) - 1) * k + 2, fh: 5 * k + 2 });
  window.kit = {
    decor,
    shades: SH,
    logo: url(logo('BUREAU', 4, 6, 1, null), 4),
    b32: url(logo('B', 4, 4, 1, 0.6), 4),
    b16: url(logo('B', 2, 2, 1, 0.6), 2),
    band: (w, h, edge) => band(w, h, edge).toDataURL(),
  };
}

function ico(pngs) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = pngs.map(({ size, buf }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size, 0); e.writeUInt8(size, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12); offset += buf.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...pngs.map((p) => p.buf)]);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await (await browser.newContext()).newPage();
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(ASSETS, 'office-assets.js'), 'utf8') });
  await page.evaluate(brandKit);
  const k = await page.evaluate(() => ({ shades: window.kit.shades, logo: window.kit.logo, b32: window.kit.b32, b16: window.kit.b16 }));
  const [s0, s1, s2, s3] = k.shades;
  const FONT = 'data:font/ttf;base64,' + fs.readFileSync(path.join(ASSETS, 'office-font.ttf')).toString('base64');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // ---- og.png: the whole card is the screen. Everything that reads (the
  // logo, the tagline, the address) sits inside the centre square, so the
  // square crops some apps make (WhatsApp, iMessage) keep all of it; the
  // frame still runs round the whole rectangle.
  const scale = 5, cols = Math.ceil(1200 / scale) + 1, rows = 38, SQUARE = 540;
  const bandImg = await page.evaluate(([w, h]) => window.kit.band(w, h, 8), [cols, rows]);
  // the decoration fills the inside of the frame only (45px in from each edge)
  const DECOR = process.env.DECOR || 'none', dRows = Math.ceil(630 / scale), edge = Math.ceil(45 / scale);
  const decorImg = await page.evaluate(([k, w, h, e]) => window.kit.decor(k, w, h, e, e, w - e, h - e), [DECOR, cols, dRows, edge]);
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<html><head><style>
    @font-face { font-family: 'OfficePixel'; src: url('${FONT}'); }
    body { margin: 0; width: 1200px; height: 630px; overflow: hidden; position: relative; background: ${s3}; font-family: 'OfficePixel', monospace; color: ${s0}; }
    .band { position: absolute; left: 0; top: 100px; width: ${cols * scale}px; height: ${rows * scale}px; background: url(${bandImg}) 0 0 / 100% 100%; image-rendering: pixelated; }
    .decor { position: absolute; left: 0; top: 0; width: ${cols * scale}px; height: ${dRows * scale}px; background: url(${decorImg}) 0 0 / 100% 100%; image-rendering: pixelated; }
    .frame { position: absolute; inset: 24px; border: 7px solid ${s0}; box-shadow: inset 0 0 0 7px ${s3}, inset 0 0 0 14px ${s1}; }
    .wrap { position: absolute; left: ${(1200 - SQUARE) / 2}px; top: ${(630 - SQUARE) / 2}px; width: ${SQUARE}px; height: ${SQUARE}px;
            display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; text-align: center; }
    .logo { width: ${k.logo.w * scale}px; height: ${k.logo.h * scale}px; image-rendering: pixelated; }
    h1 { margin: 0; font-weight: normal; font-size: 34px; line-height: 1.45; letter-spacing: .02em; max-width: ${SQUARE}px; text-wrap: balance; }
    /* the address in capitals: in this pixel face they stand much taller than
       lowercase at the same width */
    .tag { font-size: 32px; line-height: 1; padding: 18px 24px; background: ${s0}; color: ${s3}; letter-spacing: .06em; }
    .tag span { display: inline-block; }
  </style></head><body><div class="decor"></div><div class="band"></div><div class="frame"></div><div class="wrap">
    <img class="logo" src="${k.logo.src}">
    <h1>${esc(texts['line-1'])}</h1>
    <div class="tag"><span>${esc(texts.tag)}</span></div>
  </div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  if (process.env.MEASURE) console.log('tag', await page.evaluate(() => { const r = document.querySelector('.tag').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }));
  await page.screenshot({ path: process.env.OG_OUT || path.join(SITE, 'og.png') });
  if (process.env.OG_ONLY) { await browser.close(); return; }

  // ---- icons: the B on the screen green, at an integer scale; from 180px up
  // on the title's band (at 1px the dither is noise)
  const ICONS = [
    ['favicon-16.png', 16, 'b16', 1, false], ['favicon-32.png', 32, 'b16', 2, false], ['favicon-48.png', 48, 'b16', 3, false],
    ['apple-touch-icon.png', 180, 'b32', 5, true], ['icon-192.png', 192, 'b32', 5, true], ['icon-512.png', 512, 'b32', 14, true],
    ['icon-maskable-512.png', 512, 'b32', 10, true], // smaller: inside the round mask's safe circle
  ];
  const favicons = [];
  for (const [file, px, glyph, scaleBy, dither] of ICONS) {
    const g = k[glyph], cells = Math.ceil(px / scaleBy) + 1;
    const bg = dither ? await page.evaluate(([n]) => window.kit.band(n, n, 0), [cells + 1]) : null;
    // centre the letter (face and outline), not the letter and its shadow;
    // the dither moves with it so its pixels stay on the letter's grid
    const left = Math.round((px - g.fw * scaleBy) / 2), top = Math.round((px - g.fh * scaleBy) / 2);
    const bx = (left % scaleBy) - scaleBy, by = (top % scaleBy) - scaleBy;
    if (process.env.MEASURE) console.log(file, 'letter box', g.fw * scaleBy + 'x' + g.fh * scaleBy, 'at', left + ',' + top, 'margins', left + '/' + (px - left - g.fw * scaleBy), top + '/' + (px - top - g.fh * scaleBy));
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(`<html><body style="margin:0;width:${px}px;height:${px}px;background:${s3};overflow:hidden;position:relative">
      ${bg ? `<div style="position:absolute;left:${bx}px;top:${by}px;width:${(cells + 1) * scaleBy}px;height:${(cells + 1) * scaleBy}px;background:url(${bg}) 0 0/100% 100%;image-rendering:pixelated"></div>` : ''}
      <img src="${g.src}" style="position:absolute;left:${left}px;top:${top}px;width:${g.w * scaleBy}px;height:${g.h * scaleBy}px;image-rendering:pixelated"></body></html>`);
    const buf = await page.screenshot({ path: path.join(SITE, file) });
    if (file.startsWith('favicon-')) favicons.push({ size: px, buf });
  }
  fs.writeFileSync(path.join(SITE, 'favicon.ico'), ico(favicons));
  await browser.close();
  console.log('og.png, favicon.ico and ' + ICONS.length + ' icons written to site/');
})().catch((e) => { console.error(e); process.exit(1); });
