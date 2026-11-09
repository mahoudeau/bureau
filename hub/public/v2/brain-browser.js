// v2/brain-browser.js — t-71 (goal: t-53). Owns #v2-brain-panel only.
// Turns "brain, recent commits" into an actual browser: a file tree (built
// client-side from the one flat recursive listing GET /api/knowledge
// already returns — there is no shallow per-directory endpoint, so this
// file fetches the full path list once, caches it, and does the
// tree-shaping itself) plus a click-to-read pane with a hand-rolled
// markdown renderer (headings, lists, bold, links only — no CDN library,
// no external request; anything else in the source degrades to plain
// text rather than breaking). Strictly read-only: no write/edit affordance
// anywhere in this file.
//
// Listens: 'v2:brain:open' { file? } — the brain-entry button in the rail
// (wired in v2.html) and, later, search.js's brain-content hits emit this;
// { file } jumps straight to that file's rendered view, otherwise the tree
// opens. Same drill-down (tree view <-> file view, toggled by a back
// button) at every width, not just phone — the panel itself is already
// narrow like a phone drawer even on desktop, so one behavior everywhere
// is simpler and still satisfies "usable at phone width" (see closing
// note on the mission for the reasoning).
(function () {
  'use strict';

  function ready(cb) {
    if (window.BureauV2 && window.BureauV2.state) return cb();
    var off = window.BureauV2 ? window.BureauV2.on('v2:ready', function () { off(); cb(); }) : null;
    if (!window.BureauV2) {
      document.addEventListener('DOMContentLoaded', function poll() {
        if (window.BureauV2) { ready(cb); } else { setTimeout(poll, 50); }
      });
    }
  }

  ready(init);

  function init() {
    var V2 = window.BureauV2;
    var panel = V2.mounts.brainPanel;
    if (!panel) return;

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    var treeCache = null; // flat path[] from the hub, fetched once and reused
    var openPath = null;

    V2.on('v2:brain:open', function (detail) {
      panel.hidden = false;
      if (detail && detail.file) { openFile(detail.file); } else { openTree(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) panel.hidden = true;
    });

    function ensureFiles() {
      if (treeCache) return Promise.resolve(treeCache);
      return V2.api('/api/knowledge').then(function (r) {
        treeCache = (r && r.files) || [];
        return treeCache;
      });
    }

    // Build a nested {name, path, type, children} tree from the flat,
    // fully-recursive path list the hub returns (dirs are not first-class
    // there, only files with '/'-joined relative paths).
    function buildTree(paths) {
      var root = { name: '', path: '', type: 'dir', children: [] };
      paths.forEach(function (p) {
        var parts = p.split('/');
        var node = root;
        parts.forEach(function (part, i) {
          var isFile = i === parts.length - 1;
          if (isFile) { node.children.push({ name: part, path: p, type: 'file' }); return; }
          var dir = node.children.filter(function (c) { return c.type === 'dir'; }).find(function (c) { return c.name === part; });
          if (!dir) { dir = { name: part, path: parts.slice(0, i + 1).join('/'), type: 'dir', children: [] }; node.children.push(dir); }
          node = dir;
        });
      });
      sortTree(root);
      return root;
    }
    function sortTree(node) {
      node.children.sort(function (a, b) {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(function (c) { if (c.type === 'dir') sortTree(c); });
    }

    var expanded = {}; // path -> bool, persists across re-renders within a session

    function renderTreeNode(node, depth) {
      if (node.type === 'file') {
        return '<div class="v2-brain-tree__row v2-brain-tree__row--file" data-file="' + esc(node.path) + '" style="padding-left:' + (depth * 14) + 'px">' + esc(node.name) + '</div>';
      }
      var isRoot = node.path === '';
      var open = isRoot || !!expanded[node.path];
      var html = isRoot ? '' : '<div class="v2-brain-tree__row v2-brain-tree__row--dir" data-dir="' + esc(node.path) + '" style="padding-left:' + (depth * 14) + 'px">' + (open ? '▾ ' : '▸ ') + esc(node.name) + '</div>';
      if (open) html += node.children.map(function (c) { return renderTreeNode(c, isRoot ? depth : depth + 1); }).join('');
      return html;
    }

    function openTree() {
      openPath = null;
      panel.innerHTML = '<button type="button" class="v2-brain-close" id="v2-brain-close" aria-label="Close">✕</button>' +
        '<h3 class="v2-brain-title">Brain</h3>' +
        '<div class="v2-brain-tree" id="v2-brain-tree"><div class="v2-empty">Loading…</div></div>';
      wireClose();
      ensureFiles().then(function (files) {
        var tree = buildTree(files);
        renderTree(tree);
      });
    }

    function renderTree(tree) {
      var el = document.getElementById('v2-brain-tree');
      if (!el) return;
      el.innerHTML = tree.children.length ? renderTreeNode(tree, 0) : '<div class="v2-empty">Nothing in the brain yet.</div>';
      el.querySelectorAll('[data-dir]').forEach(function (row) {
        row.addEventListener('click', function () {
          var p = row.getAttribute('data-dir');
          expanded[p] = !expanded[p];
          renderTree(tree);
        });
      });
      el.querySelectorAll('[data-file]').forEach(function (row) {
        row.addEventListener('click', function () { openFile(row.getAttribute('data-file')); });
      });
    }

    function openFile(path) {
      openPath = path;
      panel.innerHTML = '<button type="button" class="v2-brain-close" id="v2-brain-close" aria-label="Close">✕</button>' +
        '<button type="button" class="v2-brain-back" id="v2-brain-back">← Brain</button>' +
        '<h3 class="v2-brain-title">' + esc(path) + '</h3>' +
        '<div class="v2-brain-file" id="v2-brain-file"><div class="v2-empty">Loading…</div></div>';
      wireClose();
      document.getElementById('v2-brain-back').addEventListener('click', openTree);
      V2.api('/api/knowledge?file=' + encodeURIComponent(path)).then(function (r) {
        var body = document.getElementById('v2-brain-file');
        if (!body || openPath !== path) return; // a newer open superseded this fetch
        if (!r || r.content === undefined) { body.innerHTML = '<div class="v2-empty">Could not read this file.</div>'; return; }
        if (r.content_base64 !== undefined) { body.innerHTML = '<div class="v2-empty">Binary file — not previewable here.</div>'; return; }
        body.innerHTML = path.toLowerCase().endsWith('.md') ? renderMarkdown(r.content) : '<pre class="v2-brain-plain">' + esc(r.content) + '</pre>';
        body.querySelectorAll('a[data-brain-link]').forEach(function (a) {
          a.addEventListener('click', function (e) { e.preventDefault(); openFile(a.getAttribute('data-brain-link')); });
        });
      });
    }

    function wireClose() {
      var btn = document.getElementById('v2-brain-close');
      if (btn) btn.addEventListener('click', function () { panel.hidden = true; });
    }

    // ---- hand-rolled markdown: headings, lists, bold, links only. ----
    // Every line goes through inline(), which escapes it first and applies
    // the markdown patterns to the escaped text, so brain content can never
    // inject markup. Anything not recognized here is left as an ordinary
    // paragraph line (degrades to plain text, never throws).
    function renderMarkdown(raw) {
      var body = raw;
      var meta = null;
      var fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
      if (fm) {
        meta = fm[1].split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return esc(l); }).join(' · ');
        body = body.slice(fm[0].length);
      }
      var lines = body.replace(/\r\n/g, '\n').split('\n');
      var html = [];
      var listBuf = [];
      var listTag = null;
      function flushList() {
        if (!listBuf.length) return;
        html.push('<' + listTag + '>' + listBuf.map(function (li) { return '<li>' + inline(li) + '</li>'; }).join('') + '</' + listTag + '>');
        listBuf = []; listTag = null;
      }
      lines.forEach(function (line) {
        var h = /^(#{1,6})\s+(.*)$/.exec(line);
        if (h) { flushList(); html.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); return; }
        var ul = /^\s*[-*+]\s+(.*)$/.exec(line);
        if (ul) { if (listTag && listTag !== 'ul') flushList(); listTag = 'ul'; listBuf.push(ul[1]); return; }
        var ol = /^\s*\d+\.\s+(.*)$/.exec(line);
        if (ol) { if (listTag && listTag !== 'ol') flushList(); listTag = 'ol'; listBuf.push(ol[1]); return; }
        flushList();
        if (!line.trim()) return; // blank line: paragraph break, nothing to render
        html.push('<p>' + inline(line) + '</p>');
      });
      flushList();
      return (meta ? '<div class="v2-brain-meta">' + meta + '</div>' : '') + html.join('');
    }
    // Bold (**x** or __x__) and links ([text](url)), on a line escaped here
    // first. A relative .md path becomes an in-browser jump (data-brain-link);
    // an absolute http(s) URL becomes a normal new-tab link, never an
    // auto-fetch. Any other target (javascript:, data:) stays plain text.
    function inline(line) {
      var links = [];
      var bold = function (t) { return t.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>'); };
      // Links are set aside while bold runs, so a __ inside a URL stays in the URL
      var s = replaceLinks(esc(String(line).replace(/\u0000/g, '')), function (text, url) {
        var a;
        if (/^https?:\/\//i.test(url)) a = '<a href="' + url + '" target="_blank" rel="noopener">' + bold(text) + '</a>';
        else if (/\.md$/i.test(url)) a = '<a href="#" data-brain-link="' + url.replace(/^\.?\//, '') + '">' + bold(text) + '</a>';
        else return text; // unrecognized link target: degrade to plain text, per the bar
        links.push(a);
        return '\u0000' + (links.length - 1) + '\u0000';
      });
      s = bold(s);
      return s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return links[+i]; });
    }
    // [text](url), with neither part empty. A scan, not a regex: a long run
    // of [ with one distant ] would make a regex retry from every bracket.
    function replaceLinks(s, make) {
      var out = '', at = 0, close = -1;
      for (;;) {
        var open = s.indexOf('[', at);
        if (open === -1) break;
        if (close <= open) close = s.indexOf(']', open + 1);
        if (close === -1) break;
        var end = s[close + 1] === '(' ? s.indexOf(')', close + 2) : -1;
        if (close === open + 1 || end === -1 || end === close + 2) {
          out += s.slice(at, open + 1);
          at = open + 1;
          continue;
        }
        out += s.slice(at, open) + make(s.slice(open + 1, close), s.slice(close + 2, end));
        at = end + 1;
      }
      return out + s.slice(at);
    }
  }
})();
