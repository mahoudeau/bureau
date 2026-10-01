// site/bughunt.js: the hidden cartridge. An original maze chase in the
// office's 4-shade register: a tiny agent clears the ticket backlog while
// bugs hunt it; coffee turns the tables. Art, maze and name are ours.
//
//   var game = BugHunt.create(OfficeAssets, BureauSound);
//   game.start(); game.input('left'); game.update(dt); game.draw(palKey, t);
//   game.canvas  (GW x GH art pixels, blit it at an integer scale)
(function () {
  'use strict';
  var T = 8;
  // # wall, . ticket, o coffee, P agent start, G bug pen, - pen door
  var MAZE = [
    '###################',
    '#o.......#.......o#',
    '#.##.###.#.###.##.#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.###.#.###.####',
    '####.#.......#.####',
    '####.#.##-##.#.####',
    '.......#GGG#.......',
    '####.#.#####.#.####',
    '####.#.......#.####',
    '####.#.#####.#.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#.....P.....#.o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#.................#',
    '###################',
  ];
  var COLS = MAZE[0].length, ROWS = MAZE.length;
  var HUD = 10;
  var GW = COLS * T, GH = ROWS * T + HUD;
  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  var OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

  var SPR = {
    'bh-agent-a': ['..0000..', '.033330.', '.030030.', '.033330.', '..0110..', '.011110.', '..0..0..', '.00..00.'],
    'bh-agent-b': ['..0000..', '.033330.', '.030030.', '.033330.', '..0110..', '.011110.', '..0..0..', '..0..0..'],
    'bh-bug-a': ['.0....0.', '..0000..', '.031130.', '01111110', '.011110.', '01111110', '.011110.', '0.0..0.0'],
    'bh-bug-b': ['.0....0.', '..0000..', '.031130.', '01111110', '.011110.', '01111110', '.011110.', '.0.00.0.'],
    'bh-bug-scared-a': ['.0....0.', '..0000..', '.022220.', '02022020', '.022220.', '02222220', '.020020.', '0.0..0.0'],
    'bh-bug-scared-b': ['.0....0.', '..0000..', '.022220.', '02022020', '.022220.', '02222220', '.020020.', '.0.00.0.'],
    'bh-life': ['.00.', '0330', '.11.', '0..0'],
  };

  function create(A, Snd) {
    Object.keys(SPR).forEach(function (k) { A.SPRITES[k] = SPR[k]; });
    var cnv = document.createElement('canvas'); cnv.width = GW; cnv.height = GH;
    var c = cnv.getContext('2d');
    var HI_KEY = 'bureau_bughunt_hi';
    var hi = 0; try { hi = +localStorage.getItem(HI_KEY) || 0; } catch (e) {}

    var grid, dotsLeft, player, bugs, state, stateT, score, lives, level, scaredUntil, chain, dotTone;

    function cell(x, y) {
      if (y < 0 || y >= ROWS) return '#';
      x = (x + COLS) % COLS;
      return grid[y][x];
    }
    function open(x, y, ghost) {
      var ch = cell(x, y);
      if (ch === '#') return false;
      if (ch === '-') return !!ghost;
      return true;
    }
    function resetMaze() {
      grid = MAZE.map(function (r) { return r.split(''); });
      dotsLeft = 0;
      grid.forEach(function (r) { r.forEach(function (ch) { if (ch === '.' || ch === 'o') dotsLeft++; }); });
    }
    function mover(tx, ty, dir) { return { x: tx * T, y: ty * T, dir: dir, want: dir }; }
    function resetActors() {
      player = mover(9, 15, 'left'); player.want = 'left';
      bugs = [0, 1, 2, 3].map(function (i) {
        var b = mover(8 + (i % 3), 9, 'up');
        b.i = i; b.home = { x: b.x, y: b.y }; b.inPen = true;
        b.releaseAt = i * 2600; b.eatenUntil = 0;
        return b;
      });
      bugs[0].x = 9 * T; bugs[0].y = 7 * T; bugs[0].inPen = false; bugs[0].dir = 'left';
      scaredUntil = 0; chain = 0;
    }
    function newGame() {
      score = 0; lives = 3; level = 1;
      resetMaze(); resetActors();
      setState('ready');
      Snd.play('bhstart');
    }
    function setState(s) { state = s; stateT = 0; }

    function atCenter(m) { return m.x % T === 0 && m.y % T === 0; }
    function tileOf(m) { return { x: Math.round(m.x / T), y: Math.round(m.y / T) }; }

    // Step a mover one pixel at a time so turns land exactly on tile centres.
    function advance(m, px, ghost, chooser) {
      var steps = Math.floor(m.acc = (m.acc || 0) + px);
      m.acc -= steps;
      for (var s = 0; s < steps; s++) {
        if (atCenter(m)) {
          var tl = tileOf(m);
          if (chooser) m.dir = chooser(m, tl);
          else {
            var w = DIRS[m.want];
            if (open(tl.x + w[0], tl.y + w[1], ghost)) m.dir = m.want;
            var d = DIRS[m.dir];
            if (!open(tl.x + d[0], tl.y + d[1], ghost)) return;
          }
        } else if (!chooser && m.want === OPP[m.dir]) {
          m.dir = m.want; // reversing is always allowed mid-tile
        }
        var dd = DIRS[m.dir];
        m.x += dd[0]; m.y += dd[1];
        // the tunnel row wraps
        if (m.x < -T / 2) m.x += COLS * T;
        if (m.x > (COLS - 0.5) * T) m.x -= COLS * T;
      }
    }

    function bugTarget(b) {
      var p = tileOf(player), pd = DIRS[player.dir];
      if (b.i === 0) return p;
      if (b.i === 1) return { x: p.x + pd[0] * 4, y: p.y + pd[1] * 4 };
      if (b.i === 2) { var bt = tileOf(b); return Math.hypot(bt.x - p.x, bt.y - p.y) > 7 ? p : { x: 0, y: ROWS }; }
      return { x: (Math.sin(stateT / 2400 + b.i) * 0.5 + 0.5) * COLS, y: (Math.cos(stateT / 3100) * 0.5 + 0.5) * ROWS };
    }
    function chooseFor(b) {
      return function (m, tl) {
        var scared = performance.now() < scaredUntil && !b.eatenUntil;
        var options = Object.keys(DIRS).filter(function (d) {
          var v = DIRS[d];
          if (d === OPP[m.dir]) return false;
          var nx = tl.x + v[0], ny = tl.y + v[1];
          if (!open(nx, ny, true)) return false;
          // only leaving the pen goes through the door, never back in
          if (cell(nx, ny) === '-' && !b.leaving) return false;
          return true;
        });
        if (!options.length) return OPP[m.dir];
        if (b.leaving) {
          var goUp = options.indexOf('up') >= 0 ? 'up' : null;
          if (tl.y <= 7) b.leaving = false;
          if (goUp) return goUp;
        }
        if (scared) return options[Math.floor(Math.random() * options.length)];
        var tg = bugTarget(b), best = options[0], bestD = Infinity;
        options.forEach(function (d) {
          var v = DIRS[d], dist = Math.hypot(tl.x + v[0] - tg.x, tl.y + v[1] - tg.y);
          if (dist < bestD) { bestD = dist; best = d; }
        });
        return best;
      };
    }

    function eat() {
      var tl = tileOf(player);
      if (!atCenter(player)) return;
      var ch = cell(tl.x, tl.y);
      if (ch === '.') {
        grid[tl.y][tl.x] = ' '; dotsLeft--; score += 10;
        dotTone = !dotTone; Snd.play(dotTone ? 'bhdot' : 'bhdot2');
      } else if (ch === 'o') {
        grid[tl.y][tl.x] = ' '; dotsLeft--; score += 50;
        scaredUntil = performance.now() + Math.max(2500, 6500 - level * 600); chain = 0;
        bugs.forEach(function (b) { if (!b.inPen) b.dir = OPP[b.dir]; });
        Snd.play('bhpower');
      }
      if (dotsLeft <= 0) { setState('won'); Snd.play('bhwin'); }
    }

    function update(dt) {
      stateT += dt;
      if (state === 'ready') { if (stateT > 1800) setState('play'); return; }
      if (state === 'dying') {
        if (stateT > 1600) {
          if (lives <= 0) { setState('over'); if (score > hi) { hi = score; try { localStorage.setItem(HI_KEY, hi); } catch (e) {} } }
          else { resetActors(); setState('ready'); }
        }
        return;
      }
      if (state === 'won') { if (stateT > 2200) { level++; resetMaze(); resetActors(); setState('ready'); } return; }
      if (state !== 'play') return;

      var speed = 1 + (level - 1) * 0.08;
      advance(player, 0.058 * dt * speed, false, null);
      eat();
      if (state !== 'play') return;
      var now = performance.now(), scared = now < scaredUntil;
      bugs.forEach(function (b) {
        if (b.eatenUntil) {
          if (now < b.eatenUntil) return;
          b.eatenUntil = 0; b.x = b.home.x; b.y = b.home.y; b.inPen = true; b.releaseAt = stateT + 400;
        }
        if (b.inPen) {
          if (stateT < b.releaseAt) return;
          b.inPen = false; b.leaving = true; b.x = 9 * T; b.y = 9 * T; b.dir = 'up';
        }
        var sp = (scared ? 0.032 : 0.052) * dt * speed;
        advance(b, sp, true, chooseFor(b));
        if (Math.abs(b.x - player.x) < 6 && Math.abs(b.y - player.y) < 6) {
          if (scared) {
            chain++; score += 100 * Math.pow(2, chain);
            b.eatenUntil = now + 1400; b.x = -100; b.y = -100;
            Snd.play('bheat');
          } else {
            lives--; setState('dying'); Snd.play('bhdie');
          }
        }
      });
      if (score > hi) hi = score;
    }

    function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
    function draw(p, t) {
      var sh = A.PALETTES[p].shades;
      c.fillStyle = sh[3]; c.fillRect(0, 0, GW, GH);
      // HUD
      c.fillStyle = sh[0]; c.fillRect(0, HUD - 2, GW, 1);
      A.drawText(c, 'SCORE ' + pad(score, 5), p, 2, 2, 0);
      A.drawText(c, 'HI ' + pad(hi, 5), p, GW - 34, 2, 0);
      for (var l = 0; l < lives; l++) A.drawSprite(c, 'bh-life', p, 70 + l * 6, 2);
      c.save(); c.translate(0, HUD);
      // maze: walls are mid-shade blocks outlined in the darkest shade
      for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
        var ch = grid[y][x], px = x * T, py = y * T;
        if (ch === '#') {
          c.fillStyle = sh[1]; c.fillRect(px, py, T, T);
          c.fillStyle = sh[0];
          if (cell(x, y - 1) !== '#') c.fillRect(px, py, T, 1);
          if (cell(x, y + 1) !== '#') c.fillRect(px, py + T - 1, T, 1);
          if (x > 0 && cell(x - 1, y) !== '#') c.fillRect(px, py, 1, T);
          if (x < COLS - 1 && cell(x + 1, y) !== '#') c.fillRect(px + T - 1, py, 1, T);
        } else if (ch === '-') {
          c.fillStyle = sh[2]; c.fillRect(px, py + 3, T, 2);
        } else if (ch === '.') {
          c.fillStyle = sh[0]; c.fillRect(px + 3, py + 3, 2, 2);
        } else if (ch === 'o') {
          if (Math.floor(t / 250) % 2 || state !== 'play') A.drawSprite(c, 'emote-coffee', p, px, py);
        }
      }
      var now = performance.now(), scared = now < scaredUntil, flash = scared && scaredUntil - now < 1500 && Math.floor(t / 150) % 2;
      var f = Math.floor(t / 150) % 2;
      bugs.forEach(function (b) {
        if (b.eatenUntil || state === 'dying' && stateT > 400) return;
        var key = (scared && !flash) ? (f ? 'bh-bug-scared-a' : 'bh-bug-scared-b') : (f ? 'bh-bug-a' : 'bh-bug-b');
        A.drawSprite(c, key, p, b.x, b.y);
      });
      if (state === 'dying') {
        // the agent shrinks away, one row at a time
        var rows = Math.max(0, 8 - Math.floor(stateT / 160));
        var spr = A.sprite('bh-agent-a', p);
        if (spr && rows) c.drawImage(spr, 0, 8 - rows, 8, rows, player.x, player.y + 8 - rows, 8, rows);
      } else {
        var moving = state === 'play';
        A.drawSprite(c, (moving && Math.floor(t / 120) % 2) ? 'bh-agent-b' : 'bh-agent-a', p, player.x, player.y, player.dir === 'left');
      }
      c.restore();
      // banners in the classic dialog box
      var msg = state === 'ready' ? (level === 1 && score === 0 ? 'BUG HUNT' : 'LEVEL ' + level)
              : state === 'won' ? 'INBOX ZERO!' : state === 'over' ? 'GAME OVER' : state === 'paused' ? 'PAUSED' : null;
      if (msg) {
        var sub = state === 'over' ? 'A: AGAIN  B: EXIT' : state === 'ready' ? 'CLEAR THE TICKETS' : state === 'paused' ? 'START: RESUME' : '';
        var w = Math.max(A.textWidth(msg), A.textWidth(sub)) + 12, h = sub ? 22 : 13;
        var bx = ((GW - w) / 2) | 0, by = (HUD + 9 * T - 4) | 0;
        A.drawBox(c, p, bx, by, w, h);
        A.drawText(c, msg, p, bx + ((w - A.textWidth(msg)) / 2 | 0), by + 4, 0);
        if (sub) A.drawText(c, sub, p, bx + ((w - A.textWidth(sub)) / 2 | 0), by + 13, 1);
      }
    }

    function input(key) {
      if (DIRS[key]) { player.want = key; return; }
      if (key === 'a' && state === 'over') newGame();
      if (key === 'start') {
        if (state === 'play') setState('paused');
        else if (state === 'paused') { state = 'play'; }
      }
    }

    return {
      canvas: cnv, width: GW, height: GH,
      start: newGame, update: update, draw: draw, input: input,
      get state() { return state; },
    };
  }

  window.BugHunt = { create: create };
})();
