// site/faq.js: the search over the questions on /inside.
// The questions are plain <details> in the page (search engines and
// screen readers read them as they are); this only filters them. Typing
// hides what doesn't match, opens what does and marks the words.
(function () {
  'use strict';
  var input = document.getElementById('faq-q');
  if (!input) return;
  var items = Array.prototype.slice.call(document.querySelectorAll('.faq details'));
  var groups = Array.prototype.slice.call(document.querySelectorAll('.faq-group'));
  var count = document.getElementById('faq-count'), empty = document.getElementById('faq-empty');
  // The original text of every question and answer, so marks never pile up.
  var orig = items.map(function (d) { return d.innerHTML; });
  var plain = items.map(function (d) { return norm(d.textContent); });

  function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Wrap matches in <mark>, in text nodes only (links and tags stay whole).
  function mark(el, words) {
    var re = new RegExp('(' + words.map(escRe).join('|') + ')', 'gi');
    var walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    nodes.forEach(function (n) {
      if (!re.test(n.nodeValue)) return;
      re.lastIndex = 0;
      var frag = document.createDocumentFragment(), last = 0, m;
      while ((m = re.exec(n.nodeValue))) {
        frag.appendChild(document.createTextNode(n.nodeValue.slice(last, m.index)));
        var mk = document.createElement('mark'); mk.textContent = m[0]; frag.appendChild(mk);
        last = m.index + m[0].length;
      }
      frag.appendChild(document.createTextNode(n.nodeValue.slice(last)));
      n.parentNode.replaceChild(frag, n);
    });
  }

  function run() {
    var q = norm(input.value.trim()), words = q.split(/\s+/).filter(function (w) { return w.length > 1; });
    var shown = 0;
    items.forEach(function (d, i) {
      d.innerHTML = orig[i];
      // every word has to appear somewhere in the question or its answer
      var hit = !words.length || words.every(function (w) { return plain[i].indexOf(w) >= 0; });
      d.hidden = !hit;
      if (hit) shown++;
      if (words.length && hit) { d.open = true; mark(d, words); }
      else if (!words.length) d.open = false;
    });
    groups.forEach(function (g) { g.hidden = !g.querySelector('details:not([hidden])'); });
    empty.hidden = shown > 0;
    count.textContent = words.length ? shown + (shown === 1 ? ' question' : ' questions') : items.length + ' questions';
    if (words.length) keepFirstInView();
  }
  // Filtering shortens the list, so the first result can end up above or
  // below the screen. Bring its group heading back just under the search bar.
  var bar = document.querySelector('.faq-search');
  function keepFirstInView() {
    var first = items.filter(function (d) { return !d.hidden; })[0];
    var target = first ? first.closest('.faq-group').querySelector('h3') : empty;
    var top = bar.getBoundingClientRect().bottom + 8, r = target.getBoundingClientRect();
    if (r.top >= top && r.top <= innerHeight * 0.6) return; // already in sight
    scrollBy({ top: r.top - top, behavior: 'instant' });
  }
  input.addEventListener('input', run);
  // Escape clears the search; Enter jumps to the first match.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && input.value) { input.value = ''; run(); }
    if (e.key === 'Enter') {
      var first = items.filter(function (d) { return !d.hidden; })[0];
      if (first) { e.preventDefault(); first.querySelector('summary').focus(); }
    }
  });
  // A link to one question (/inside#who-is-it-for) opens it.
  function openFromHash() {
    var d = location.hash && document.getElementById(location.hash.slice(1));
    if (d && d.tagName === 'DETAILS') d.open = true;
  }
  addEventListener('hashchange', openFromHash);
  openFromHash();
  run();
})();
