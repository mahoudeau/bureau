// office-assets.js — t-278 GB era (boss direction 2026-08-22, doctrine in
// projects/bureau/references/office/GB-DIRECTION.md).
//
// The office's entire art library: 4-shade palettes, hand-drawn sprites as
// indexed pixel-string maps, the rasterizer, dither helpers, a 3x5 bitmap
// font and the GB dialog box. Shared by /office (the live floor) and
// /office/assets (the gallery/approval page). Classic script, no modules:
// defines window.OfficeAssets.
//
// Sprite encoding: an array of strings, one per pixel row. '.' = transparent,
// '0'..'3' = shade index darkest..lightest. Multi-frame sprites are arrays
// of such grids. Everything renders palette-INDEXED: switching palettes
// re-rasterizes the atlas, sprites never store colors.
(function () {
  'use strict';

  // ---- palettes: darkest -> lightest --------------------------------------
  var PALETTES = {
    olive:  { label: 'OLIVE',  shades: ['#33382b', '#6b7353', '#b5b98a', '#e8e4c9'] },
    dmg:    { label: 'DMG',    shades: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
    pocket: { label: 'POCKET', shades: ['#202020', '#606060', '#a8a8a8', '#e0e0e0'] },
    amber:  { label: 'AMBER',  shades: ['#3a2a1a', '#7a5a30', '#c9a05e', '#f0e0c0'] },
  };

  // ---- sprites ------------------------------------------------------------
  // Furniture fills use 3 (paper/light) and 2 (mid), lines/shadows 1 and 0.
  var S = {};

  // 1. Floor tiles (8x8). plain: lightest with sparse mid specks.
  S['floor-plain'] = [
    '33333333',
    '33333333',
    '33233333',
    '33333333',
    '33333323',
    '33333333',
    '32333333',
    '33333333',
  ];
  // grid tile: mid seams top+left, reads as floor tiles when repeated.
  S['floor-grid'] = [
    '22222222',
    '23333333',
    '23333333',
    '23333333',
    '23333333',
    '23333333',
    '23333333',
    '23333333',
  ];
  // rug/carpet path: mid field, line-dither texture (stripe technique).
  S['floor-rug'] = [
    '22222222',
    '21212121',
    '22222222',
    '12121212',
    '22222222',
    '21212121',
    '22222222',
    '12121212',
  ];

  // 2. Wall band (8x8): light wallpaper with a sparse motif dot; baseboard tile.
  S['wall-paper'] = [
    '22222222',
    '22222222',
    '22212222',
    '22222222',
    '22222222',
    '22222122',
    '22222222',
    '22222222',
  ];
  S['wall-base'] = [
    '22222222',
    '11111111',
    '33333333',
    '33333333',
    '11111111',
    '00000000',
    '00000000',
    '00000000',
  ];
  // interior wall cap (partition walls inside the floor), 8x8
  S['wall-cap'] = [
    '00000000',
    '01111110',
    '01111110',
    '01111110',
    '01111110',
    '01111110',
    '01111110',
    '00000000',
  ];

  // 3. Night window (16x16): frame, dithered night glass, tiny skyline + star.
  S['window-night'] = [
    '0000000000000000',
    '0333333333333330',
    '0311111111111130',
    '0310101010101030',
    '0311111311111130',
    '0310101010101030',
    '0311111111111130',
    '0310101010121030',
    '0333333333333330',
    '0311111111111130',
    '0310121010101030',
    '0311212110112130',
    '0312121211212130',
    '0312121212121230',
    '0333333333333330',
    '0000000000000000',
  ];

  // 4. Mission board (48x24 composition): frame + header strip + 4 columns.
  //    Card slots stay empty here; the floor draws folder sprites into them.
  S['board'] = (function () {
    var rows = [];
    var W = 48, H = 24;
    for (var y = 0; y < H; y++) {
      var r = '';
      for (var x = 0; x < W; x++) {
        var edge = (x === 0 || y === 0 || x === W - 1 || y === H - 1);
        var inner = (x === 1 || y === 1 || x === W - 2 || y === H - 2);
        if (edge) r += '0';
        else if (inner) r += '1';
        else if (y === 6 && x > 2 && x < W - 3) r += '1'; // header rule
        else r += '3';
      }
      rows.push(r);
    }
    return rows;
  })();

  // 5. Desk set. desk 32x16: top surface, front panel with drawer.
  S['desk'] = (function () {
    var rows = [];
    for (var y = 0; y < 16; y++) {
      var r = '';
      for (var x = 0; x < 32; x++) {
        if (y === 0 || y === 15 || x === 0 || x === 31) r += '0';
        else if (y === 1) r += '3';               // top highlight
        else if (y < 6) r += '2';                 // desktop
        else if (y === 6) r += '0';               // edge line
        else if (y > 6 && y < 15 && x > 18 && x < 29 && y > 8 && y < 13)
          r += (y === 10 && x > 21 && x < 26) ? '0' : '2'; // drawer + handle
        else r += '1';                            // front panel shadow
      }
      rows.push(r);
    }
    return rows;
  })();
  S['chair'] = [
    '.000000.',
    '01111110',
    '01111110',
    '01111110',
    '.001100.',
    '.011110.',
    '.0....0.',
    '00....00',
  ];
  // CRT monitor 16x14, three screen states as frames: off / on / glow line.
  function crt(inner) {
    return [
      '.00000000000000.',
      '0333333333333330',
      '03' + inner[0] + '30',
      '03' + inner[1] + '30',
      '03' + inner[2] + '30',
      '03' + inner[3] + '30',
      '03' + inner[4] + '30',
      '03' + inner[5] + '30',
      '0333333333333330',
      '.00000000000000.',
      '.....000000.....',
      '.....011110.....',
      '....00000000....',
      '....03333330....',
    ];
  }
  S['monitor-off'] = crt([
    '111111111111', '111111111111', '111111111111',
    '111111111111', '111111111111', '111111111111']);
  S['monitor-on'] = crt([
    '222222222222', '233322222222', '222222222222',
    '223333222222', '222222222222', '222233322222']);
  S['monitor-glow'] = crt([
    '222222222222', '222222222222', '233333333332',
    '222222222222', '223333222222', '222222222222']);

  // 10. Mission folders (8x8), states told by dither pattern, never hue.
  //     queued: plain. working: half-stripe. review: checker. done: check mark.
  S['folder-queued'] = [
    '.0000...',
    '00000000',
    '03333330',
    '03333330',
    '03333330',
    '03333330',
    '00000000',
    '........',
  ];
  S['folder-working'] = [
    '.0000...',
    '00000000',
    '03333330',
    '03131330',
    '03313330',
    '03333330',
    '00000000',
    '........',
  ];
  S['folder-review'] = [
    '.0000...',
    '00000000',
    '03131310',
    '01313130',
    '03131310',
    '01313130',
    '00000000',
    '........',
  ];
  S['folder-done'] = [
    '.0000...',
    '00000000',
    '03333030',
    '03330330',
    '00303330',
    '03033330',
    '00000000',
    '........',
  ];

  // 11. The agent, 16x16 (2x2 hardware tiles, Link/Kirby build).
  //     Spy register: dark suit (1), shirt V (3), face 3, hair 0.
  //     Frames: idle-a/b, walk-down-a/b, walk-up-a/b, walk-side-a/b
  //     (side faces LEFT; the renderer mirrors for right).
  S['agent-idle-a'] = [
    '....000000......',
    '...00000000.....',
    '..0000000000....',
    '..0033333300....',
    '..0030330300....',
    '..0033333300....',
    '...00333300.....',
    '....000000......',
    '...01111110.....',
    '..0113113110....',
    '..0111331110....',
    '.03011111103....',
    '.00011111100....',
    '....011110......',
    '....00..00......',
    '...000..000.....',
  ];
  S['agent-idle-b'] = [
    '................',
    '....000000......',
    '...00000000.....',
    '..0000000000....',
    '..0033333300....',
    '..0030330300....',
    '..0033333300....',
    '...00333300.....',
    '....000000......',
    '...01111110.....',
    '..0113113110....',
    '..0111331110....',
    '.03011111103....',
    '.00011111100....',
    '....011110......',
    '...000..000.....',
  ];
  S['agent-walk-down-a'] = [
    '....000000......',
    '...00000000.....',
    '..0000000000....',
    '..0033333300....',
    '..0030330300....',
    '..0033333300....',
    '...00333300.....',
    '....000000......',
    '...01111110.....',
    '..0113113110....',
    '..0111331110....',
    '.03011111103....',
    '.00011111100....',
    '....011110......',
    '....00..........',
    '...000....00....',
  ];
  S['agent-walk-down-b'] = [
    '....000000......',
    '...00000000.....',
    '..0000000000....',
    '..0033333300....',
    '..0030330300....',
    '..0033333300....',
    '...00333300.....',
    '....000000......',
    '...01111110.....',
    '..0113113110....',
    '..0111331110....',
    '.03011111103....',
    '.00011111100....',
    '....011110......',
    '..........00....',
    '....00....000...',
  ];
  S['agent-walk-up-a'] = [
    '....000000......',
    '...00000000.....',
    '..0000000000....',
    '..0000000000....',
    '..0000000000....',
    '..0000000000....',
    '...00000000.....',
    '....000000......',
    '...01111110.....',
    '..0111111110....',
    '..0111111110....',
    '.03011111103....',
    '.00011111100....',
    '....011110......',
    '....00..........',
    '...000....00....',
  ];
  S['agent-walk-up-b'] = [
    '....000000......',
    '...00000000.....',
    '..0000000000....',
    '..0000000000....',
    '..0000000000....',
    '..0000000000....',
    '...00000000.....',
    '....000000......',
    '...01111110.....',
    '..0111111110....',
    '..0111111110....',
    '.03011111103....',
    '.00011111100....',
    '....011110......',
    '..........00....',
    '....00....000...',
  ];
  S['agent-walk-side-a'] = [
    '....000000......',
    '...00000000.....',
    '..0000000000....',
    '..0003333000....',
    '..0000303000....',
    '..0003333000....',
    '...00033000.....',
    '....000000......',
    '....0111100.....',
    '...011311100....',
    '...011331100....',
    '...011111030....',
    '...011111000....',
    '....011110......',
    '....000.........',
    '...000....0.....',
  ];
  S['agent-walk-side-b'] = [
    '....000000......',
    '...00000000.....',
    '..0000000000....',
    '..0003333000....',
    '..0000303000....',
    '..0003333000....',
    '...00033000.....',
    '....000000......',
    '....0111100.....',
    '...011311100....',
    '...011331100....',
    '...011111030....',
    '...011111000....',
    '....011110......',
    '.......000......',
    '.....00...00....',
  ];
  // 12. Typing: seated upper body over the chair (desk occludes legs).
  S['agent-typing-a'] = [
    '....000000......',
    '...00000000.....',
    '..0000000000....',
    '..0033333300....',
    '..0030330300....',
    '..0033333300....',
    '...00333300.....',
    '....000000......',
    '...01111110.....',
    '..0113113110....',
    '..3111331113....',
    '..0111111110....',
    '................',
    '................',
    '................',
    '................',
  ];
  S['agent-typing-b'] = [
    '....000000......',
    '...00000000.....',
    '..0000000000....',
    '..0033333300....',
    '..0030330300....',
    '..0033333300....',
    '...00333300.....',
    '....000000......',
    '...01111110.....',
    '..0113113110....',
    '..0111331110....',
    '..3111111113....',
    '................',
    '................',
    '................',
    '................',
  ];

  // 13. Emote glyphs (8x8), drawn above heads in a tiny balloon.
  S['emote-bang'] = [
    '..033...',
    '..033...',
    '..033...',
    '..033...',
    '..033...',
    '........',
    '..033...',
    '........',
  ];
  S['emote-quest'] = [
    '..0330..',
    '.03..30.',
    '....330.',
    '...330..',
    '...33...',
    '........',
    '...33...',
    '........',
  ];
  S['emote-zzz'] = [
    '.3333...',
    '...33...',
    '..33....',
    '.3333...',
    '....333.',
    '.....33.',
    '....33..',
    '....333.',
  ];
  S['emote-coffee'] = [
    '..3.3...',
    '.3.3....',
    '.00000..',
    '.033300.',
    '.03330.0',
    '.033300.',
    '.00000..',
    '........',
  ];
  S['emote-mail'] = [
    '........',
    '0000000.',
    '0300030.',
    '0330330.',
    '0303030.',
    '0333330.',
    '0000000.',
    '........',
  ];

  // 6-9 land in later rounds (shelf, coffee machine, conference, boss door)
  // per the GB-DIRECTION.md queue; the floor keeps 4-shade procedural
  // fallbacks for them until then.

  // ---- 3x5 bitmap font ----------------------------------------------------
  // Each glyph: 5 strings of 3 chars, '1' = ink. Rendered with 1px advance
  // gap (4px per character), 6px line height.
  var FONT = {
    'A': ['010','101','111','101','101'], 'B': ['110','101','110','101','110'],
    'C': ['011','100','100','100','011'], 'D': ['110','101','101','101','110'],
    'E': ['111','100','110','100','111'], 'F': ['111','100','110','100','100'],
    'G': ['011','100','101','101','011'], 'H': ['101','101','111','101','101'],
    'I': ['111','010','010','010','111'], 'J': ['001','001','001','101','010'],
    'K': ['101','110','100','110','101'], 'L': ['100','100','100','100','111'],
    'M': ['101','111','111','101','101'], 'N': ['101','111','111','111','101'],
    'O': ['010','101','101','101','010'], 'P': ['110','101','110','100','100'],
    'Q': ['010','101','101','110','011'], 'R': ['110','101','110','110','101'],
    'S': ['011','100','010','001','110'], 'T': ['111','010','010','010','010'],
    'U': ['101','101','101','101','111'], 'V': ['101','101','101','101','010'],
    'W': ['101','101','111','111','101'], 'X': ['101','101','010','101','101'],
    'Y': ['101','101','010','010','010'], 'Z': ['111','001','010','100','111'],
    '0': ['010','101','101','101','010'], '1': ['010','110','010','010','111'],
    '2': ['110','001','010','100','111'], '3': ['110','001','010','001','110'],
    '4': ['101','101','111','001','001'], '5': ['111','100','110','001','110'],
    '6': ['011','100','110','101','010'], '7': ['111','001','010','010','010'],
    '8': ['010','101','010','101','010'], '9': ['010','101','011','001','110'],
    ' ': ['000','000','000','000','000'], '.': ['000','000','000','000','010'],
    ':': ['000','010','000','010','000'], ',': ['000','000','000','010','100'],
    '!': ['010','010','010','000','010'], '?': ['110','001','010','000','010'],
    '-': ['000','000','111','000','000'], '+': ['000','010','111','010','000'],
    '/': ['001','001','010','100','100'], "'": ['010','010','000','000','000'],
    '(': ['001','010','010','010','001'], ')': ['100','010','010','010','100'],
    '>': ['100','010','001','010','100'], '<': ['001','010','100','010','001'],
    '*': ['101','010','101','000','000'],
  };

  // ---- rasterizer ---------------------------------------------------------
  // sprite(name, paletteKey) -> cached offscreen canvas. The cache is keyed
  // per palette, so a palette switch is a lazy full re-rasterize.
  var cache = {};
  function sprite(name, pal) {
    var key = pal + '/' + name;
    if (cache[key]) return cache[key];
    var grid = S[name];
    if (!grid) return null;
    var h = grid.length, w = grid[0].length;
    var cnv = document.createElement('canvas');
    cnv.width = w; cnv.height = h;
    var c = cnv.getContext('2d');
    var shades = PALETTES[pal].shades;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ch = grid[y][x];
        if (ch === '.' || ch === undefined) continue;
        c.fillStyle = shades[+ch];
        c.fillRect(x, y, 1, 1);
      }
    }
    cache[key] = cnv;
    return cnv;
  }
  function clearCache() { cache = {}; }

  // Mirror helper for side-facing sprites (draw with ctx.scale(-1,1)).
  function drawSprite(ctx, name, pal, x, y, mirror) {
    var cnv = sprite(name, pal);
    if (!cnv) return;
    x |= 0; y |= 0;
    if (mirror) {
      ctx.save();
      ctx.translate(x + cnv.width, y);
      ctx.scale(-1, 1);
      ctx.drawImage(cnv, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(cnv, x, y);
    }
  }

  // Tile a named 8x8 sprite over a rect.
  function tileRect(ctx, name, pal, x, y, w, h) {
    var cnv = sprite(name, pal);
    if (!cnv) return;
    for (var ty = y; ty < y + h; ty += cnv.height)
      for (var tx = x; tx < x + w; tx += cnv.width)
        ctx.drawImage(cnv, tx, ty);
  }

  // ---- dither fills (the boss's brief: checkerboard + line) ---------------
  function dither50(ctx, pal, x, y, w, h, a, b) {
    var sh = PALETTES[pal].shades;
    for (var yy = 0; yy < h; yy++)
      for (var xx = 0; xx < w; xx++) {
        ctx.fillStyle = sh[((xx + yy) % 2) ? a : b];
        ctx.fillRect(x + xx, y + yy, 1, 1);
      }
  }
  function ditherLines(ctx, pal, x, y, w, h, a, b, vertical) {
    var sh = PALETTES[pal].shades;
    for (var yy = 0; yy < h; yy++)
      for (var xx = 0; xx < w; xx++) {
        var on = vertical ? (xx % 2) : (yy % 2);
        ctx.fillStyle = sh[on ? a : b];
        ctx.fillRect(x + xx, y + yy, 1, 1);
      }
  }

  // ---- bitmap text --------------------------------------------------------
  // drawText(ctx, 'HELLO', pal, x, y, shadeIndex). Uppercases; unknown
  // glyphs render as space. Returns the advance width.
  function drawText(ctx, str, pal, x, y, shade) {
    var sh = PALETTES[pal].shades[shade === undefined ? 0 : shade];
    ctx.fillStyle = sh;
    var cx = x | 0;
    str = String(str).toUpperCase();
    for (var i = 0; i < str.length; i++) {
      var g = FONT[str[i]] || FONT[' '];
      for (var gy = 0; gy < 5; gy++)
        for (var gx = 0; gx < 3; gx++)
          if (g[gy][gx] === '1') ctx.fillRect(cx + gx, (y | 0) + gy, 1, 1);
      cx += 4;
    }
    return cx - x;
  }
  function textWidth(str) { return String(str).length * 4; }

  // ---- GB dialog box ------------------------------------------------------
  // Double border like the reference screenshot: dark outer, light gap,
  // dark inner, lightest fill.
  function drawBox(ctx, pal, x, y, w, h) {
    var sh = PALETTES[pal].shades;
    ctx.fillStyle = sh[0]; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = sh[3]; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = sh[0]; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = sh[3]; ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  }

  // ---- gallery registry ---------------------------------------------------
  // What /office/assets shows, grouped; frames animate at fps.
  var GALLERY = [
    { section: 'Tiles', items: [
      { name: 'floor-plain' }, { name: 'floor-grid' }, { name: 'floor-rug' },
      { name: 'wall-paper' }, { name: 'wall-base' }, { name: 'wall-cap' },
    ]},
    { section: 'Furniture', items: [
      { name: 'window-night' }, { name: 'board' }, { name: 'desk' },
      { name: 'chair' },
      { name: 'monitor', frames: ['monitor-off', 'monitor-on', 'monitor-glow'], fps: 2 },
    ]},
    { section: 'Missions', items: [
      { name: 'folder-queued' }, { name: 'folder-working' },
      { name: 'folder-review' }, { name: 'folder-done' },
    ]},
    { section: 'Agents', items: [
      { name: 'idle', frames: ['agent-idle-a', 'agent-idle-b'], fps: 2 },
      { name: 'walk-down', frames: ['agent-walk-down-a', 'agent-walk-down-b'], fps: 6 },
      { name: 'walk-up', frames: ['agent-walk-up-a', 'agent-walk-up-b'], fps: 6 },
      { name: 'walk-side', frames: ['agent-walk-side-a', 'agent-walk-side-b'], fps: 6 },
      { name: 'typing', frames: ['agent-typing-a', 'agent-typing-b'], fps: 4 },
    ]},
    { section: 'Emotes', items: [
      { name: 'emote-bang' }, { name: 'emote-quest' }, { name: 'emote-zzz' },
      { name: 'emote-coffee' }, { name: 'emote-mail' },
    ]},
  ];

  window.OfficeAssets = {
    PALETTES: PALETTES,
    SPRITES: S,
    GALLERY: GALLERY,
    sprite: sprite,
    drawSprite: drawSprite,
    tileRect: tileRect,
    dither50: dither50,
    ditherLines: ditherLines,
    drawText: drawText,
    textWidth: textWidth,
    drawBox: drawBox,
    clearCache: clearCache,
  };
})();
