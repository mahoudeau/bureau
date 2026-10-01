// site/site.js: the Bureau handheld. The office lives inside the screen,
// and the page scroll is a camera: it glides between stops, zooms on an
// agent, the agent spins like a character-select sprite, a role card
// pops. Art comes from the office's own library (office-assets.js),
// drawn at the office's scale (agents 2x, 8px tiles, 4 shades).
//
// Pixel law (GB-DIRECTION learning 3): the camera may glide at fractional
// scales while it moves, but at rest it settles on a whole-number scale
// and a whole-pixel origin, so every art pixel is a crisp square.
(function () {
  'use strict';
  var A = window.OfficeAssets;
  var OW = 384, OH = 216;          // the office floor, in art pixels
  var PAD = 112;                   // wall, attic and floor continue past the office
  var WW = OW + PAD * 2, WH = OH + PAD * 2;
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE_POINTER = matchMedia('(pointer: fine)').matches;
  var REPO = 'https://github.com/mahoudeau/bureau';
  var $ = function (id) { return document.getElementById(id); };
  var Snd = window.BureauSound;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  var params = new URLSearchParams(location.search);

  // ---- palette (SELECT cycles); every palette has a night twin -----------
  var PALS = ['dmg', 'pocket', 'olive', 'amber'];
  PALS.forEach(function (k) {
    var s = A.PALETTES[k].shades;
    A.PALETTES[k + '-night'] = { label: A.PALETTES[k].label, shades: [s[0], s[1], s[1], s[2]] };
  });
  var palKey = store('bureau_site_palette');
  if (PALS.indexOf(palKey) === -1) palKey = 'dmg';
  function shades() { return A.PALETTES[palKey].shades; }
  function applyPalette() {
    var sh = shades(), root = document.documentElement.style;
    for (var i = 0; i < 4; i++) root.setProperty('--sh' + i, sh[i]);
    bgFor = null;
    if (starSprites) starSprites = null;
  }
  function cyclePalette() {
    palKey = PALS[(PALS.indexOf(palKey) + 1) % PALS.length];
    store('bureau_site_palette', palKey); applyPalette(); Snd.play('select');
  }

  // ---- text font (?font=pixelify|silkscreen|vt323|press, for the H6 pick)
  var FONTS = { pixelify: "'Pixelify Sans'", silkscreen: "'Silkscreen'", vt323: "'VT323'", press: "'OfficePixel'" };
  if (FONTS[params.get('font')]) document.documentElement.style.setProperty('--font', FONTS[params.get('font')] + ', monospace');

  // ---- extra sprites for the site (4-shade grids, same law) --------------
  A.SPRITES['site-sparkle-a'] = ['..0..', '..0..', '00300', '..0..', '..0..'];
  A.SPRITES['site-sparkle-b'] = ['0...0', '.0.0.', '..3..', '.0.0.', '0...0'];
  A.SPRITES['site-hand'] = ['000', '033', '033', '000'];
  A.SPRITES['site-book'] = ['00000', '01110', '01210', '01110', '01110', '00000'];
  A.SPRITES['site-box'] = ['0000000000', '0222222220', '0200000020', '0222222220', '0222112220', '0222222220', '0222222220', '0000000000'];
  A.SPRITES['site-window-round'] = ['..0000..', '.033330.', '03303330', '03303330', '00000000', '03303330', '.033330.', '..0000..'];

  // ---- the world ---------------------------------------------------------
  var world = document.createElement('canvas'); world.width = WW; world.height = WH;
  var wctx = world.getContext('2d'); wctx.imageSmoothingEnabled = false;
  var bg = document.createElement('canvas'); bg.width = WW; bg.height = WH;
  var bgctx = bg.getContext('2d'); bgctx.imageSmoothingEnabled = false;
  var bgFor = null;

  var DESKS = [
    { x: 60, y: 88 }, { x: 152, y: 88 }, { x: 244, y: 88 },
    { x: 60, y: 152 }, { x: 152, y: 152 }, { x: 244, y: 152 },
  ];
  function seatOf(d) { return { x: d.x + 10, y: d.y + 12 }; }
  var AISLE_Y = 124;
  var SPOT = { coffee: { x: 40, y: 176 }, board: { x: 40, y: 48 } };
  var LADDER_X = 128, ATTIC_FLOOR = -4, ATTIC_Y = ATTIC_FLOOR - 16;
  var DOOR = { x: 300, y: 176 };

  // The cast: boss-drawn heads and bodies, consul-assembled (see
  // GB-DIRECTION, parts era). Fixed picks so the tour is the same for all.
  var CAST = [
    { id: 'lead', head: 'h2', body: 'b1', pos: { x: 84, y: 46 }, standing: true },
    { id: 'critic', head: 'h5', body: 'b3', pos: { x: 324, y: 122 }, standing: true, carry: 'folder-review' },
    { id: 'lib', head: 'h9', body: 'b8', pos: { x: 20, y: 110 }, standing: true },
    { id: 'w1', head: 'h1', body: 'b2', desk: 0 },
    { id: 'w2', head: 'h3', body: 'b4', desk: 1 },
    { id: 'w3', head: 'h6', body: 'b5', desk: 3 },
    { id: 'w4', head: 'h7', body: 'b6', desk: 4, roamer: true },
    { id: 'w5', head: 'h8', body: 'b7', desk: 5 },
  ];
  CAST.forEach(function (a) {
    if (a.desk != null) { a.pos = seatOf(DESKS[a.desk]); a.seated = true; }
    a.home = { x: a.pos.x, y: a.pos.y };
    a.facing = a.seated ? 'back' : 'front';
    a.path = []; a.walking = false; a.bob = 0; a.speed = 1;
    a.nextBeat = performance.now() + 1500 + Math.random() * 4000;
    a.typing = a.seated; a.typeUntil = 0;
  });
  function agent(id) { for (var i = 0; i < CAST.length; i++) if (CAST[i].id === id) return CAST[i]; return null; }
  var board = { queued: 3, working: 2, review: 1, done: 2 };

  function drawStatic(p) {
    var c = bgctx, sh = A.PALETTES[p].shades;
    c.fillStyle = sh[0]; c.fillRect(0, 0, WW, WH);
    // the building continues past the office edge: wall above, floor below
    A.tileRect(c, 'wall-paper', p, 0, 0, WW, PAD + 32);
    A.tileRect(c, 'wall-base', p, 0, PAD + 32, WW, 8);
    A.tileRect(c, 'floor-grid', p, 0, PAD + 40, WW, WH - PAD - 40);
    c.save(); c.translate(PAD, PAD);
    drawAttic(c, p, sh);
    A.tileRect(c, 'floor-rug', p, 120, 176, 144, 24);
    c.fillStyle = sh[0]; c.fillRect(120, 175, 144, 1); c.fillRect(120, 200, 144, 1);
    A.drawSprite(c, 'window-night', p, 152, 8);
    A.drawSprite(c, 'window-night', p, 192, 8);
    A.drawSprite(c, 'window-night', p, 232, 8);
    A.drawSprite(c, 'board', p, 24, 6);
    A.ttfText(c, 'MISSIONS', p, 28, 8, 0, 8);
    A.drawSprite(c, 'shelf-brain', p, 8, 60);
    A.drawSprite(c, 'plant', p, 34, 192);
    drawLadder(c, sh);
    // meeting room
    A.tileRect(c, 'wall-cap', p, 312, 40, 8, 64);
    A.tileRect(c, 'wall-cap', p, 312, 96, 72, 8);
    c.fillStyle = sh[2]; c.fillRect(312, 96, 24, 8);
    for (var i = 0; i < 3; i++) { A.drawSprite(c, 'chair', p, 336 + i * 16, 46); A.drawSprite(c, 'chair', p, 336 + i * 16, 82); }
    A.drawSprite(c, 'table-meet', p, 334, 56);
    // the boss's office
    A.tileRect(c, 'wall-cap', p, 304, 152, 80, 8);
    A.tileRect(c, 'wall-cap', p, 304, 152, 8, 64);
    A.drawSprite(c, 'door-boss', p, DOOR.x, DOOR.y);
    A.drawSprite(c, 'mat', p, 285, 183);
    A.drawSprite(c, 'bench', p, 252, 202);
    c.fillStyle = sh[1]; c.fillRect(328, 176, 48, 16);
    c.fillStyle = sh[2]; c.fillRect(330, 178, 44, 10);
    c.restore();
    bgFor = p;
  }

  // The attic sits above the office like a cutaway: beams, planks, a round
  // window. Retired beliefs are stored here in boxes.
  function drawAttic(c, p, sh) {
    var x0 = -24, x1 = 176, y0 = -104;
    c.fillStyle = sh[1]; c.fillRect(x0, y0, x1 - x0, ATTIC_FLOOR - y0);
    c.fillStyle = sh[0];
    for (var bx = x0; bx < x1; bx += 24) c.fillRect(bx, y0, 2, ATTIC_FLOOR - y0);
    // roof slope, stepped like pixel shingles
    for (var r = 0; r < 20; r++) { c.fillRect(x0, y0 + r * 2, 20 - r, 2); c.fillRect(x1 - 20 + r, y0 + r * 2, 20 - r, 2); }
    A.drawSprite(c, 'site-window-round', p, 72, -80);
    c.fillStyle = sh[2]; c.fillRect(x0, ATTIC_FLOOR - 6, x1 - x0, 6);
    c.fillStyle = sh[0]; c.fillRect(x0, ATTIC_FLOOR - 7, x1 - x0, 1); c.fillRect(x0, ATTIC_FLOOR, x1 - x0, 2);
    for (var px = x0 + 6; px < x1; px += 14) c.fillRect(px, ATTIC_FLOOR - 6, 1, 6);
    c.fillStyle = sh[0]; c.fillRect(x0 - 2, y0, 2, ATTIC_FLOOR - y0 + 2); c.fillRect(x1, y0, 2, ATTIC_FLOOR - y0 + 2);
  }
  function drawLadder(c, sh) {
    var x = LADDER_X + 2, top = ATTIC_FLOOR - 2, bottom = 60;
    c.fillStyle = sh[0];
    c.fillRect(x, top, 2, bottom - top); c.fillRect(x + 11, top, 2, bottom - top);
    for (var y = top + 3; y < bottom; y += 5) c.fillRect(x + 2, y, 9, 1);
  }

  // Sprite outline: standing agents face us on a light floor, and their
  // faces share the floor's shade. A 1px darkest-shade ring around the
  // silhouette (the classic handheld sprite trick) keeps them readable.
  var outlined = {};
  function outlinedSprite(key, p) {
    var id = p + '|' + key;
    if (outlined[id]) return outlined[id];
    var src = A.sprite(key, p);
    if (!src) return null;
    var w = src.width + 2, h = src.height + 2;
    var cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
    var c = cnv.getContext('2d');
    c.drawImage(src, 1, 1);
    var img = c.getImageData(0, 0, w, h), d = img.data;
    var sh = A.PALETTES[p].shades[0];
    var r = parseInt(sh.slice(1, 3), 16), g = parseInt(sh.slice(3, 5), 16), b = parseInt(sh.slice(5, 7), 16);
    var solid = function (x, y) { return x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0; };
    var ring = [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) ring.push(y * w + x);
    }
    ring.forEach(function (i) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; });
    c.putImageData(img, 0, 0);
    outlined[id] = cnv;
    return cnv;
  }

  function drawAgent(c, a, t, p) {
    var x = a.pos.x | 0, y = a.pos.y | 0;
    var facing = a.facing, frame = 0, lift = 0;
    if (a.walking) frame = Math.floor(t / 140) % 2;
    if (a.spin) {
      var e = t - a.spin.t0, q = a.spin.dur / (a.spin.turns * 4);
      if (e >= a.spin.dur) { a.spin = null; a.facing = 'front'; facing = 'front'; if (a.onSpun) { var f = a.onSpun; a.onSpun = null; f(); } }
      else {
        facing = ['front', 'right', 'back', 'left'][Math.floor(e / q) % 4];
        lift = Math.round(4 * Math.abs(Math.sin(Math.PI * (e % q) / q)));
      }
    }
    var key = A.assemble(a.head, a.body, facing, frame);
    var cnv = key && outlinedSprite(key, p);
    if (!cnv) return;
    var bob = a.bob;
    if (lift) { c.fillStyle = A.PALETTES[p].shades[1]; c.fillRect(x - 4, y + 15, 24, 1); }
    c.drawImage(cnv, x - 10, y - 18 + bob - lift, 36, 36);
    if (a.carry && !a.seated) A.drawSprite(c, a.carry, p, a.carry === 'site-box' ? x + 3 : x + 12, a.carry === 'site-box' ? y - 26 + bob : y - 2 + bob);
    if (a.emote && t < a.emoteUntil) A.drawSprite(c, a.emote, p, x + 14, y - 22);
    if (a.waveUntil && t < a.waveUntil && facing === 'front') {
      var up = Math.floor(t / 220) % 2;
      A.drawSprite(c, 'site-hand', p, x + 20, y - 8 - (up ? 2 : 0));
    }
    if (a.spin) {
      var k = Math.floor(t / 90) % 2 ? 'site-sparkle-a' : 'site-sparkle-b';
      var ang = (t - a.spin.t0) / 140;
      for (var s = 0; s < 3; s++) {
        var th = ang + s * 2.094;
        A.drawSprite(c, k, p, x + 6 + Math.round(Math.cos(th) * 20), y - 4 + Math.round(Math.sin(th) * 12));
      }
    }
  }

  function drawDesk(c, d, t, p) {
    var idx = DESKS.indexOf(d), who = null;
    for (var i = 0; i < CAST.length; i++) if (CAST[i].desk === idx && CAST[i].seated) who = CAST[i];
    A.drawSprite(c, 'desk', p, d.x, d.y);
    var mx = d.x + 34, my = d.y - 12;
    if (idx === 1 && scene.desk) {
      // stop 5: the monitor fills with work, lines scrolling up
      A.drawSprite(c, 'monitor-on', p, mx, my);
      var sh = A.PALETTES[p].shades, off = Math.floor((t - scene.desk.t0) / 160);
      for (var l = 0; l < 4; l++) {
        var n = (off + l) * 7919 % 13;
        c.fillStyle = sh[l === 3 && Math.floor(t / 300) % 2 ? 1 : 0];
        c.fillRect(mx + 3, my + 3 + l * 2, 3 + n % 8, 1);
      }
      var done = t - scene.desk.t0 > 1600;
      A.drawSprite(c, done ? 'folder-done' : 'folder-working', p, d.x + 10, d.y - 5);
      if (done && !scene.desk.thumped) { scene.desk.thumped = true; Snd.play('thump'); shake(t, 180); }
      return;
    }
    var mon = !who ? 'monitor-off' : (who.typing && Math.floor(t / 260) % 3 === 0 ? 'monitor-glow' : 'monitor-on');
    A.drawSprite(c, mon, p, mx, my);
  }

  // ---- stamp, books, boxes (scene props drawn over the world) ----------
  var stampCache = {};
  function stampSprite(p) {
    if (stampCache[p]) return stampCache[p];
    var w = 44, h = 15, cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
    var c = cnv.getContext('2d'), sh = A.PALETTES[p].shades;
    c.fillStyle = sh[0]; c.fillRect(0, 0, w, h);
    c.fillStyle = sh[3]; c.fillRect(1, 1, w - 2, h - 2);
    c.fillStyle = sh[0]; c.fillRect(2, 2, w - 4, h - 4);
    c.fillStyle = sh[3]; c.fillRect(3, 3, w - 6, h - 6);
    A.drawText(c, 'APPROVED', p, 6, 5, 0);
    stampCache[p] = cnv;
    return cnv;
  }
  var SPLAT = [[-3, 2], [-5, 9], [47, 3], [49, 11], [-2, 16], [20, -3], [36, 17], [44, -2], [-6, 5], [12, 18]];
  function drawProps(c, t, p) {
    var sh = A.PALETTES[p].shades;
    // stop 6: the folder slides under the boss door, then the stamp
    if (scene.boss && scene.boss.slideT) {
      var sx = 286 + (t - scene.boss.slideT) * 0.03;
      if (sx < DOOR.x) {
        c.save(); c.beginPath(); c.rect(0, 0, DOOR.x, 400); c.clip();
        A.drawSprite(c, 'folder-review', p, sx, 186);
        c.restore();
      }
    }
    if (scene.boss && scene.boss.stampT && t > scene.boss.stampT) {
      var e = t - scene.boss.stampT, k = Math.max(1, 3 - Math.floor(e / 50));
      var st = stampSprite(p), cx = DOOR.x + 8, cy = DOOR.y - 6;
      c.drawImage(st, Math.round(cx - st.width * k / 2), Math.round(cy - st.height * k / 2), st.width * k, st.height * k);
      if (k === 1) {
        c.fillStyle = sh[0];
        SPLAT.forEach(function (s) { c.fillRect(cx - 22 + s[0], cy - 7 + s[1], 1 + (s[0] & 1), 1 + (s[1] & 1)); });
      }
    }
    // stop 7: books fly from the desks to the shelf, the pile grows
    if (scene.brain) {
      var b = scene.brain;
      for (var n = 0; n < b.pile; n++) {
        c.fillStyle = sh[0]; c.fillRect(12 + (n % 2), 56 - n * 3, 12, 3);
        c.fillStyle = sh[n % 2 ? 2 : 1]; c.fillRect(13 + (n % 2), 57 - n * 3, 10, 1);
      }
      if (b.fly) {
        var f = Math.min(1, (t - b.fly) / 900);
        var bx = 170 + (22 - 170) * f, by = 70 + (48 - b.pile * 3 - 70) * f - Math.sin(Math.PI * f) * 34;
        A.drawSprite(c, 'site-book', p, bx, by);
        if (f >= 1) { b.fly = 0; b.pile = Math.min(9, b.pile + 1); Snd.play('book'); }
      } else if (t > b.next) { b.fly = t; b.next = t + 1500; }
    }
    // stop 8: boxes of retired beliefs, stacked in the attic
    for (var i = 0; i < boxes; i++) {
      var col = i % 4, row = Math.floor(i / 4);
      A.drawSprite(c, 'site-box', p, 8 + col * 11 + (row % 2) * 5, ATTIC_FLOOR - 8 - row * 8 - 6);
    }
  }
  var boxes = 3;

  function drawWorld(t) {
    var p = night.on ? palKey + '-night' : palKey;
    if (bgFor !== p) drawStatic(p);
    wctx.drawImage(bg, 0, 0);
    wctx.save(); wctx.translate(PAD, PAD);
    // live board: folder stacks tell queued / working / review / done
    [['folder-queued', board.queued], ['folder-working', board.working],
     ['folder-review', board.review], ['folder-done', board.done]].forEach(function (s, i) {
      for (var k = 0; k < Math.min(s[1], 3); k++) A.drawSprite(wctx, s[0], p, 31 + i * 17, 19 + k * 4);
    });
    A.drawSprite(wctx, Math.floor(t / 400) % 2 ? 'coffee-b' : 'coffee-a', p, 8, 188);
    for (var r = 0; r < Math.min(board.review, 3); r++) A.drawSprite(wctx, 'folder-review', p, 287 + r * 3, 184 - r * 2);
    // painter's order by baseline: desks, chairs, agents
    var paint = [];
    DESKS.forEach(function (d) {
      paint.push({ y: d.y + 16, f: function () { drawDesk(wctx, d, t, p); } });
      paint.push({ y: d.y + 31, f: function () { A.drawSprite(wctx, 'chair-office', p, d.x + 8, d.y + 12); } });
    });
    CAST.forEach(function (a) { paint.push({ y: a.pos.y + 16, f: function () { drawAgent(wctx, a, t, p); } }); });
    paint.sort(function (a, b) { return a.y - b.y; }).forEach(function (e) { e.f(); });
    drawProps(wctx, t, p);
    wctx.restore();
  }

  // ---- idle life ----------------------------------------------------------
  var lastInput = performance.now();
  function walkTo(a, pts, done) { a.path = pts.slice(); a.walking = true; a.seated = false; a.arrive = done || null; }
  function stepWalk(a, dt) {
    var tgt = a.path[0];
    if (!tgt) { a.walking = false; return; }
    var dx = tgt.x - a.pos.x, dy = tgt.y - a.pos.y, dist = Math.hypot(dx, dy), v = 0.045 * dt * (a.speed || 1);
    a.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'front' : 'back');
    if (dist <= v) {
      a.pos.x = tgt.x; a.pos.y = tgt.y; a.path.shift();
      if (!a.path.length) { a.walking = false; if (a.arrive) { var f = a.arrive; a.arrive = null; f(); } }
    } else { a.pos.x += dx / dist * v; a.pos.y += dy / dist * v; }
  }
  function sitDown(a) {
    var seat = seatOf(DESKS[a.desk]);
    a.pos.x = seat.x; a.pos.y = seat.y;
    a.seated = true; a.facing = 'back'; a.typing = true; a.carry = null;
  }
  function roam(a) {
    var seat = seatOf(DESKS[a.desk]);
    var toCoffee = Math.random() < 0.5;
    var spot = toCoffee ? SPOT.coffee : SPOT.board;
    a.typing = false;
    walkTo(a, [{ x: seat.x, y: AISLE_Y }, { x: spot.x, y: AISLE_Y }, spot], function () {
      a.facing = toCoffee ? 'left' : 'back';
      if (toCoffee) { a.emote = 'emote-coffee'; a.emoteUntil = performance.now() + 2600; }
      else { a.carry = 'folder-queued'; }
      setTimeout(function () {
        if (a.walking) return;
        if (!toCoffee) { a.carry = null; board.queued = Math.min(6, board.queued + 1); }
        walkTo(a, [{ x: spot.x, y: AISLE_Y }, { x: seat.x, y: AISLE_Y }, seat], function () { sitDown(a); });
      }, toCoffee ? 3000 : 1600);
    });
  }
  function life(t, dt) {
    CAST.forEach(function (a) {
      if (a.walking) { stepWalk(a, dt); return; }
      if (a.spin || a.held) return;
      if (a.seated) {
        // typing bursts: a 1px bob in rhythm, the monitor flickers
        if (t > a.typeUntil) { a.typing = !a.typing; a.typeUntil = t + (a.typing ? 3000 + Math.random() * 6000 : 900 + Math.random() * 2400); }
        a.bob = a.typing ? (Math.floor(t / 180) % 2) : 0;
        if (a.roamer && t > a.nextBeat) { a.nextBeat = t + 14000 + Math.random() * 9000; roam(a); }
        return;
      }
      a.bob = Math.floor(t / 600) % 2;
      if (a.standing && t > a.nextBeat && !a.hovered && !(a.waveUntil && t < a.waveUntil)) {
        var r = Math.random();
        if ((a.id === 'lead' || a.id === 'lib') && r < 0.4) {
          a.facing = a.id === 'lead' ? 'back' : 'left'; // pinning at the board, or shelving
          a.nextBeat = t + 1800;
          if (a.id === 'lead') {
            if (Math.random() < 0.5) { board.queued = Math.max(1, board.queued - 1); board.working = Math.min(5, board.working + 1); }
            else if (board.working > 1) { board.working--; board.review = Math.min(4, board.review + 1); }
          }
          setTimeout(function () { if (!a.spin && !a.walking) a.facing = 'front'; }, 1700);
          return;
        }
        a.facing = r < 0.65 ? 'left' : r < 0.9 ? 'right' : 'front';
        setTimeout(function () { if (!a.spin && !a.hovered && !a.walking) a.facing = 'front'; }, 800);
        a.nextBeat = t + 3400 + Math.random() * 3900;
      }
    });
    // after 10s without input, someone waves at you
    if (t - lastInput > 10000) {
      var w = focusAgent() || agent('lead');
      if (w && !w.spin && !w.walking && !w.seated) { w.facing = 'front'; w.waveUntil = t + 2400; }
      lastInput = t;
    }
  }

  // ---- the stops (the scroll storyboard, approved 2026-09-30) ------------
  // zoom: 0 shows the whole console, 1 fills the view with the screen.
  // view(t) returns the camera centre (office pixels) and how many office
  // pixels tall the screen shows. enter/leave run the stop's little scene.
  var scene = {};
  var night = { on: false, until: 0 };
  function wide(t) { return { x: OW / 2 + (REDUCED ? 0 : Math.sin(t / 9000) * 44), y: OH / 2, h: 216 }; }
  function onAgent(id) { return function () { var a = agent(id); return { x: a.home.x + 34, y: a.home.y, h: 116 }; }; }
  function besideAgent(id) {
    return function () { var a = agent(id); return { x: a.pos.x + 26, y: a.pos.y - 6, back: a.pos.x - 10 }; };
  }

  var STOPS = [
    { id: 'start', zoom: 0, view: wide },
    { id: 'office', zoom: 1, view: wide, headline: 'Your AI agents need an office.' },
    { id: 'lead', zoom: 1, view: onAgent('lead'), focus: 'lead', role: { name: 'LEAD', line: 'Splits your goals into missions.' } },
    { id: 'critic', zoom: 1, view: onAgent('critic'), focus: 'critic', role: { name: 'CRITIC', line: 'Checks the work before you do.' } },
    { id: 'agent', zoom: 1, view: onAgent('w2'), focus: 'w2', role: { name: 'AGENT', line: 'Claude, Codex, or yours. Anyone can clock in.' } },
    { id: 'desk', zoom: 1, view: function () { return { x: 194, y: 80, h: 60 }; }, headline: 'Missions, not chats.',
      enter: function (t) { scene.desk = { t0: t }; }, leave: function () { scene.desk = null; } },
    { id: 'boss', zoom: 1, view: function () { return { x: 290, y: 172, h: 100 }; },
      role: { name: 'BOSS (YOU)', line: 'You approve what matters.' },
      anchor: function () { return { x: DOOR.x + 30, y: DOOR.y - 22, back: DOOR.x - 16 }; },
      enter: bossEnter, leave: bossLeave },
    { id: 'brain', zoom: 1, view: function () { return { x: 58, y: 88, h: 116 }; }, focus: 'lib',
      role: { name: 'LIBRARIAN', line: 'Every approved mission leaves memory.' },
      enter: function (t) { scene.brain = { pile: 0, fly: 0, next: t + 300 }; }, leave: function () { scene.brain = null; } },
    { id: 'attic', zoom: 1, view: function () { return { x: 84, y: -20, h: 124 }; }, headline: 'Old beliefs retire. Nothing is lost.',
      enter: atticEnter, leave: atticLeave },
    { id: 'rules', zoom: 0, view: wide, headline: 'Your agents. Your memory. Your rules.' },
    { id: 'save', zoom: 1, view: wide, screen: 'save', enter: saveEnter, leave: saveLeave },
    { id: 'star', zoom: 0, view: wide, enter: function () { refreshStars(); } },
  ];
  STOPS.forEach(function (st) { if (!st.anchor && st.focus) st.anchor = besideAgent(st.focus); });

  // stop 4: the agent stands up from the desk to spin, then sits back down
  function standUp(a) {
    if (!a.seated) return;
    a.seated = false; a.typing = false; a.held = true;
    a.pos.y = a.home.y + 24; // a step clear of the desk and chair
  }

  // stop 6: a worker brings a folder to the boss door, it slides under,
  // the stamp comes down.
  function bossEnter(t) {
    var r = agent('w5');
    scene.boss = { t0: t };
    if (REDUCED) { stamp(); return; } // no walk in reduced motion: straight to the stamp
    r.held = true; r.typing = false; r.carry = 'folder-review';
    walkTo(r, [{ x: 262, y: 176 }], function () {
      r.facing = 'right'; r.carry = null;
      if (!scene.boss) return;
      scene.boss.slideT = performance.now();
      setTimeout(function () { if (scene.boss) stamp(); }, 520);
      setTimeout(function () {
        walkTo(r, [{ x: 254, y: 176 }, r.home], function () { r.held = false; sitDown(r); });
      }, 1500);
    });
  }
  function bossLeave() {
    scene.boss = null;
    var r = agent('w5');
    r.path = []; r.walking = false; r.held = false; sitDown(r);
  }
  function stamp() {
    var t = performance.now();
    scene.boss.stampT = t; scene.boss.slideT = 0;
    Snd.play('stamp'); shake(t, 260);
    if (canVibrate()) navigator.vibrate([12, 40, 20]);
    setTimeout(function () { if (scene.boss && shownStop === stopIndex('boss')) showRole(STOPS[stopIndex('boss')]); }, 420);
  }

  // stop 8: night falls; the librarian carries old beliefs to the attic
  function atticEnter(t) {
    night.flicker = t;
    Snd.play('lights');
    var lib = agent('lib');
    lib.held = true; lib.speed = 1.8;
    scene.attic = true;
    (function trip() {
      if (!scene.attic) return;
      lib.carry = 'site-box';
      walkTo(lib, [{ x: 20, y: AISLE_Y }, { x: LADDER_X, y: AISLE_Y }, { x: LADDER_X, y: 50 }, { x: LADDER_X, y: ATTIC_Y }, { x: 64, y: ATTIC_Y }], function () {
        if (!scene.attic) return;
        lib.carry = null; boxes = Math.min(12, boxes + 1); Snd.play('box');
        walkTo(lib, [{ x: LADDER_X, y: ATTIC_Y }, { x: LADDER_X, y: 50 }, { x: LADDER_X, y: AISLE_Y }, { x: 20, y: AISLE_Y }], function () { setTimeout(trip, 400); });
      });
    })();
  }
  function atticLeave() {
    scene.attic = false;
    night.flicker = 0;
    var lib = agent('lib');
    lib.path = []; lib.walking = false; lib.held = false; lib.carry = null; lib.speed = 1;
    lib.pos.x = lib.home.x; lib.pos.y = lib.home.y; lib.facing = 'front';
  }
  function updateNight(t) {
    var on = !!scene.attic;
    // the lights go out with a short flicker, like a tired tube
    if (on && night.flicker && t - night.flicker < 420) on = Math.floor((t - night.flicker) / 70) % 2 === 1;
    night.on = on;
  }

  // ---- screen, camera --------------------------------------------------
  var lcd = $('lcd'), lctx = lcd.getContext('2d');
  var frame = document.createElement('canvas'), fctx = frame.getContext('2d');
  var cam = { x: OW / 2, y: OH / 2, s: 2 };
  var scroll = { p: 0, lastT: 0, v: 0, maxV: 0, y: 0 };
  var shakeUntil = 0;
  function shake(t, ms) { if (!REDUCED) shakeUntil = t + ms; }

  function stopHeight() { var s = document.querySelector('.stop'); return s ? s.offsetHeight : innerHeight; }
  function stopIndex(id) { for (var i = 0; i < STOPS.length; i++) if (STOPS[i].id === id) return i; return -1; }
  function focusAgent() { var st = STOPS[Math.round(scroll.p)]; return st && st.focus ? agent(st.focus) : null; }
  function ease(f) { return f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; }
  function clampP() { return Math.max(0, Math.min(STOPS.length - 1, scroll.p)); }

  function viewFor(i, t) {
    var st = STOPS[Math.max(0, Math.min(STOPS.length - 1, i))];
    var v = st.view(t), Hd = lcd.height || 300;
    return { x: v.x, y: v.y, s: Hd / v.h };
  }
  function zoomFor() {
    var p = clampP(), i = Math.floor(p), f = p - i;
    var z0 = STOPS[i].zoom, z1 = STOPS[Math.min(STOPS.length - 1, i + 1)].zoom;
    return z0 + (z1 - z0) * ease(f);
  }

  function cameraTarget(t) {
    var p = clampP();
    var i = Math.floor(p), f = p - i;
    var v0 = viewFor(i, t), v1 = viewFor(i + 1, t);
    if (i >= STOPS.length - 1) { v1 = v0; f = 0; }
    var e = ease(f), wideS = (lcd.height || 300) / 216;
    var dip = f > 0 ? 0.55 * Math.max(0, Math.log(Math.max(v0.s, v1.s) / wideS)) : 0;
    var ls = Math.log(v0.s) + (Math.log(v1.s) - Math.log(v0.s)) * e - dip * Math.sin(Math.PI * e);
    return { x: v0.x + (v1.x - v0.x) * e, y: v0.y + (v1.y - v0.y) * e, s: Math.exp(ls), moving: f > 0.001 };
  }

  var settled = false;
  function render(t, dt) {
    var Wd = lcd.width, Hd = lcd.height;
    if (!Wd || !Hd) return;
    if (frame.width !== Wd || frame.height !== Hd) { frame.width = Wd; frame.height = Hd; }
    var tg = cameraTarget(t);
    var idle = t - scroll.lastT > 160;
    settled = idle && !tg.moving;
    if (STOPS[Math.round(clampP())].screen === 'save') { renderSave(t); return; }
    // at rest: a whole-number scale, biased to fill the screen
    if (settled) tg.s = Math.max(1, Math.round(tg.s + (tg.s < 2.5 ? 0.3 : 0)));
    var k = REDUCED ? 1 : 1 - Math.exp(-dt / 70);
    cam.x += (tg.x - cam.x) * k; cam.y += (tg.y - cam.y) * k; cam.s += (tg.s - cam.s) * k;
    var s = cam.s, crisp = settled && Math.abs(s - Math.round(s)) < 0.02;
    if (crisp) s = Math.round(s);
    var vx0 = cam.x + PAD - Wd / (2 * s), vy0 = cam.y + PAD - Hd / (2 * s);
    if (crisp) { vx0 = Math.round(vx0); vy0 = Math.round(vy0); }
    if (t < shakeUntil) { vx0 += Math.round(Math.random() * 4 - 2); vy0 += Math.round(Math.random() * 4 - 2); }

    updateNight(t);
    drawWorld(t);
    fctx.imageSmoothingEnabled = false;
    fctx.fillStyle = shades()[0]; fctx.fillRect(0, 0, Wd, Hd);
    var ix0 = Math.max(0, vx0), iy0 = Math.max(0, vy0);
    var ix1 = Math.min(WW, vx0 + Wd / s), iy1 = Math.min(WH, vy0 + Hd / s);
    if (ix1 > ix0 && iy1 > iy0) {
      fctx.drawImage(world, ix0, iy0, ix1 - ix0, iy1 - iy0, (ix0 - vx0) * s, (iy0 - vy0) * s, (ix1 - ix0) * s, (iy1 - iy0) * s);
    }
    lcdGrid(Wd, Hd, (-(vx0 % 1) * s) % s, (-(vy0 % 1) * s) % s, s);
    // slow LCD: new frames blend over the last one while things move
    lctx.globalAlpha = (REDUCED || crisp) ? 1 : 0.62;
    lctx.drawImage(frame, 0, 0);
    lctx.globalAlpha = 1;

    placeWords(vx0, vy0, s);
  }

  // ---- the title screen (stop 0, after the power-on) ---------------------
  // A 3D pixel logo that sways, a tagline, "SCROLL TO START" blinking. It
  // slides up and away as the first scroll zooms into the office.
  var TAGLINE = 'THE OFFICE FOR YOUR AI AGENTS';
  var titleCv = document.createElement('canvas'); titleCv.width = 160; titleCv.height = 144;
  var tctx = titleCv.getContext('2d');
  var logoCache = {};
  // The word drawn in the 3x5 bitmap font, scaled 4x: one canvas per shade.
  function logoLayer(p, shade) {
    var key = p + '/' + shade;
    if (logoCache[key]) return logoCache[key];
    var small = document.createElement('canvas'); small.width = 24; small.height = 5;
    A.drawText(small.getContext('2d'), 'BUREAU', p, 0, 0, shade);
    var big = document.createElement('canvas'); big.width = 96; big.height = 20;
    var b = big.getContext('2d'); b.imageSmoothingEnabled = false;
    b.drawImage(small, 0, 0, 96, 20);
    return (logoCache[key] = big);
  }
  function drawTitle(t) {
    var p = palKey, sh = A.PALETTES[p].shades, c = tctx;
    c.fillStyle = sh[3]; c.fillRect(0, 0, 160, 144);
    // a dithered sky band behind the logo
    for (var y = 18; y < 70; y++) for (var x = (y % 2); x < 160; x += 2) if (y < 26 || y > 62 || (x + y) % 4 === 0) { c.fillStyle = sh[2]; c.fillRect(x, y, 1, 1); }
    var sway = REDUCED ? 1 : Math.sin(t / 900) * 2.6;   // the extrusion leans left and right: the word turns
    var bob = REDUCED ? 0 : Math.round(Math.sin(t / 620));
    var lx = 32, ly = 30 + bob;
    var side = logoLayer(p, 0), face = logoLayer(p, 3), rim = logoLayer(p, 1);
    for (var d = 6; d >= 1; d--) c.drawImage(side, Math.round(lx + sway * d / 3), ly + d);   // depth
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (o) { c.drawImage(side, lx + o[0], ly + o[1]); }); // outline
    c.drawImage(face, lx, ly);
    c.drawImage(rim, lx, ly + 12, 96, 8, lx, ly + 12, 96, 8);                    // lower half a shade darker: a bevel
    // the shine: a diagonal light band crossing the face now and then
    var sweep = ((t / 16) % 420) - 60;
    if (sweep < 140) {
      var s = document.createElement('canvas'); s.width = 96; s.height = 20;
      var sc = s.getContext('2d');
      sc.drawImage(face, 0, 0);
      sc.globalCompositeOperation = 'source-atop';
      sc.fillStyle = '#fff';
      for (var k = 0; k < 20; k++) sc.fillRect(Math.round(sweep - lx - k * 0.6), k, 5, 1);
      c.globalAlpha = 0.55; c.drawImage(s, lx, ly); c.globalAlpha = 1;
    }
    A.drawText(c, TAGLINE, p, Math.round(80 - A.textWidth(TAGLINE) / 2), 80, 0);
    if (REDUCED || Math.floor(t / 520) % 2) A.drawText(c, 'SCROLL TO START', p, Math.round(80 - A.textWidth('SCROLL TO START') / 2), 110, 1);
    A.drawText(c, 'OPEN SOURCE', p, Math.round(80 - A.textWidth('OPEN SOURCE') / 2), 132, 1);
  }
  // Drawn over the office, lifted by the first scroll.
  function renderTitle(t) {
    var p = clampP();
    if (p >= 0.6) return;
    drawTitle(t);
    var Wd = lcd.width, Hd = lcd.height;
    var s = Math.max(1, Math.floor(Math.min(Wd / 160, Hd / 144)));
    var gw = 160 * s, gh = 144 * s;
    var lift = Math.round(Math.min(1, p / 0.6) * Hd);
    var ox = ((Wd - gw) / 2) | 0, oy = (((Hd - gh) / 2) | 0) - lift;
    lctx.imageSmoothingEnabled = false;
    lctx.fillStyle = shades()[3]; lctx.fillRect(0, -lift, Wd, Hd);
    lctx.drawImage(titleCv, ox, oy, gw, gh);
  }

  // LCD pixel grid, visible once pixels are big enough to have edges.
  function lcdGrid(Wd, Hd, ox, oy, s) {
    if (s < 3) return;
    fctx.fillStyle = 'rgba(0,0,0,' + (s >= 6 ? 0.1 : 0.07) + ')';
    var lw = Math.max(1, Math.round(s * 0.08));
    for (var gx = ox; gx < Wd; gx += s) fctx.fillRect(Math.round(gx), 0, lw, Hd);
    for (var gy = oy; gy < Hd; gy += s) fctx.fillRect(0, Math.round(gy), Wd, lw);
  }

  // Blit a small art-pixel canvas centred at an integer scale.
  function blitCentered(src, t, bgShade, ghost) {
    var Wd = lcd.width, Hd = lcd.height;
    if (frame.width !== Wd || frame.height !== Hd) { frame.width = Wd; frame.height = Hd; }
    var s = Math.max(1, Math.floor(Math.min(Wd / src.width, Hd / src.height)));
    var gw = src.width * s, gh = src.height * s;
    var ox = ((Wd - gw) / 2) | 0, oy = ((Hd - gh) / 2) | 0;
    fctx.imageSmoothingEnabled = false;
    fctx.fillStyle = shades()[bgShade]; fctx.fillRect(0, 0, Wd, Hd);
    fctx.drawImage(src, ox, oy, gw, gh);
    lcdGrid(Wd, Hd, ox % s, oy % s, s);
    lctx.globalAlpha = REDUCED ? 1 : ghost;
    lctx.drawImage(frame, 0, 0);
    lctx.globalAlpha = 1;
  }

  // The hidden cartridge draws at its own size; its background shade fills
  // the rest of the glass.
  function renderGame(t) {
    if (!lcd.width || !lcd.height) return;
    game.draw(palKey, t);
    blitCentered(game.canvas, t, 3, 0.7);
  }

  // ---- stop 10: the save screen ------------------------------------------
  // A memory card in 4 shades frames the form (real HTML over the glass);
  // one block fills per answered field.
  var saveCv = document.createElement('canvas'); saveCv.width = 160; saveCv.height = 144;
  var sctx = saveCv.getContext('2d');
  var saveForm = $('save-form'), savedEl = $('saved');
  var saveBlocks = Array.prototype.slice.call(document.querySelectorAll('#save-blocks i')), lastBlocks = -1;
  function saveProgress() {
    var f = saveForm, n = 0;
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value)) n++;
    ['use', 'role', 'interest'].forEach(function (k) { if (f.querySelector('[data-name="' + k + '"] [aria-pressed="true"]')) n++; });
    if (f.consent.checked) n++;
    return n;
  }
  function renderSave(t) {
    var p = palKey, sh = A.PALETTES[p].shades;
    sctx.fillStyle = sh[3]; sctx.fillRect(0, 0, 160, 144);
    // the memory blocks live in the form itself, so they flow with it
    var n = savedEl.hidden ? saveProgress() : 5;
    if (n !== lastBlocks) {
      lastBlocks = n;
      saveBlocks.forEach(function (b, i) { b.className = i < n ? 'on' : i === n ? 'next' : ''; });
      // SAVE only lights up once all five steps are done
      var go = saveForm.querySelector('.save-go');
      go.disabled = n < 5;
      go.textContent = n < 5 ? 'SAVE (' + n + '/5)' : 'SAVE';
    }
    blitCentered(saveCv, t, 3, 1);
  }
  // Coming back after signing up shows the saved slot, not a fresh form.
  function saveEnter() {
    var done = !!savedEl.dataset.done;
    saveForm.hidden = done; savedEl.hidden = !done;
  }
  function saveLeave() { saveForm.hidden = true; savedEl.hidden = true; }

  // toggles: one choice per group, like radio buttons
  saveForm.querySelectorAll('fieldset[data-name]').forEach(function (fs) {
    fs.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        fs.querySelectorAll('button').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        Snd.play('press');
      });
    });
  });
  saveForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = saveForm, msg = $('save-msg');
    var pick = function (k) { var b = f.querySelector('[data-name="' + k + '"] [aria-pressed="true"]'); return b ? b.getAttribute('data-v') : ''; };
    var body = { email: f.email.value.trim(), use: pick('use'), role: pick('role'), interest: pick('interest'), consent: f.consent.checked, website: f.website.value, source: location.hash || '#save' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) { msg.textContent = 'That email looks off.'; f.email.focus(); return; }
    if (!body.use || !body.role || !body.interest) { msg.textContent = 'Pick one in each row.'; return; }
    if (!body.consent) { msg.textContent = 'Tick the box so I can keep your email.'; return; }
    msg.textContent = 'SAVING...';
    Snd.play('press');
    fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'failed'); return j; }); })
      .then(function (j) { saved(j.slot); })
      .catch(function (err) { msg.textContent = err.message === 'failed' ? 'Could not save. Try again in a moment.' : err.message; });
  });
  function saved(slot) {
    Snd.play('save');
    saveForm.hidden = true;
    $('saved-slot').textContent = String(slot).padStart(3, '0');
    var card = badge(slot);
    var img = $('badge-img');
    img.src = card.toDataURL('image/png');
    card.toBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var dl = $('badge-dl'); dl.href = url; dl.download = 'bureau-visitor-' + slot + '.png';
      var sh = $('badge-share');
      var file = window.File ? new File([blob], 'bureau-visitor-' + slot + '.png', { type: 'image/png' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        sh.hidden = false;
        sh.onclick = function () { navigator.share({ files: [file], title: 'Bureau', text: 'Visitor #' + slot + ' at the Bureau.' }).catch(function () {}); };
      }
    });
    savedEl.hidden = false; savedEl.dataset.done = '1';
    // the form (and the focus in it) just went away: land on the result
    $('saved-title').focus({ preventScroll: true });
    consoleEl.classList.add('blink');
    setTimeout(function () { consoleEl.classList.remove('blink'); }, 900);
  }

  // The visitor badge: a character from the boss-drawn parts, picked by
  // slot number, on a pixel ID card. Rendered client-side, 4x.
  function badge(slot) {
    var W = 120, H = 72, S = 4, p = palKey, sh = A.PALETTES[p].shades;
    var art = document.createElement('canvas'); art.width = W; art.height = H;
    var c = art.getContext('2d');
    c.imageSmoothingEnabled = false; // the photo is the sprite at 2x: square pixels, no blur
    c.fillStyle = sh[0]; c.fillRect(0, 0, W, H);
    c.fillStyle = sh[3]; c.fillRect(2, 2, W - 4, H - 4);
    c.fillStyle = sh[0]; c.fillRect(2, 2, W - 4, 12);
    A.drawText(c, 'BUREAU  VISITOR PASS', p, 6, 5, 3);
    var heads = Object.keys(A.DELIVERED_HEADS), bodies = Object.keys(A.DELIVERED_BODIES);
    var key = A.assemble(heads[slot % heads.length], bodies[Math.floor(slot / heads.length) % bodies.length], 'front', 0);
    c.fillStyle = sh[2]; c.fillRect(8, 20, 40, 44);
    c.fillStyle = sh[0]; c.fillRect(8, 20, 40, 1); c.fillRect(8, 63, 40, 1); c.fillRect(8, 20, 1, 44); c.fillRect(47, 20, 1, 44);
    var spr = key && outlinedSprite(key, p);
    if (spr) c.drawImage(spr, 10, 24, 36, 36);
    A.drawText(c, 'VISITOR', p, 56, 24, 1);
    A.drawText(c, '#' + String(slot).padStart(3, '0'), p, 56, 32, 0);
    A.drawText(c, 'CLEARANCE', p, 56, 44, 1);
    A.drawText(c, 'WAITLIST', p, 56, 52, 0);
    for (var i = 0; i < 12; i++) { c.fillStyle = sh[i % 3 ? 0 : 1]; c.fillRect(56 + i * 4, 60, (i * 7) % 3 + 1, 5); }
    var out = document.createElement('canvas'); out.width = W * S; out.height = H * S;
    var o = out.getContext('2d'); o.imageSmoothingEnabled = false;
    o.drawImage(art, 0, 0, W * S, H * S);
    return out;
  }

  // ---- stop 11: the GitHub star ------------------------------------------
  var starEl = $('gh-star'), starCv = $('star-cv'), starCount = $('star-count'), titleEl = $('site-title'), realEl = $('real-link');
  var starSprites = null, starFast = false, starApp = false;
  // An 8-frame coin spin, rasterized from a 5-point star squashed on x.
  function makeStars() {
    var sh = shades(), frames = [];
    for (var fi = 0; fi < 8; fi++) frames.push(makeStar(sh, fi));
    return frames;
  }
  // The star art lives in star.js, shared with the inside page.
  var STAR_N = BureauStar.N;
  function makeStar(sh, fi, onLcd) { return BureauStar.make(sh, fi, onLcd); }
  function drawStar(t) {
    if (starEl.hidden) return;
    if (!starSprites) starSprites = makeStars();
    var sc = starCv.getContext('2d');
    sc.clearRect(0, 0, STAR_N, STAR_N);
    sc.drawImage(starSprites[Math.floor(t / (starFast ? 90 : 190)) % 8], 0, 0); // a slow coin turn, quicker on hover
  }
  // The star is on show from the first frame, beside the console. When the
  // console grows over it (zoomed stops, any window size), it fades away
  // rather than sit on the device. It stays through BUG HUNT too.
  function updateStar() {
    if (starEl.hidden) starEl.hidden = false;
    fadeIfCovered(starEl);
  }
  // Anything beside the console (the star, the headline) fades away once
  // the console grows over it, and comes back when it shrinks.
  var consoleBox = null;
  function fadeIfCovered(el) {
    var s = el.getBoundingClientRect(), c = consoleBox || consoleEl.getBoundingClientRect(), m = 12;
    var overlap = s.right + m > c.left && s.left - m < c.right && s.bottom + m > c.top && s.top - m < c.bottom;
    el.classList.toggle('away', overlap);
  }
  function refreshStars() {
    fetch('/api/stars').then(function (r) { return r.json(); }).then(function (j) {
      if (typeof j.count === 'number') starCount.textContent = j.count;
      starApp = !!j.starApp;
    }).catch(function () {});
  }
  starEl.addEventListener('pointerenter', function () { starFast = true; });
  starEl.addEventListener('pointerleave', function () { starFast = false; });
  function starBurst() {
    starEl.classList.remove('collected'); void starEl.offsetWidth; starEl.classList.add('collected');
    Snd.play('star');
  }
  // Level 2: star without leaving, through a GitHub App that can only
  // star. Level 1 fallback: open the repo, one more click there.
  function starClick() {
    if (!starApp) { window.open(REPO, '_blank', 'noopener'); starBurst(); return; }
    var w = window.open('/api/github/login', 'bureau-star', 'width=520,height=680');
    if (!w) { window.open(REPO, '_blank', 'noopener'); starBurst(); }
  }
  $('star-link').addEventListener('click', function (e) { e.preventDefault(); starClick(); });
  addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.bureauStar === undefined) return;
    var r = e.data.bureauStar;
    if (typeof e.data.count === 'number') starCount.textContent = e.data.count; // the server's true count, never a local +1
    if (r === 'ok' || r === 'already') {
      starBurst();
      if (r === 'already') flashStarLabel('Already starred. Thank you.');
    } else window.open(REPO, '_blank', 'noopener');
  });
  var starLabel = starEl.querySelector('.star-label'), labelTimer = null;
  function flashStarLabel(text) {
    var was = 'Star us on GitHub.';
    starLabel.textContent = text;
    clearTimeout(labelTimer);
    labelTimer = setTimeout(function () { starLabel.textContent = was; }, 2600);
  }

  // ---- words over the screen -------------------------------------------
  var roleEl = $('role'), headEl = $('headline'), screenEl = $('screen');
  var shownStop = null, roleStop = null, typeTimer = null;
  function typeHeadline(text) {
    clearInterval(typeTimer);
    headEl.textContent = '';
    if (!text) { headEl.classList.remove('show'); return; }
    headEl.classList.add('show');
    if (REDUCED) { headEl.textContent = text; return; }
    var i = 0, caret = document.createElement('span');
    caret.className = 'caret'; caret.textContent = '_';
    typeTimer = setInterval(function () {
      i++;
      headEl.textContent = text.slice(0, i);
      headEl.appendChild(caret);
      if (i % 3 === 0) Snd.play('type');
      if (i >= text.length) clearInterval(typeTimer);
    }, 34);
  }
  function showRole(st) {
    $('role-name').textContent = st.role.name;
    $('role-line').textContent = st.role.line;
    roleStop = st;
    roleEl.hidden = false;
    roleEl.classList.remove('pop'); void roleEl.offsetWidth; roleEl.classList.add('pop');
    Snd.play('pop');
  }
  function hideWords() {
    roleEl.hidden = true; roleStop = null;
    typeHeadline('');
  }
  function placeWords(vx0, vy0, s) {
    if (roleEl.hidden || !roleStop || !roleStop.anchor) return;
    var an = roleStop.anchor(), dpr = lcd.width / screenEl.clientWidth;
    var sw = screenEl.clientWidth, sh = screenEl.clientHeight;
    var cw = roleEl.offsetWidth, ch = roleEl.offsetHeight;
    var x = (an.x + PAD - vx0) * s / dpr, y = (an.y + PAD - vy0) * s / dpr - ch / 2;
    if (x + cw > sw * 0.97) x = (an.back + PAD - vx0) * s / dpr - cw;
    x = Math.max(sw * 0.03, Math.min(sw * 0.97 - cw, x));
    y = Math.max(sh * 0.04, Math.min(sh * 0.96 - ch, y));
    roleEl.style.left = Math.round(x) + 'px';
    roleEl.style.top = Math.round(y) + 'px';
  }

  var entered = null;
  function arrive(i, t) {
    if (shownStop === i) return;
    leaveScene();
    shownStop = i;
    var st = STOPS[i];
    try { history.replaceState(null, '', '#' + st.id); } catch (e) {}
    hideWords();
    if (st.enter) { st.enter(t); entered = st; }
    if (st.headline) typeHeadline(st.headline);
    if (st.focus) spinThenCard(st, t);
  }
  function leaveScene() {
    if (entered && entered.leave) entered.leave();
    entered = null;
  }
  function spinThenCard(st, t) {
    var a = agent(st.focus);
    if (a.seated) standUp(a);
    var after = function () {
      if (shownStop === STOPS.indexOf(st)) showRole(st);
      if (a.desk != null) setTimeout(function () { if (!a.spin) { a.held = false; sitDown(a); } }, 1800);
    };
    if (REDUCED) { a.facing = 'front'; after(); return; }
    var turns = 1 + Math.min(2, Math.floor(scroll.maxV / 2.2));
    a.spin = { t0: t, turns: turns, dur: 420 * turns };
    a.onSpun = after;
    roleEl.hidden = true;
    Snd.play('spin');
  }

  // ---- console layout: whole device, or zoomed so the screen fills ----
  var consoleEl = $('console'), rackEl = $('rack');
  var tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  var lastLayout = '';
  function layout(zoomT) {
    var vv = window.visualViewport;
    var vw = document.documentElement.clientWidth || innerWidth;
    var vh = vv ? vv.height : innerHeight, wideRoom = vw > 900;
    var availW = wideRoom ? vw - 440 : vw;
    // leaves a band above for the headline, below for the real-thing link
    // (on narrow screens, also for the star row under it)
    var uWhole = Math.min(vh * (wideRoom ? 0.78 : 0.62) / 156, availW * 0.92 / 92);
    var uZoom = Math.min(vw * 0.94 / 58, vh * 0.8 / 52.2);
    var z = REDUCED ? Math.round(zoomT) : zoomT;
    var u = uWhole + (uZoom - uWhole) * z;
    var wholeL = vw / 2 - 45 * uWhole, wholeT = vh / 2 - 74 * uWhole + 1 * uWhole;
    if (!wideRoom) wholeT = Math.min(wholeT, vh * 0.46 - 70 * uWhole); // room below for the star
    var zoomL = vw / 2 - 45 * uZoom, zoomT2 = vh * 0.47 - 42.1 * uZoom;
    var L = wholeL + (zoomL - wholeL) * z, T = wholeT + (zoomT2 - wholeT) * z;
    var sig = u.toFixed(3) + '|' + L.toFixed(1) + '|' + T.toFixed(1) + '|' + tilt.x.toFixed(2) + '|' + tilt.y.toFixed(2);
    if (sig === lastLayout) return;
    lastLayout = sig;
    consoleEl.style.setProperty('--u', u + 'px');
    consoleEl.style.transform = 'translate3d(' + L + 'px,' + T + 'px,0) rotateX(' + tilt.x + 'deg) rotateY(' + tilt.y + 'deg)';
    consoleEl.style.setProperty('--glare-angle', (125 + tilt.y * 4) + 'deg');
    rackEl.classList.toggle('faded', z > 0.2);
    // the LCD's backing store tracks its on-screen device pixels
    var dpr = window.devicePixelRatio || 1;
    var sw = 58 * u, sh = 52.2 * u;
    var bw = Math.round(sw * dpr), bh = Math.round(sh * dpr);
    if (lcd.width !== bw || lcd.height !== bh) { lcd.width = bw; lcd.height = bh; lctx.imageSmoothingEnabled = false; }
    screenEl.style.setProperty('--screen-w', sw + 'px');
    screenEl.style.setProperty('--screen-h', sh + 'px');
    screenEl.style.setProperty('--px', (cam.s / dpr) + 'px');
  }

  // ---- scroll ------------------------------------------------------------
  function onScroll() {
    var now = performance.now(), y = scrollY, h = stopHeight();
    var dt = Math.max(1, now - scroll.lastT);
    if (zoomedOut && mode === 'tour' && Math.abs(y - scroll.y) > 4) zoomedOut = false; // scrolling zooms back in
    scroll.v = Math.abs(y - scroll.y) / dt; // px per ms
    scroll.maxV = Math.max(scroll.maxV * 0.9, scroll.v);
    scroll.y = y; scroll.lastT = now;
    scroll.p = y / h;
    if (shownStop !== null && Math.abs(scroll.p - shownStop) > 0.35) { shownStop = null; hideWords(); leaveScene(); }
    lastInput = now;
  }
  addEventListener('scroll', onScroll, { passive: true });

  function current() { return Math.max(0, Math.min(STOPS.length - 1, Math.round(scroll.p))); }
  function goTo(i) {
    i = Math.max(0, Math.min(STOPS.length - 1, i));
    scroll.maxV = 1.2;
    scrollTo({ top: i * stopHeight(), behavior: REDUCED ? 'auto' : 'smooth' });
  }

  // ---- input: buttons, keys, gamepad ----------------------------------
  // Browsers refuse vibration until the visitor has touched the page, and
  // log a warning each time; ask only once it is allowed.
  function canVibrate() { return !!navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive); }
  function vibrate() { if (canVibrate()) navigator.vibrate(8); }
  var dpadEl = document.querySelector('.dpad');
  function rock(key) {
    dpadEl.className = 'dpad tilt-' + key;
    setTimeout(function () { dpadEl.className = 'dpad'; }, 120);
  }
  function press(key) {
    lastInput = performance.now();
    Snd.unlock();
    vibrate();
    if (mode === 'swap' || !powered) return;
    if (cheat(key)) return;
    if (mode === 'game') {
      if (/^(up|down|left|right)$/.test(key)) rock(key); else flash(key);
      if (key === 'b') exitGame();
      else if (key === 'select') cyclePalette();
      else game.input(key);
      return;
    }
    if (isProgram()) {
      // SAVE and CODE: START or B ejects back to the tour; CODE's menu
      // moves with up and down, A picks.
      if (/^(up|down|left|right)$/.test(key)) rock(key); else flash(key);
      Snd.play('press');
      if (key === 'start' || key === 'b') backToTour(1);
      else if (key === 'select') cyclePalette();
      else if (mode === 'code' && (key === 'up' || key === 'down')) selectCode(codeSel + (key === 'down' ? 1 : -1));
      else if (mode === 'code' && key === 'a') codeAct(codeMenu.querySelectorAll('button')[codeSel].getAttribute('data-act'));
      return;
    }
    if (/^(up|down|left|right)$/.test(key)) {
      rock(key);
      Snd.play('press');
      goTo(current() + (key === 'down' || key === 'right' ? 1 : -1));
      return;
    }
    flash(key);
    if (key === 'a') {
      var st = STOPS[current()], a = focusAgent();
      if (st.id === 'start') { Snd.play('select'); goTo(1); } // the title screen: A starts, like on a real cartridge
      else if (st.id === 'boss' && scene.boss) stamp();
      else if (a && !a.spin) spinThenCard(st, performance.now());
      else if (!a) { var l = agent('lead'); l.facing = 'front'; l.waveUntil = performance.now() + 2400; Snd.play('press'); }
    } else if (key === 'b') { Snd.play('back'); goTo(current() - 1); }
    else if (key === 'select') cyclePalette();
    else if (key === 'start') swapCartridge(1);
  }
  function flash(key) {
    var el = document.querySelector('[data-key="' + key + '"]');
    if (!el) return;
    el.classList.add('pressed');
    setTimeout(function () { el.classList.remove('pressed'); }, 110);
  }
  document.querySelectorAll('[data-key]').forEach(function (el) {
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); press(el.getAttribute('data-key')); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(el.getAttribute('data-key')); } });
  });
  addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (!$('plain').hidden) return; // the plain view is a dialog: the console sleeps behind it
    if (booting) { finishBoot(); e.preventDefault(); return; }
    var map = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right', PageDown: 'down', PageUp: 'up',
                z: 'a', Z: 'a', x: 'b', X: 'b', a: 'a', A: 'a', b: 'b', B: 'b', Enter: 'start', Shift: 'select' };
    var k = map[e.key];
    if (!k) return;
    if (e.target && /^(BUTTON|A)$/.test(e.target.tagName) && (k === 'start' || e.target.closest('form'))) return; // buttons and links keep their own keys
    e.preventDefault();
    press(k);
  });
  var padPrev = {};
  function pollPad() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var gp = pads && pads[0];
    if (!gp) return;
    var map = { 0: 'a', 1: 'b', 8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
    Object.keys(map).forEach(function (b) {
      var down = gp.buttons[b] && gp.buttons[b].pressed;
      if (down && !padPrev[b]) press(map[b]);
      padPrev[b] = down;
    });
  }

  // hover: a standing agent turns to face the pointer
  screenEl.addEventListener('pointermove', function (e) {
    lastInput = performance.now();
    if (mode !== 'tour') return;
    var r = screenEl.getBoundingClientRect(), dpr = lcd.width / r.width;
    var s = cam.s, Wd = lcd.width, Hd = lcd.height;
    var wx = cam.x - Wd / (2 * s) + (e.clientX - r.left) * dpr / s;
    var wy = cam.y - Hd / (2 * s) + (e.clientY - r.top) * dpr / s;
    CAST.forEach(function (a) {
      if (!a.standing || a.spin || a.walking || a.held) return;
      var dx = wx - (a.pos.x + 8), near = Math.abs(dx) < 70 && Math.abs(wy - a.pos.y) < 50;
      a.hovered = near;
      if (near) a.facing = Math.abs(dx) < 14 ? 'front' : dx > 0 ? 'right' : 'left';
    });
  });
  screenEl.addEventListener('pointerleave', function () { CAST.forEach(function (a) { if (a.hovered) { a.hovered = false; if (!a.spin) a.facing = 'front'; } }); });

  // desktop tilt: the device follows the pointer a little
  if (FINE_POINTER && !REDUCED) {
    addEventListener('pointermove', function (e) {
      tilt.ty = ((e.clientX / innerWidth) - 0.5) * 7;
      tilt.tx = -((e.clientY / innerHeight) - 0.5) * 5;
    });
  }

  // sound wheel
  var wheel = $('wheel');
  function syncWheel() { wheel.setAttribute('aria-checked', Snd.enabled ? 'true' : 'false'); }
  wheel.addEventListener('click', function () { Snd.setEnabled(!Snd.enabled); syncWheel(); Snd.play('select'); });
  syncWheel();
  addEventListener('pointerdown', function () { Snd.unlock(); lastInput = performance.now(); }, { passive: true });

  // ---- cartridges --------------------------------------------------------
  // Printed labels, in full colour (not the screen's 4 shades): each has
  // its own 4-colour palette, small pixel art, and a title band.
  var LABELS = {
    tour:    { title: 'BUREAU',   shades: ['#1f2d4a', '#3d7a8c', '#e7a93b', '#f6ecd4'] },
    save:    { title: 'SAVE',     shades: ['#3a1c24', '#b53d2e', '#f09a4a', '#f8edd6'] },
    code:    { title: 'CODE',     shades: ['#1e1633', '#5b3ea6', '#f2c94c', '#f1ebf7'] },
    bughunt: { title: 'BUG HUNT', shades: ['#10251a', '#2e7d4f', '#9fd356', '#eef7d9'] },
  };
  Object.keys(LABELS).forEach(function (k) { A.PALETTES['label-' + k] = { label: k, shades: LABELS[k].shades }; });
  A.SPRITES['site-bug'] = ['.0....0.', '..0000..', '.031130.', '01111110', '.011110.', '01111110', '.011110.', '0.0..0.0'];
  function drawLabelArt(kind, cv) {
    var c = cv.getContext('2d'), p = 'label-' + kind, sh = LABELS[kind].shades;
    c.imageSmoothingEnabled = false;
    var box = function (x, y, w, h, i) { c.fillStyle = sh[i]; c.fillRect(x, y, w, h); };
    if (kind === 'tour') {
      // an agent at work, window behind, a folder on the desk
      box(0, 0, 48, 30, 3); box(0, 0, 48, 11, 1); box(0, 11, 48, 1, 0);
      A.drawSprite(c, 'window-night', p, 29, -4);
      var key = A.assemble('h2', 'b1', 'front', 0);
      if (key) c.drawImage(A.sprite(key, p), 5, 12);
      A.drawSprite(c, 'monitor-on', p, 24, 13);
      box(20, 26, 26, 2, 0); box(20, 25, 26, 1, 2);
      A.drawSprite(c, 'folder-working', p, 38, 18);
    } else if (kind === 'save') {
      // a memory card, its blocks filling
      box(0, 0, 48, 30, 3);
      box(7, 3, 20, 24, 0); box(8, 4, 18, 22, 1); box(11, 6, 12, 8, 3);
      for (var l = 0; l < 3; l++) box(12, 7 + l * 2, 6 + (l * 3) % 5, 1, 0);
      box(10, 18, 14, 6, 0); box(11, 19, 3, 4, 2);
      for (var b = 0; b < 4; b++) { box(31, 4 + b * 6, 12, 5, 0); box(32, 5 + b * 6, 10, 3, b < 3 ? 2 : 3); }
    } else if (kind === 'code') {
      // the star and a </>, on night purple
      box(0, 0, 48, 30, 1);
      // the star, big and crisp on the left; </> on the right
      c.drawImage(makeStar(sh, 0), 2, 6); // 1:1, so every pixel stays square
      c.save(); c.scale(2, 2); A.drawText(c, '</>', p, 13, 5, 2); c.restore();
    } else if (kind === 'bughunt') {
      // a bug in the maze, a coffee cup
      box(0, 0, 48, 30, 3);
      box(2, 2, 44, 2, 1); box(2, 26, 44, 2, 1); box(2, 2, 2, 26, 1); box(44, 2, 2, 26, 1);
      box(12, 9, 10, 2, 1); box(28, 17, 10, 2, 1); box(22, 9, 2, 10, 1);
      c.save(); c.scale(2, 2); A.drawSprite(c, 'site-bug', p, 14, 3); c.restore();
      A.drawSprite(c, 'emote-coffee', p, 7, 14);
    }
  }
  function paintLabel(el, kind) {
    var L = LABELS[kind];
    el.dataset.label = kind;
    el.style.setProperty('--lb', L.shades[3]);
    el.style.setProperty('--lband', L.shades[0]);
    el.style.setProperty('--lt', L.shades[3]);
    drawLabelArt(kind, el.querySelector('canvas'));
  }
  function paintAllLabels() {
    document.querySelectorAll('.cartridge[data-label]').forEach(function (el) { paintLabel(el, el.dataset.label); });
  }

  var cartEl = $('cart');
  function setCart(kind) {
    paintLabel(cartEl, kind);
    cartEl.querySelector('.label b').textContent = LABELS[kind].title;
  }
  // The new cartridge simply drops into the slot (no ejecting the old one):
  // it appears above the console with its label, slides in, clacks, power on.
  function insertCart(kind, done) {
    cartLoaded = true;
    if (REDUCED) { setCart(kind); done(); return; }
    Snd.play('whoosh');
    consoleEl.classList.remove('on');
    // between cartridges the screen is off, like the real thing: no title,
    // no stale program, just the unpowered glass until the new one clacks in
    bootEl.hidden = false; bootEl.className = 'boot off';
    var finish = done;
    done = function () { if (!booting) bootEl.hidden = true; finish(); };
    setCart(kind);
    cartEl.style.transition = 'none';
    cartEl.classList.add('out');
    void cartEl.offsetWidth; // place it above the slot without animating there
    cartEl.style.transition = '';
    requestAnimationFrame(function () {
      setTimeout(function () {
        cartEl.classList.remove('out');
        setTimeout(function () { Snd.play('clack'); consoleEl.classList.add('on'); done(); }, 440);
      }, 180);
    });
  }
  function swapCartridge(stopIndex) { insertCart('tour', function () { goTo(stopIndex); }); }

  // The console powers on empty, on its own title screen. The TOUR
  // cartridge drops in the first time you scroll away from the title (or
  // click it in the rack); the tour carries on while it slots.
  var cartLoaded = false;
  function dropTourCart() {
    cartLoaded = true;
    if (REDUCED) { setCart('tour'); return; }
    setCart('tour');
    cartEl.style.transition = 'none';
    cartEl.classList.add('out');
    void cartEl.offsetWidth;
    cartEl.style.transition = '';
    Snd.play('whoosh');
    requestAnimationFrame(function () {
      setTimeout(function () { cartEl.classList.remove('out'); setTimeout(function () { Snd.play('clack'); }, 440); }, 60);
    });
  }

  // ---- three cartridges, three programs ----------------------------------
  // TOUR plays the scroll story. SAVE and CODE are programs of their own:
  // the console zooms on the screen, the page stops scrolling, and START
  // (or the TOUR cartridge) ejects back to the tour.
  var codeMenu = $('code-menu'), codeSel = 0;
  function isProgram() { return mode === 'save' || mode === 'code'; }
  function leaveTourScreen() {
    hideWords(); leaveScene(); shownStop = null;
    document.documentElement.style.overflow = 'hidden';
  }
  function runProgram(kind) {
    if (mode === kind) { zoomedOut = false; return; } // the cartridge already in: just zoom back in
    closePrograms();
    leaveTourScreen();
    mode = 'swap'; zoomedOut = false;
    insertCart(kind, function () {
      mode = kind;
      if (kind === 'save') saveEnter();
      if (kind === 'code') { codeMenu.hidden = false; selectCode(0); refreshStars(); }
    });
  }
  function closePrograms() { saveLeave(); codeMenu.hidden = true; }
  function backToTour(stop) {
    mode = 'swap'; zoomedOut = false;
    closePrograms();
    insertCart('tour', function () {
      mode = 'tour';
      document.documentElement.style.overflow = '';
      shownStop = null;
      if (stop != null) goTo(stop);
    });
  }
  function selectCode(i) {
    codeSel = (i + 2) % 2;
    codeMenu.querySelectorAll('button').forEach(function (b, k) { b.classList.toggle('sel', k === codeSel); });
  }
  function codeAct(act) {
    Snd.play('select');
    if (act === 'star') starClick();
    else window.open(REPO, '_blank', 'noopener');
  }
  codeMenu.querySelectorAll('button').forEach(function (b, k) {
    b.addEventListener('click', function () { selectCode(k); codeAct(b.getAttribute('data-act')); });
    b.addEventListener('pointerenter', function () { selectCode(k); });
  });

  // The CODE screen: the big star spinning, the live count, and the menu
  // (real buttons, laid over the glass).
  var codeCv = document.createElement('canvas'); codeCv.width = 160; codeCv.height = 144;
  var cctx = codeCv.getContext('2d');
  function renderCode(t) {
    var p = palKey, sh = A.PALETTES[p].shades;
    cctx.fillStyle = sh[3]; cctx.fillRect(0, 0, 160, 144);
    A.drawText(cctx, 'BUREAU ON GITHUB', p, 48, 6, 1);
    cctx.fillStyle = sh[1]; for (var x = 4; x < 156; x += 3) cctx.fillRect(x, 14, 1, 1);
    var star = makeStar(sh, Math.floor(t / 190) % 8, true);
    var bob = Math.round(Math.sin(t / 380) * 2);
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(star, 52, 18 + bob, 57, 57); // 3x
    var n = starCount.textContent, label = n + (n === '1' ? ' STAR' : ' STARS');
    A.drawText(cctx, label, p, Math.round(80 - A.textWidth(label) / 2), 80, 0);
    blitCentered(codeCv, t, 3, 0.8);
  }

  document.querySelectorAll('.cart-pick').forEach(function (b) {
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-jump');
      if (mode === 'swap') return;
      // Console off: a cartridge turns it straight on; the cartridge going
      // in is the power-on, no boot screen to wait through.
      if (!powered) powerOnForCart();
      if (id === 'bughunt') { if (mode !== 'game') enterGame(); else zoomedOut = false; return; }
      if (id === 'save' || id === 'code' || id === 'star') { runProgram(id === 'star' ? 'code' : id); return; }
      // TOUR starts like the first scroll does: the console zooms into the office
      if (mode === 'tour') swapCartridge(1); else backToTour(1);
    });
  });

  // ---- zooming out: Escape, the X, or a click outside the screen ----------
  // Shows the whole console where you are; the screen, a scroll or a new
  // cartridge zooms back in.
  var zoomedOut = false, unzoomEl = $('unzoom');
  function setZoomedOut(on) { zoomedOut = on; }
  unzoomEl.addEventListener('click', function () { setZoomedOut(true); Snd.play('back'); });
  // Programs lock the page scroll, so there is no scroll event to catch:
  // the scroll gesture itself (wheel, swipe) zooms back in.
  function gestureZoomIn() { if (zoomedOut && mode !== 'tour' && mode !== 'swap') setZoomedOut(false); }
  addEventListener('wheel', gestureZoomIn, { passive: true });
  addEventListener('touchmove', gestureZoomIn, { passive: true });
  addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && zoomShown > 0.5 && !zoomedOut) { setZoomedOut(true); Snd.play('back'); }
  });
  $('room').addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('#screen')) { if (zoomedOut && mode !== 'game') setZoomedOut(false); return; }
    if (t.closest('button, a, input, label, .cart-pick, #gh-star, #unzoom')) return;
    if (zoomShown > 0.5 && !zoomedOut) { setZoomedOut(true); Snd.play('back'); }
  });
  // BUG HUNT stays in the rack for good once the code has been entered.
  var bugPick = document.querySelector('.cart-pick[data-jump="bughunt"]');
  function unlockBugHunt() { store('bureau_bughunt_unlocked', '1'); bugPick.hidden = false; }
  if (store('bureau_bughunt_unlocked') === '1') bugPick.hidden = false;

  // ---- the hidden cartridge: up up down down left right left right B A START
  var mode = 'tour', game = null;
  // The code shares the D-pad with navigation. Once "up up" is in, the
  // rest of the sequence is swallowed (button feedback, no scrolling), as
  // long as it comes quickly; a pause hands the keys back to the tour.
  var CODE = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a', 'start'], codeAt = 0, codeT = 0;
  function cheat(key) {
    if (mode === 'game') return false;
    var now = performance.now();
    if (now - codeT > 1100) codeAt = 0;
    codeT = now;
    if (key === CODE[codeAt]) codeAt++;
    else if (key === 'up' && codeAt >= 2) codeAt = 2; // up up up still counts
    else codeAt = key === CODE[0] ? 1 : 0;
    if (codeAt === CODE.length) { codeAt = 0; enterGame(); return true; }
    if (codeAt >= 2) {
      if (/^(up|down|left|right)$/.test(key)) rock(key); else flash(key);
      Snd.play('press');
      return true;
    }
    return false;
  }
  function enterGame() {
    if (!game) game = window.BugHunt.create(A, Snd);
    closePrograms(); leaveTourScreen();
    mode = 'swap'; zoomedOut = false;
    unlockBugHunt();
    document.documentElement.style.overflow = 'hidden';
    insertCart('bughunt', function () { mode = 'game'; game.start(); });
  }
  function exitGame() { backToTour(); }
  // swipes on the screen steer the agent on touch devices
  var swipe = null;
  screenEl.addEventListener('pointerdown', function (e) { if (mode === 'game') swipe = { x: e.clientX, y: e.clientY }; });
  screenEl.addEventListener('pointerup', function (e) {
    if (mode !== 'game' || !swipe) return;
    var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) { game.input('a'); return; }
    press(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });

  // ---- plain view ------------------------------------------------------
  // A modal dialog: what is behind it goes inert while it is open, Escape
  // closes it, and focus goes back to the link that opened it.
  var plainBehind = ['room', 'track', 'plain-link'].map($);
  function setPlain(open) {
    $('plain').hidden = !open;
    plainBehind.forEach(function (el) { el.inert = open; });
  }
  $('plain-link').addEventListener('click', function (e) { e.preventDefault(); setPlain(true); $('plain-close').focus(); });
  $('plain-close').addEventListener('click', function () { setPlain(false); $('plain-link').focus(); });
  // capture phase, so it runs before the console's own Escape (zoom out)
  addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('plain').hidden) { e.preventDefault(); e.stopImmediatePropagation(); setPlain(false); $('plain-link').focus(); }
  }, true);
  $('plain-save').addEventListener('click', function (e) { e.preventDefault(); setPlain(false); goTo(stopIndex('save')); });

  // ---- power-on (every load, skippable) ---------------------------------
  var bootEl = $('boot'), booting = false, bootTimers = [];
  function later(ms, f) { bootTimers.push(setTimeout(f, ms)); }
  function finishBoot() {
    if (!booting) return;
    booting = false;
    bootTimers.forEach(clearTimeout);
    bootEl.hidden = true;
    cartEl.classList.remove('out');
    consoleEl.classList.add('on');
    shownStop = null;
  }
  // fromSwitch: the power switch was flipped on, so the cartridge is
  // already in; only the screen comes up.
  function boot(fromSwitch) {
    // Every load powers on (boss call, 2026-09-30); any key or tap skips it.
    if (REDUCED || (!fromSwitch && params.has('noboot'))) { consoleEl.classList.add('on'); bootEl.hidden = true; return; }
    booting = true;
    bootEl.hidden = false; bootEl.className = 'boot off';
    // No cartridge on power-on: the console boots to its own title screen,
    // and the TOUR cartridge only goes in on the first scroll or click.
    var lead = fromSwitch ? 0 : 450;
    later(lead, function () { Snd.play('clack'); consoleEl.classList.add('on'); });
    later(lead + 300, function () { bootEl.className = 'boot run'; });
    later(lead + 1600, function () { Snd.play('boot'); });
    later(lead + 2350, function () { bootEl.className = 'boot run fade'; });
    later(lead + 2700, finishBoot);
    addEventListener('pointerdown', function skip(e) {
      removeEventListener('pointerdown', skip);
      if (booting && !(e.target && e.target.closest && e.target.closest('#power'))) finishBoot();
    });
  }

  // ---- the power switch on the top edge ---------------------------------
  // Off: the screen goes to the grey-green of an unpowered LCD, the light
  // goes out, nothing responds. On: the power-on plays again.
  var powered = true, powerEl = $('power');
  function setPower(on) {
    if (on === powered) return;
    powered = on;
    powerEl.setAttribute('aria-checked', on ? 'true' : 'false');
    consoleEl.classList.toggle('powered', on);
    Snd.unlock(); Snd.play('clack');
    if (!on) {
      booting = false; bootTimers.forEach(clearTimeout);
      hideWords(); leaveScene(); shownStop = null;
      consoleEl.classList.remove('on');
      // the old picture-tube goodbye, then the unpowered screen
      bootEl.hidden = true;
      if (REDUCED) { bootEl.hidden = false; bootEl.className = 'boot off'; return; }
      lcd.classList.remove('poweroff'); void lcd.offsetWidth; lcd.classList.add('poweroff');
      setTimeout(function () {
        if (powered) return;
        lcd.classList.remove('poweroff');
        bootEl.hidden = false; bootEl.className = 'boot off';
      }, 520);
    } else {
      lcd.classList.remove('poweroff');
      if (mode === 'game') game.start(); // like the real thing: power cycling restarts the cartridge
      boot(true);
    }
  }
  powerEl.addEventListener('click', function () { setPower(!powered); });
  function powerOnForCart() {
    powered = true;
    powerEl.setAttribute('aria-checked', 'true');
    consoleEl.classList.add('powered');
    booting = false; bootTimers.forEach(clearTimeout);
    lcd.classList.remove('poweroff');
    bootEl.hidden = true;
  }

  // ---- main loop -------------------------------------------------------
  var lastT = performance.now(), zoomShown = 0;
  function tick(t) {
    var dt = Math.min(50, t - lastT); lastT = t;
    pollPad();
    tilt.x += (tilt.tx - tilt.x) * 0.08; tilt.y += (tilt.ty - tilt.y) * 0.08;
    // In the game on touch, the whole console shows so the D-pad is under
    // your thumb; with a keyboard the screen fills the view instead.
    // SAVE and CODE fill the view with the screen. Zoomed out (Escape, X,
    // a click outside) shows the whole console wherever you are.
    // During a swap the whole console shows, so the cartridge and its label
    // are seen going in; the program zooms in once it is seated.
    var zoomTarget = mode === 'tour' ? zoomFor() : mode === 'swap' ? 0 : isProgram() ? 1 : (FINE_POINTER ? 1 : 0);
    if (zoomedOut) zoomTarget = 0;
    zoomShown = REDUCED || mode === 'tour' && !zoomedOut && Math.abs(zoomTarget - zoomShown) < 0.02
      ? zoomTarget : zoomShown + (zoomTarget - zoomShown) * Math.min(1, dt / 140);
    layout(zoomShown);
    consoleBox = consoleEl.getBoundingClientRect();
    updateStar();
    fadeIfCovered(titleEl);
    fadeIfCovered(realEl);
    consoleBox = null;
    var showX = zoomShown > 0.5 && !zoomedOut && powered;
    if (unzoomEl.hidden === showX) unzoomEl.hidden = !showX;
    if (!powered) { requestAnimationFrame(tick); return; } // switched off: the off screen covers the glass
    if (mode === 'game') { game.update(dt); renderGame(t); drawStar(t); requestAnimationFrame(tick); return; }
    if (mode === 'code') { renderCode(t); drawStar(t); requestAnimationFrame(tick); return; }
    if (mode === 'save') { renderSave(t); drawStar(t); requestAnimationFrame(tick); return; }
    if (!REDUCED) life(t, dt);
    render(t, dt);
    if (mode === 'tour') renderTitle(t); // never during a swap
    drawStar(t);
    if (!booting && mode === 'tour') {
      if (!cartLoaded && clampP() > 0.04) dropTourCart(); // the first scroll slots the TOUR cartridge
      var n = Math.round(clampP());
      if (settled && Math.abs(scroll.p - n) < 0.02) arrive(n, t);
      // Resting between two stops (a browser that ignores snapping, or
      // momentum that stopped short): glide to the nearest one, once.
      else if (t - scroll.lastT > 350 && Math.abs(scroll.p - n) >= 0.02 && scroll.nudged !== scroll.lastT) {
        scroll.nudged = scroll.lastT;
        scrollTo({ top: n * stopHeight(), behavior: REDUCED ? 'auto' : 'smooth' });
      }
    }
    requestAnimationFrame(tick);
  }

  // ---- start ------------------------------------------------------------
  applyPalette();
  paintAllLabels();
  consoleEl.classList.add('powered');
  if (document.fonts && document.fonts.load) {
    document.fonts.load('8px OfficePixel').then(function () { A.clearTtfCache(); bgFor = null; }).catch(function () {});
  }
  // A refresh always starts from the top: power-on, then the title screen.
  // A link to a stop (someone arriving from outside) still opens there.
  history.scrollRestoration = 'manual';
  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  var reloaded = nav && nav.type === 'reload';
  var startIdx = reloaded ? 0 : stopIndex(location.hash.slice(1));
  if (reloaded && location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  scrollTo(0, startIdx > 0 ? startIdx * stopHeight() : 0);
  onScroll();
  scroll.lastT = 0;
  refreshStars();
  boot();
  requestAnimationFrame(tick);
})();
