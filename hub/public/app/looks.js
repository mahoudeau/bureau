// The dashboard's look, applied before the first paint: Paper or Ink (light or
// dark, or System), Marker or Pencil (sharp, or soft and vintage), a colour,
// and the ground behind the sheets. All of it is kept in this browser.
//
// The design system draws everything from two tokens, --ink and --paper. A
// look only sets those (and the shadows and inverses that repeat them), plus
// two ground tints. Pure Marker sets nothing: the system's own tokens apply.
// Pencil never goes under 4.5 to 1: the ink is pushed apart until it holds.
//
// A plain script, not a module, so index.html can run it before the
// stylesheets. theme.js and Settings use window.BureauLooks.
(function () {
  var KEYS = { theme: 'bureau_theme', marker: 'bureau_marker', colour: 'bureau_colour', ground: 'bureau_ground', follow: 'bureau_office_follow', office: 'bureau_office_palette' };
  var THEMES = ['system', 'paper', 'ink'];
  var MARKERS = ['marker', 'pencil'];
  var GROUNDS = ['dots', 'fine', 'lines', 'solid', 'gradient', 'fade'];
  // The office's four palettes (office-assets.js), darkest to lightest, and
  // Pure, Bureau's own black and white.
  var COLOURS = {
    pure: ['#0b0d12', '#4a4d55', '#b9bbc0', '#ffffff'],
    pocket: ['#202020', '#606060', '#a8a8a8', '#e0e0e0'],
    olive: ['#33382b', '#6b7353', '#b5b98a', '#e8e4c9'],
    dmg: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
    amber: ['#3a2a1a', '#7a5a30', '#c9a05e', '#f0e0c0'],
  };
  var ORDER = ['pure', 'pocket', 'olive', 'dmg', 'amber'];

  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value, fallback) {
    try { if (value === fallback) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* it applies to this page only */ }
  }
  function pick(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }

  function get() {
    return {
      theme: pick(read(KEYS.theme), THEMES, 'paper'),
      marker: pick(read(KEYS.marker), MARKERS, 'marker'),
      colour: pick(read(KEYS.colour), ORDER, 'pure'),
      ground: pick(read(KEYS.ground), GROUNDS, 'dots'),
      follow: read(KEYS.follow) !== 'off',
    };
  }

  // ---- Colour arithmetic ----
  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function hex(c) { return '#' + c.map(function (v) { return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'); }).join(''); }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hex(x.map(function (v, i) { return v + (y[i] - v) * t; })); }
  function lum(h) {
    var w = [0.2126, 0.7152, 0.0722];
    return rgb(h).reduce(function (acc, v, i) { v /= 255; return acc + w[i] * (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); }, 0);
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  // ink, paper and two ground tints for a tone, a marker and a colour.
  function look(tone, marker, colour) {
    var s = COLOURS[colour], l;
    if (marker === 'marker') {
      if (colour === 'pure') l = tone === 'light'
        ? { ink: '#0b0d12', paper: '#ffffff', tint: '#ececee', deep: '#d4d5d9' }
        : { ink: '#f1f2ec', paper: '#0b0d12', tint: '#181b22', deep: '#262a33' };
      else l = tone === 'light'
        ? { ink: s[0], paper: mix(s[3], '#ffffff', 0.72), tint: mix(s[3], '#ffffff', 0.25), deep: mix(s[2], s[3], 0.45) }
        : { ink: mix(s[3], '#ffffff', 0.35), paper: mix(s[0], '#000000', 0.45), tint: mix(s[0], '#000000', 0.15), deep: mix(s[0], s[1], 0.35) };
    } else if (tone === 'light') {
      l = colour === 'pure'
        ? { ink: '#34363b', paper: '#e6e5e0', tint: '#d8d7d1', deep: '#c4c3bc' }
        : { ink: mix(s[0], s[1], 0.18), paper: s[3], tint: mix(s[3], s[2], 0.35), deep: mix(s[2], s[1], 0.15) };
    } else if (colour === 'pure') {
      l = { ink: '#c9c9c3', paper: '#2c2d31', tint: '#232428', deep: '#1a1b1e' };
    } else {
      var paper = mix(s[0], s[1], 0.22);
      l = { ink: mix(s[3], s[2], 0.3), paper: paper, tint: mix(paper, '#000000', 0.22), deep: mix(paper, '#000000', 0.45) };
    }
    var away = tone === 'light' ? '#000000' : '#ffffff';
    for (var i = 0; i < 12 && contrast(l.ink, l.paper) < 4.6; i++) l.ink = mix(l.ink, away, 0.08);
    return l;
  }

  // The dithered fade: a 4x4 Bayer table over a vertical ramp, one narrow
  // strip per ink colour, repeated across and anchored to the bottom.
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var fades = {};
  function fade(ink) {
    if (fades[ink]) return fades[ink];
    var c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    var g = c.getContext('2d');
    if (!g) return 'none';
    g.fillStyle = ink;
    for (var y = 0; y < 256; y++) {
      var level = Math.max(0, (y / 256 - 0.25) / 0.75) * 0.55;
      for (var x = 0; x < 4; x++) if (BAYER[(y % 4) * 4 + x] / 16 < level) g.fillRect(x, y, 1, 1);
    }
    fades[ink] = 'url(' + c.toDataURL() + ')';
    return fades[ink];
  }

  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function toneOf(theme) { return theme === 'ink' || (theme === 'system' && dark && dark.matches) ? 'dark' : 'light'; }

  var VARS = ['--ink', '--paper', '--ink-inv', '--paper-inv', '--shadow-control', '--shadow-menu', '--shadow-dialog'];
  function apply() {
    var p = get(), root = document.documentElement, tone = toneOf(p.theme);
    var l = look(tone, p.marker, p.colour);
    root.setAttribute('data-theme', tone);
    root.setAttribute('data-ground', p.ground);
    root.setAttribute('data-look', p.marker + ' ' + p.colour);
    if (p.marker === 'marker' && p.colour === 'pure') VARS.forEach(function (v) { root.style.removeProperty(v); });
    else {
      root.style.setProperty('--ink', l.ink);
      root.style.setProperty('--paper', l.paper);
      root.style.setProperty('--ink-inv', l.paper);
      root.style.setProperty('--paper-inv', l.ink);
      root.style.setProperty('--shadow-control', '3px 3px 0 ' + l.ink);
      root.style.setProperty('--shadow-menu', '4px 4px 0 ' + l.ink);
      root.style.setProperty('--shadow-dialog', '10px 10px 0 ' + l.ink);
    }
    root.style.setProperty('--ground-tint', l.tint);
    root.style.setProperty('--ground-deep', l.deep);
    // Always set: Settings shows the fade as a tile whatever the ground is.
    root.style.setProperty('--ground-fade', fade(l.ink));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', l.paper);
    return p;
  }

  // Change one part of the look and apply it. With follow on, a colour other
  // than Pure also sets the office's palette (same key as office.html, which
  // follows at once).
  function set(change) {
    if (change.theme !== undefined) write(KEYS.theme, pick(change.theme, THEMES, 'paper'), 'paper');
    if (change.marker !== undefined) write(KEYS.marker, pick(change.marker, MARKERS, 'marker'), 'marker');
    if (change.colour !== undefined) write(KEYS.colour, pick(change.colour, ORDER, 'pure'), 'pure');
    if (change.ground !== undefined) write(KEYS.ground, pick(change.ground, GROUNDS, 'dots'), 'dots');
    if (change.follow !== undefined) write(KEYS.follow, change.follow ? 'on' : 'off', 'on');
    var p = apply();
    if (p.follow && p.colour !== 'pure' && (change.colour !== undefined || change.follow)) {
      try { localStorage.setItem(KEYS.office, p.colour); } catch (e) { /* the office keeps its own */ }
    }
    try { window.dispatchEvent(new CustomEvent('bureau:look', { detail: p })); } catch (e) { /* old browser: no live repaint */ }
    return p;
  }

  if (dark && dark.addEventListener) dark.addEventListener('change', function () { if (get().theme === 'system') apply(); });
  // Another tab changed the look: follow it.
  window.addEventListener('storage', function (e) {
    if (e.key === null || [KEYS.theme, KEYS.marker, KEYS.colour, KEYS.ground].indexOf(e.key) >= 0) apply();
  });

  window.BureauLooks = { get: get, set: set, apply: apply, look: look, contrast: contrast, toneOf: toneOf, THEMES: THEMES, MARKERS: MARKERS, GROUNDS: GROUNDS, COLOURS: ORDER, SHADES: COLOURS };
  apply();
})();
