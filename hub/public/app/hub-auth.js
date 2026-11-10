// app/hub-auth.js: how a page talks to the hub without putting the token in a
// URL. Loaded as a plain script by the app and the office, before their own
// code. A URL ends up in history, in proxy logs and in Referer headers; a header
// does not.
//
// Two things a browser will not send a header for:
// - the event stream: EventSource trades the token for a one-use ticket;
// - images: fetched with the header and shown from a local URL, blob: or data:
//   by what the file can do. Markup says data-secure-src (an <img>) or
//   data-secure-href (an <a>), and this file does the rest, whenever the element
//   reaches the page.
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
  // opts.up() and opts.down() report the connection, and opts.ended() says the
  // session is over.
  //
  // A browser gives a host six connections over HTTP/1.1, and the Desk holds two
  // streams on its own (the app and the office frame). So only a tab someone is
  // looking at keeps one: hidden closes it, shown takes a new one, and down then
  // up tells the page to catch up on what it missed.
  function events(opts) {
    var current = null;
    var refused = false;
    var asking = false; // a ticket is on its way
    var waiting = null; // the retry timer
    var attempt = 0; // a pause or a newer try disowns whatever is in flight

    function halt() {
      var active = current || asking || waiting;
      attempt++;
      asking = false;
      clearTimeout(waiting);
      waiting = null;
      if (current) current.close();
      current = null;
      return active;
    }
    function pause() {
      if (halt() && opts.down) opts.down();
    }
    function retry() {
      if (opts.down) opts.down();
      if (!document.hidden) waiting = setTimeout(connect, 3000);
    }
    function connect() {
      waiting = null;
      if (refused || current || asking || document.hidden) return;
      var mine = ++attempt;
      asking = true;
      fetch('/api/events/ticket', { method: 'POST', headers: auth() }).then(function (r) {
        if (mine !== attempt) return null;
        asking = false;
        // The token is no good any more. Nothing here will bring it back.
        if (r.status === 401) {
          refused = true;
          if (opts.ended) opts.ended();
          return null;
        }
        // 403 is an answer, not an outage: a token scoped to some projects gets
        // no stream, by design. Asking again every 3 seconds won't change it.
        if (r.status === 403) {
          refused = true;
          if (opts.down) opts.down();
          return null;
        }
        if (!r.ok) throw new Error('ticket refused: ' + r.status);
        return r.json();
      }).then(function (t) {
        if (!t || mine !== attempt) return;
        var es = new EventSource('/api/events?ticket=' + encodeURIComponent(t.ticket));
        current = es;
        es.onopen = function () { if (opts.up) opts.up(); };
        es.onerror = function () {
          es.close();
          if (current !== es) return;
          current = null;
          retry();
        };
        opts.wire(es);
      }).catch(function () {
        if (mine !== attempt) return;
        asking = false;
        retry();
      });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
      else connect();
    });
    // A page kept for the Back button would hold its stream open too.
    window.addEventListener('pagehide', pause);
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

  // A document opened from a blob: URL runs on the hub's origin and can read the
  // token. So only types that can't carry script ever get one: these and no
  // others. Everything goes through urlFor, and nothing else makes a blob: URL
  // from the hub's bytes.
  var BLOB_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];

  function dataUrl(blob, type) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        resolve('data:' + type + ';base64,' + text.slice(text.indexOf(',') + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // The URL to show these bytes under, or null when they can't be shown safely.
  // An SVG goes in a data: URL: <img> won't run its script, and a data: document
  // has no origin to steal from. A download of anything else is octet-stream
  // data, which a browser saves and never renders.
  function urlFor(blob, saving) {
    var type = (blob.type || '').split(';')[0].trim().toLowerCase();
    if (BLOB_TYPES.indexOf(type) !== -1) return URL.createObjectURL(new Blob([blob], { type: type }));
    if (saving) return dataUrl(blob, 'application/octet-stream');
    if (type === 'image/svg+xml') return dataUrl(blob, type);
    return null;
  }

  var MAX_CACHED = 200;
  var blobs = new Map(); // url -> Promise of a URL to show it under, oldest first
  function shownUrl(url, saving) {
    var key = (saving ? 'save:' : 'show:') + url;
    if (blobs.has(key)) return blobs.get(key);
    var p = fetch(url, { headers: auth() }).then(function (r) {
      if (!r.ok) throw new Error('image refused: ' + r.status);
      return r.blob();
    }).then(function (b) { return urlFor(b, saving); });
    p.catch(function () { blobs.delete(key); });
    blobs.set(key, p);
    while (blobs.size > MAX_CACHED) {
      var oldest = blobs.keys().next().value;
      blobs.get(oldest).then(function (u) { if (u && u.indexOf('blob:') === 0) URL.revokeObjectURL(u); }, function () {});
      blobs.delete(oldest);
    }
    return p;
  }
  function fileNameIn(url) {
    var file = new URL(url, location.href).searchParams.get('file') || '';
    return file.slice(file.lastIndexOf('/') + 1);
  }
  function load(el, attr, target) {
    var url = el.getAttribute(attr);
    var saving = el.hasAttribute('download');
    el.removeAttribute(attr);
    shownUrl(url, saving).then(function (shown) {
      if (!shown) return; // the alt text stays, and a link stays inert
      // A browser won't open a data: URL in a tab, so the click saves it instead
      // of leaving a blank one.
      if (target === 'href' && shown.indexOf('data:') === 0 && !saving) el.setAttribute('download', fileNameIn(url));
      el[target] = shown;
    }, function () { /* the alt text stays */ });
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
