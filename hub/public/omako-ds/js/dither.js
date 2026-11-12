/* OMAKO DS dither: the parts CSS can't do alone. Optional, no dependencies,
   a plain script (works from file:// too). It sets window.OmakoDither.

   The rules it draws are in README.md, "Dither", ruled on 11 November 2026.

     OmakoDither.start()
       Draws everything below and keeps it drawn: new elements, new sizes, a
       theme change. Call it once; pages that render on the fly are watched.
         .om-fill          display type in a Bayer gradient, solid at the top
                           of each line. Solid ink without the script.
         .om-meter         progress: solid ink to the value, a short Bayer
                           edge after it, over the 12% track. Set --value.
         .om-meter-share   a share, not progress: the whole bar is that much
                           ink. Add it to .om-meter.
         .om-heat          counts over time, one cell each, 16 greys. Put the
                           values, 0 to 1, in data-values="0,.2,1".
         .om-pic > img     an image in Atkinson dither, light kept light on
                           both themes. The image stays underneath for its alt
                           text and its link to the original.
         .om-cast          the long shadow, for one box alone on the ground.
         .om-dock[data-more]  a Bayer band from the page into the dock, only
                           while there's more to scroll.

     OmakoDither.dissolve(el, { mode, out, origin }) -> Promise
       Shows (or with out: true, hides) an element through a dither, in hard
       steps on the --px grid. No opacity, no blending.
         mode 'bayer'   four frames of 50ms, cells in 4x4 Bayer order.
                        Dialogs, the palette, toasts.
         mode 'spread'  from a line out to the edges, coarse blocks first
                        that sharpen as they settle (Game Fold's pixelSpread).
                        The screen changing because you acted.
         mode 'fold'    dark dither, then a frost that clears in strips from
                        the hinge out, over a mosaic (Game Fold's foldReveal).
                        Once a session at most.
         origin         'center' (default), 'left' or 'right': where the
                        spread starts, or where the fold's hinge is
       With prefers-reduced-motion it just shows or hides.

     OmakoDither.paint(el, tone)
       A Bayer gradient as el's background. tone(u, v) gives ink from 0 to 1
       at u, v (0 to 1 across and down).

   The Bayer table and the spread and fold maths are ported line for line
   from duo-games: GameCore/Sources/GameCore/Effects/ScreenEffects.metal. */
