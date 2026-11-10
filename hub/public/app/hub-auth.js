// app/hub-auth.js: how a page talks to the hub without putting the token in a
// URL. Loaded as a plain script by the app and the office, before their own
// code. A URL ends up in history, in proxy logs and in Referer headers; a header
// does not.
//
// Two things a browser will not send a header for:
// - the event stream: EventSource trades the token for a one-use ticket;
// - images: fetched with the header and shown from a blob: URL. Markup says
//   data-secure-src (an <img>) or data-secure-href (an <a>), and this file
//   does the rest, whenever the element reaches the page.
(function () {
  'use strict';

  var token = function () {
    try { return localStorage.getItem('bureau_token') || ''; } catch (e) { return ''; }
  };
  var auth = function () { return { authorization: 'Bearer ' + token() }; };

  // A token handed over in a link: the fragment never reaches the hub or a log.
  function takeUrlToken() {
    var m = /[#&]token=([^&]*)/.exec(location.hash);
    if (!m) return '';
    var value = '';
    try { value = decodeURIComponent(m[1]); } catch (e) { return ''; }
    try { localStorage.setItem('bureau_token', value); } catch (e) { /* the caller still has it */ }
    history.replaceState(null, '', location.pathname + location.search);
    return value;
  }

  // Each connection takes a new ticket, so the browser's own retry cannot be
  // used: it would replay a spent one. opts.wire(es) adds the listeners,
  // opts.up() and opts.down() report the connection.
  function events(opts) {
    var current = null;
    function retry() {
      if (opts.down) opts.down();
      setTimeout(connect, 3000);
    }
    function connect() {
      fetch('/api/events/ticket', { method: 'POST', headers: auth() }).then(function (r) {
        if (!r.ok) throw new Error('ticket refused: ' + r.status);
        return r.json();
      }).then(function (t) {
        var es = new EventSource('/api/events?ticket=' + encodeURIComponent(t.ticket));
        current = es;
        es.onopen = function () { if (opts.up) opts.up(); };
        es.onerror = function () { es.close(); retry(); };
        opts.wire(es);
      }).catch(retry);
    }
    // A page kept for the Back button would hold its stream open, and a browser
    // gives a host six connections: a few page loads and the next one stalls.
    window.addEventListener('pagehide', function () {
      if (current) current.close();
      current = null;
    });
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) connect();
    });
    connect();
  }

  // Where a brain or work store image is served from. A malformed %-escape in
  // an artifact stays that artifact's problem.
  function imageUrl(img) {
    var file = img;
    try { file = decodeURIComponent(img); } catch (e) { /* use it as written */ }
    return '/api/' + (/^work\//.test(file) ? 'work' : 'knowledge') + '?file=' + encodeURIComponent(file) + '&raw=1';
  }

  var MAX_CACHED = 200;
  var blobs = new Map(); // url -> Promise of a blob: URL, oldest first
  function blobFor(url) {
    if (blobs.has(url)) return blobs.get(url);
    var p = fetch(url, { headers: auth() }).then(function (r) {
      if (!r.ok) throw new Error('image refused: ' + r.status);
      return r.blob();
    }).then(function (b) { return URL.createObjectURL(b); });
    p.catch(function () { blobs.delete(url); });
    blobs.set(url, p);
    while (blobs.size > MAX_CACHED) {
      var oldest = blobs.keys().next().value;
      blobs.get(oldest).then(URL.revokeObjectURL, function () {});
      blobs.delete(oldest);
    }
    return p;
  }
  function load(el, attr, target) {
    var url = el.getAttribute(attr);
    el.removeAttribute(attr);
    blobFor(url).then(function (blob) { el[target] = blob; }, function () { /* the alt text stays */ });
  }
  function scan(root) {
    if (!root.querySelectorAll) return;
    if (root.matches('img[data-secure-src]')) load(root, 'data-secure-src', 'src');
    if (root.matches('a[data-secure-href]')) load(root, 'data-secure-href', 'href');
    root.querySelectorAll('img[data-secure-src]').forEach(function (el) { load(el, 'data-secure-src', 'src'); });
    root.querySelectorAll('a[data-secure-href]').forEach(function (el) { load(el, 'data-secure-href', 'href'); });
  }
  new MutationObserver(function (records) {
    records.forEach(function (r) { r.addedNodes.forEach(scan); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.BureauHub = { events: events, imageUrl: imageUrl, takeUrlToken: takeUrlToken };
})();
