/* Bureau, the real thing: the little life on the landing page.
   Agents turning on their LCD tiles, the spinning star with the live count
   and "star without leaving", and the waitlist form. */
(function () {
  'use strict';
  var A = window.OfficeAssets, $ = function (id) { return document.getElementById(id); };
  var REPO = 'https://github.com/mahoudeau/bureau';
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DMG = A.PALETTES.dmg.shades;

  // ---- agents on their tiles, turning like a character select ----
  var FACES = ['front', 'right', 'back', 'left'];
  var tiles = [].map.call(document.querySelectorAll('.sprite-tile'), function (el, n) {
    var cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
    el.appendChild(cv);
    return { cv: cv, head: el.getAttribute('data-head'), body: el.getAttribute('data-body'), phase: n * 3 };
  });
  function drawTile(t, step) {
    var face = REDUCED ? 'front' : FACES[(step + t.phase) % 4];
    var key = A.assemble(t.head, t.body, face, 0) || A.assemble('h1', 'b1', face, 0);
    var c = t.cv.getContext('2d');
    c.clearRect(0, 0, 16, 16);
    if (key) c.drawImage(A.sprite(key, 'dmg'), 0, 0);
  }

  // ---- the star ----
  var frames = [];
  for (var fi = 0; fi < 8; fi++) frames.push(BureauStar.make(DMG, fi));
  var big = $('star-big').getContext('2d'), mini = document.querySelector('.mini-star').getContext('2d');
  mini.drawImage(frames[0], 0, 0);
  var fast = false, btn = $('star-btn');
  btn.addEventListener('pointerenter', function () { fast = true; });
  btn.addEventListener('pointerleave', function () { fast = false; });

  function tick(t) {
    var f = REDUCED ? 0 : Math.floor(t / (fast ? 90 : 190)) % 8;
    big.clearRect(0, 0, BureauStar.N, BureauStar.N);
    big.drawImage(frames[f], 0, 0);
    var step = Math.floor(t / 900);
    if (step !== tick.step) { tick.step = step; tiles.forEach(function (tl) { drawTile(tl, step); }); }
    if (!REDUCED) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  var starApp = false;
  function setCount(n) {
    $('star-n').textContent = n;
    $('star-word').textContent = n === 1 ? 'star' : 'stars';
  }
  fetch('/api/stars').then(function (r) { return r.json(); }).then(function (j) {
    if (typeof j.count === 'number') setCount(j.count);
    starApp = !!j.starApp;
    if (!starApp) $('star-note').textContent = 'Opens the repo on GitHub, one more click there.';
  }).catch(function () {});
  function burst() { btn.classList.remove('collected'); void btn.offsetWidth; btn.classList.add('collected'); }
  // Level 2: star without leaving, through a GitHub App that can only star.
  // Level 1 fallback: open the repo.
  btn.addEventListener('click', function () {
    if (!starApp) { window.open(REPO, '_blank', 'noopener'); burst(); return; }
    var w = window.open('/api/github/login', 'bureau-star', 'width=520,height=680');
    if (!w) { window.open(REPO, '_blank', 'noopener'); burst(); }
  });
  addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.bureauStar === undefined) return;
    var r = e.data.bureauStar;
    if (typeof e.data.count === 'number') setCount(e.data.count); // the server's true count, never a local +1
    if (r === 'ok' || r === 'already') {
      burst();
      $('star-note').textContent = r === 'already' ? 'Already starred. Thank you.' : 'Starred. Thank you.';
    } else window.open(REPO, '_blank', 'noopener');
  });

  // ---- the waitlist ----
  var form = $('join-form'), msg = $('join-msg'), go = form.querySelector('[type="submit"]');
  var pick = function (k) { var b = form.querySelector('[data-name="' + k + '"] [aria-pressed="true"]'); return b ? b.getAttribute('data-v') : ''; };
  function ready() {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.value.trim()) && pick('use') && pick('role') && pick('interest') && form.consent.checked;
  }
  function refresh() { go.disabled = !ready(); }
  form.querySelectorAll('fieldset').forEach(function (fs) {
    fs.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        fs.querySelectorAll('button').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        refresh();
      });
    });
  });
  form.email.addEventListener('input', refresh);
  form.consent.addEventListener('change', refresh);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!ready()) return;
    var body = { email: form.email.value.trim(), use: pick('use'), role: pick('role'), interest: pick('interest'), consent: true, website: form.website.value, source: 'inside' };
    msg.className = 'msg'; msg.textContent = 'Saving...'; go.disabled = true;
    fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'failed'); return j; }); })
      .then(function (j) {
        msg.className = 'msg ok';
        msg.textContent = 'Saved. Slot #' + String(j.slot).padStart(3, '0') + '.';
        form.querySelectorAll('input, fieldset button').forEach(function (el) { el.disabled = true; });
      })
      .catch(function (err) { msg.textContent = err.message === 'failed' ? 'Could not save. Try again in a moment.' : err.message; refresh(); });
  });
})();