(function () {
  'use strict';

  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var bayer = function (x, y) { return BAYER[(y & 3) * 4 + (x & 3)]; };
  var clamp = function (t) { return t < 0 ? 0 : t > 1 ? 1 : t; };
  var smooth = function (t) { t = clamp(t); return t * t * (3 - 2 * t); };
  var reduced = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  // Ink at this cell for a tone from 0 to 1, in 4x4 Bayer order.
  var on = function (t, x, y) { return t * 16 > bayer(x, y) + 0.5; };

  // One dot, in CSS pixels: the system's --px.
  function cell() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--px')) || 2; }

  var probe = null;
  function rgb(el, name) {
    if (!probe) probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = getComputedStyle(el).getPropertyValue(name).trim() || '#000';
    probe.fillRect(0, 0, 1, 1);
    return probe.getImageData(0, 0, 1, 1).data;
  }
  function colours(el) { return { ink: rgb(el, '--ink'), paper: rgb(el, '--paper') }; }
  // On the dark theme ink is the light one.
  function inkIsLight(c) { return c.ink[0] + c.ink[1] + c.ink[2] > c.paper[0] + c.paper[1] + c.paper[2]; }

  // A w by h canvas, one pixel a dot. bit(x, y) says ink; with paper set,
  // the rest is paper, else it stays clear.
  function bitmap(w, h, bit, c, paper) {
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d'); var img = ctx.createImageData(w, h); var d = img.data;
    for (var y = 0; y < h; y += 1) for (var x = 0; x < w; x += 1) {
      var i = (y * w + x) * 4; var b = bit(x, y);
      if (b) { d[i] = c.ink[0]; d[i + 1] = c.ink[1]; d[i + 2] = c.ink[2]; d[i + 3] = 255; }
      else if (paper) { d[i] = c.paper[0]; d[i + 1] = c.paper[1]; d[i + 2] = c.paper[2]; d[i + 3] = 255; }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
  function setBackground(el, cv, c) {
    el.style.backgroundImage = 'url(' + cv.toDataURL() + ')';
    el.style.backgroundSize = (cv.width * c) + 'px ' + (cv.height * c) + 'px';
    el.classList.add('is-dithered');
  }

  // Paint only when something that shows changed. Painting sets a style,
  // which the watcher sees, so without this it would paint forever.
  var last = new WeakMap();
  function changed(el, key) { if (last.get(el) === key) return false; last.set(el, key); return true; }
  var themeKey = 0;

  /* ---- a Bayer gradient as a background ---- */
  function paint(el, tone) {
    var c = cell(); var w = Math.ceil(el.clientWidth / c); var h = Math.ceil(el.clientHeight / c);
    if (!w || !h) return;
    setBackground(el, bitmap(w, h, function (x, y) { return on(tone((x + 0.5) / w, (y + 0.5) / h), x, y); }, colours(el), true), c);
  }

  /* ---- .om-fill: ink at the top of each line, thinning to the bottom ---- */
  function paintFill(el) {
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var c = cell();
    var lh = parseFloat(getComputedStyle(el).lineHeight) || r.height;
    if (!changed(el, [themeKey, r.width, r.height, c].join())) return;
    var w = Math.ceil(r.width / c); var h = Math.ceil(r.height / c);
    var cv = bitmap(w, h, function (x, y) { var v = ((y * c) % lh) / lh; return (1.08 - 0.9 * v) * 16 > bayer(x, y) + 0.5; }, colours(el), false);
    setBackground(el, cv, c);
  }

  /* ---- meters ---- */
  var TRACK = 2 / 16; // the 12% step: the meter's empty track, as in CSS
  function valueOf(el) {
    var v = parseFloat(el.style.getPropertyValue('--value') || getComputedStyle(el).getPropertyValue('--value'));
    return clamp((isNaN(v) ? 0 : v) / 100);
  }
  function paintMeter(el) {
    var c = cell(); var W = el.clientWidth; var H = el.clientHeight;
    if (!W || !H) return;
    var v = valueOf(el); var share = el.classList.contains('om-meter-share');
    if (!changed(el, [themeKey, W, H, c, v, share].join())) return;
    var w = Math.ceil(W / c); var h = Math.ceil(H / c);
    var tone = share
      ? function () { return v; }
      : function (u) { return u <= v ? 1 : Math.max(TRACK, 1 - smooth((u - v) / 0.12)); };
    setBackground(el, bitmap(w, h, function (x, y) { return on(tone((x + 0.5) / w), x, y); }, colours(el), true), c);
  }
  function paintHeat(el) {
    var c = cell(); var W = el.clientWidth; var H = el.clientHeight;
    if (!W || !H) return;
    var raw = el.getAttribute('data-values') || '';
    if (!changed(el, [themeKey, W, H, c, raw].join())) return;
    var vals = raw.split(',').map(function (s) { return clamp(parseFloat(s) || 0); });
    if (!vals.length) return;
    var w = Math.ceil(W / c); var h = Math.ceil(H / c); var n = vals.length;
    setBackground(el, bitmap(w, h, function (x, y) {
      var at = (x / w) * n; var i = Math.floor(at);
      // a one-dot gap between cells when they're wide enough to have one
      if (w / n >= 4 && Math.floor(((i + 1) / n) * w) - 1 === x) return false;
      return on(vals[i], x, y);
    }, colours(el), true), c);
  }

  /* ---- images: Atkinson, positive on both themes ---- */
  function fitBox(img, W, H) {
    var nw = img.naturalWidth; var nh = img.naturalHeight; var cs = getComputedStyle(img);
    var fit = cs.objectFit; var s;
    if (fit === 'cover') s = Math.max(W / nw, H / nh);
    else if (fit === 'contain' || fit === 'scale-down') s = Math.min(W / nw, H / nh);
    else return { x: 0, y: 0, w: W, h: H };
    var dw = nw * s; var dh = nh * s;
    var pos = cs.objectPosition.split(' ').map(function (p) { return p.indexOf('%') > -1 ? parseFloat(p) / 100 : 0.5; });
    return { x: (W - dw) * pos[0], y: (H - dh) * (pos.length > 1 ? pos[1] : 0.5), w: dw, h: dh };
  }
  function paintPic(img) {
    if (!img.complete || !img.naturalWidth) return;
    var W = img.clientWidth; var H = img.clientHeight;
    if (!W || !H) return;
    var c = cell();
    var src = img.currentSrc || img.src;
    if (!changed(img, [themeKey, W, H, c, src].join())) return;
    var w = Math.ceil(W / c); var h = Math.ceil(H / c);
    var col = colours(img.parentElement);
    var lum;
    try {
      var tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
      var tx = tmp.getContext('2d', { willReadFrequently: true });
      var bg = col.paper; tx.fillStyle = 'rgb(' + bg[0] + ',' + bg[1] + ',' + bg[2] + ')'; tx.fillRect(0, 0, w, h);
      var b = fitBox(img, W, H);
      tx.drawImage(img, b.x / c, b.y / c, b.w / c, b.h / c);
      lum = tx.getImageData(0, 0, w, h).data;
    } catch (e) { return; } // another origin's image: leave it as it is
    var light = inkIsLight(col);
    var v = new Float32Array(w * h);
    for (var i = 0; i < w * h; i += 1) {
      var l = (0.2126 * lum[i * 4] + 0.7152 * lum[i * 4 + 1] + 0.0722 * lum[i * 4 + 2]) / 255;
      v[i] = light ? l : 1 - l; // ink where it's dark, or where it's light on the dark theme
    }
    var out = new Uint8Array(w * h);
    var add = function (x, y, e) { if (x >= 0 && x < w && y < h) v[y * w + x] += e; };
    for (var y = 0; y < h; y += 1) for (var x = 0; x < w; x += 1) {
      var k = y * w + x; var bit = v[k] > 0.5 ? 1 : 0; out[k] = bit; var e = (v[k] - bit) / 8;
      add(x + 1, y, e); add(x + 2, y, e); add(x - 1, y + 1, e); add(x, y + 1, e); add(x + 1, y + 1, e); add(x, y + 2, e);
    }
    var cv = img.nextElementSibling && img.nextElementSibling.classList.contains('om-pic-dither') ? img.nextElementSibling : null;
    if (!cv) { cv = document.createElement('canvas'); cv.className = 'om-pic-dither'; cv.setAttribute('aria-hidden', 'true'); img.after(cv); }
    var drawn = bitmap(w, h, function (x2, y2) { return out[y2 * w + x2]; }, col, true);
    cv.width = w; cv.height = h; cv.getContext('2d').drawImage(drawn, 0, 0);
    // Inside the image's border, if it has one.
    var s = cv.style; s.left = (img.offsetLeft + img.clientLeft) + 'px'; s.top = (img.offsetTop + img.clientTop) + 'px'; s.width = W + 'px'; s.height = H + 'px';
    img.classList.add('is-dithered');
  }

  /* ---- the long shadow: cast at 45 degrees, thinning over 40 dots ---- */
  var REACH = 40;
  function paintCast(box) {
    var parent = box.offsetParent;
    if (!parent || !box.offsetWidth) return;
    var c = cell(); var bw = Math.ceil(box.offsetWidth / c); var bh = Math.ceil(box.offsetHeight / c);
    if (!changed(box, [themeKey, box.offsetLeft, box.offsetTop, bw, bh, c].join())) return;
    var cv = box.previousElementSibling && box.previousElementSibling.classList.contains('om-cast-shadow') ? box.previousElementSibling : null;
    if (!cv) { cv = document.createElement('canvas'); cv.className = 'om-cast-shadow'; cv.setAttribute('aria-hidden', 'true'); box.before(cv); }
    var w = bw + REACH; var h = bh + REACH;
    var drawn = bitmap(w, h, function (x, y) {
      for (var d = 1; d <= REACH; d += 1) {
        if (x - d >= 0 && x - d < bw && y - d >= 0 && y - d < bh) return on(0.75 * (1 - d / REACH), x, y);
      }
      return false;
    }, colours(box.parentElement), false);
    cv.width = w; cv.height = h; var ctx = cv.getContext('2d'); ctx.clearRect(0, 0, w, h); ctx.drawImage(drawn, 0, 0);
    // Snap to the --px grid, so the shadow's dots land on the ground's.
    var s = cv.style; s.left = Math.round(box.offsetLeft / c) * c + 'px'; s.top = Math.round(box.offsetTop / c) * c + 'px';
    s.width = (w * c) + 'px'; s.height = (h * c) + 'px';
    box.classList.add('is-cast'); // the CSS steps give way to this one
  }

  /* ---- the dock: a band while there's more to scroll ---- */
  function scrollerOf(el) {
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement || document.documentElement;
  }
  function moreBelow(dock) {
    var s = scrollerOf(dock);
    var seen = s === document.scrollingElement || s === document.documentElement ? window.innerHeight : s.clientHeight;
    return s.scrollTop + seen < s.scrollHeight - 2;
  }
  function paintDock(dock) {
    var band = dock.querySelector(':scope > .om-dock-band');
    if (!band) { band = document.createElement('canvas'); band.className = 'om-dock-band'; band.setAttribute('aria-hidden', 'true'); dock.prepend(band); }
    band.hidden = !moreBelow(dock);
    var c = cell(); var W = dock.clientWidth;
    if (!W || !changed(band, [themeKey, W, c].join())) return;
    var w = Math.ceil(W / c); var h = 12;
    // The page's colours, not the dock's: paper at the top, the dock's own colour at the bottom.
    var drawn = bitmap(w, h, function (x, y) { return on((y + 0.5) / h, x, y); }, colours(dock.parentElement), true);
    band.width = w; band.height = h; band.getContext('2d').drawImage(drawn, 0, 0);
    band.style.height = (h * c) + 'px';
  }
  function updateDocks() { document.querySelectorAll('.om-dock[data-more] > .om-dock-band').forEach(function (b) { b.hidden = !moreBelow(b.parentElement); }); }

  /* ---- the scheduler ---- */
  var SELECTOR = '.om-fill, .om-meter, .om-heat, .om-pic > img, .om-cast, .om-dock[data-more]';
  function draw(el) {
    if (el.matches('.om-fill')) paintFill(el);
    else if (el.matches('.om-meter')) paintMeter(el);
    else if (el.matches('.om-heat')) paintHeat(el);
    else if (el.matches('.om-pic > img')) paintPic(el);
    else if (el.matches('.om-cast')) paintCast(el);
    else if (el.matches('.om-dock[data-more]')) paintDock(el);
  }
  var queued = false; var ro = null;
  function all() {
    queued = false;
    document.querySelectorAll(SELECTOR).forEach(function (el) {
      if (ro && !el.__omWatched) { el.__omWatched = true; ro.observe(el); }
      draw(el);
    });
  }
  function soon() { if (!queued) { queued = true; requestAnimationFrame(all); } }

  var started = false;
  function start() {
    if (started) { soon(); return; }
    started = true;
    ro = window.ResizeObserver ? new ResizeObserver(soon) : null;
    var retheme = function () { themeKey += 1; soon(); };
    new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
    new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-values', 'data-more', 'src'] });
    document.addEventListener('load', function (e) { if (e.target && e.target.tagName === 'IMG') soon(); }, true);
    document.addEventListener('scroll', updateDocks, { capture: true, passive: true });
    addEventListener('resize', soon);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(soon);
    soon();
  }

  /* ---- pixelate: an SVG filter, one per running dissolve ---- */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var uid = 0;
  function pixelFilter() {
    var id = 'om-px-' + (uid += 1);
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.innerHTML = '<filter id="' + id + '" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' +
      '<feFlood x="0" y="0" width="1" height="1"/><feComposite width="2" height="2"/><feTile result="t"/>' +
      '<feComposite in="SourceGraphic" in2="t" operator="in"/><feMorphology operator="dilate" radius="1"/></filter>';
    document.body.appendChild(svg);
    var f = svg.firstChild;
    var flood = f.children[0]; var comp = f.children[1]; var dil = f.children[4];
    return {
      url: 'url(#' + id + ')',
      // block in CSS px: one sample at the middle of each block, grown to fill it
      set: function (b) {
        var half = Math.floor(b / 2);
        flood.setAttribute('x', half); flood.setAttribute('y', half);
        comp.setAttribute('width', b); comp.setAttribute('height', b);
        dil.setAttribute('radius', Math.max(half, b - half - 1));
      },
      remove: function () { svg.remove(); },
    };
  }

  function maskFrom(cv, el, w, h, c) {
    var u = 'url(' + cv.toDataURL() + ')';
    var s = el.style;
    s.webkitMaskImage = u; s.maskImage = u;
    s.webkitMaskSize = (w * c) + 'px ' + (h * c) + 'px'; s.maskSize = s.webkitMaskSize;
    s.webkitMaskRepeat = 'no-repeat'; s.maskRepeat = 'no-repeat';
  }
  function clearStyle(el) {
    var s = el.style;
    s.webkitMaskImage = s.maskImage = s.webkitMaskSize = s.maskSize = s.webkitMaskRepeat = s.maskRepeat = '';
    s.filter = ''; s.imageRendering = '';
  }

  // Runs step(p) with p from 0 to 1 (or 1 to 0 when out), in hard frames.
  function run(ms, frame, out, step) {
    return new Promise(function (done) {
      var t0 = performance.now();
      var lastFrame = -1;
      (function tick(now) {
        var k = clamp((now - t0) / ms);
        var n = Math.min(Math.floor(k * ms / frame), Math.floor(ms / frame));
        if (n !== lastFrame) { lastFrame = n; var p = Math.min(1, (n * frame) / ms); step(out ? 1 - p : p); }
        if (k < 1) requestAnimationFrame(tick); else { step(out ? 0 : 1); done(); }
      })(t0);
    });
  }

  function bayerMode(el, out) {
    var c = cell();
    var frames = out ? [12, 8, 4] : [4, 8, 12];
    var tile = document.createElement('canvas'); tile.width = 4; tile.height = 4;
    var tx = tile.getContext('2d');
    var s = el.style;
    s.imageRendering = 'pixelated';
    s.webkitMaskRepeat = s.maskRepeat = 'repeat';
    s.webkitMaskSize = s.maskSize = (4 * c) + 'px ' + (4 * c) + 'px';
    return new Promise(function (done) {
      var i = 0;
      (function next() {
        if (i === frames.length) { done(); return; }
        tx.clearRect(0, 0, 4, 4);
        for (var y = 0; y < 4; y += 1) for (var x = 0; x < 4; x += 1) if (bayer(x, y) < frames[i]) tx.fillRect(x, y, 1, 1);
        s.webkitMaskImage = s.maskImage = 'url(' + tile.toDataURL() + ')';
        i += 1;
        setTimeout(next, 50);
      })();
    });
  }

  // origin: where the line is, in cells.
  function hingeAt(origin, w) { return origin === 'left' ? 0 : origin === 'right' ? w : w / 2; }

  function spreadMode(el, out, origin) {
    var c = cell();
    var r = el.getBoundingClientRect();
    var w = Math.ceil(r.width / c); var h = Math.ceil(r.height / c);
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    var px = pixelFilter();
    var hinge = hingeAt(origin, w);
    var reach = Math.max(hinge, w - hinge, 1);
    el.style.imageRendering = 'pixelated';
    return run(360, 30, out, function (p) {
      var img = ctx.createImageData(w, h);
      for (var x = 0; x < w; x += 1) {
        var dist = clamp(Math.abs(x + 0.5 - hinge) / reach);
        var local = clamp((p - 0.6 * dist) / 0.4);
        for (var y = 0; y < h; y += 1) if (bayer(x, y) < local * 16) img.data[(y * w + x) * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      maskFrom(cv, el, w, h, c);
      // the shader shrinks blocks per column; here the whole box shrinks together
      var block = 1 + Math.round((1 - clamp(p * 1.4)) * 5);
      if (block > 1) { px.set(block * c); el.style.filter = px.url; } else el.style.filter = '';
    }).then(function () { px.remove(); });
  }

  function foldMode(el, out, origin) {
    var c = cell();
    var r = el.getBoundingClientRect();
    var w = Math.ceil(r.width / c); var h = Math.ceil(r.height / c);
    // The veil sits over the element, outside it, so the mosaic doesn't touch it.
    var veil = document.createElement('canvas'); veil.width = w; veil.height = h;
    veil.setAttribute('aria-hidden', 'true');
    var vs = veil.style;
    vs.position = 'fixed'; vs.left = r.left + 'px'; vs.top = r.top + 'px';
    vs.width = (w * c) + 'px'; vs.height = (h * c) + 'px';
    vs.pointerEvents = 'none'; vs.zIndex = 2147483000; vs.imageRendering = 'pixelated';
    document.body.appendChild(veil);
    var ctx = veil.getContext('2d');
    var dark = rgb(el, '--ink'); var light = rgb(el, '--paper');
    var px = pixelFilter();
    var hinge = hingeAt(origin === 'center' || !origin ? 'right' : origin, w);
    var edge = Math.max(hinge, w - hinge, 1);
    return run(560, 30, out, function (p) {
      var img = ctx.createImageData(w, h);
      var darkness = 1 - clamp(p * 2.4);
      var frostSum = 0;
      for (var x = 0; x < w; x += 1) {
        var strip = Math.floor(x / 4) * 4 + 2;
        var dist = clamp(Math.abs(hinge - strip) / edge);
        var local = clamp((p - 0.45 * dist) / 0.55);
        var frost = 1 - local * local * (3 - 2 * local);
        frostSum += frost;
        for (var y = 0; y < h; y += 1) {
          var th = bayer(x, y); var col = null;
          if (th < darkness * 16) col = dark;
          else if (th < frost * 16 * 0.55) col = light;
          if (col) img.data.set([col[0], col[1], col[2], 255], (y * w + x) * 4);
        }
      }
      ctx.putImageData(img, 0, 0);
      var block = 1 + Math.round((frostSum / w) * 7);
      if (block > 1) { px.set(block * c); el.style.filter = px.url; } else el.style.filter = '';
    }).then(function () { px.remove(); veil.remove(); });
  }

  function dissolve(el, opts) {
    opts = opts || {};
    var out = !!opts.out;
    if (reduced()) { el.hidden = out; return Promise.resolve(); }
    el.hidden = false;
    var mode = opts.mode || 'bayer';
    var go = mode === 'spread' ? spreadMode(el, out, opts.origin)
      : mode === 'fold' ? foldMode(el, out, opts.origin)
      : bayerMode(el, out);
    return go.then(function () { clearStyle(el); if (out) el.hidden = true; });
  }

  window.OmakoDither = { start: start, dissolve: dissolve, paint: paint, paintFill: paintFill, BAYER: BAYER };
})();
