// v2/palette.js — t-65 (goal: t-53). Owns #v2-palette. The cmd-K surface:
// jump to a mission by id/title, filter by project (token-pill pattern,
// close kin to Screenshot-2024-08-03-at-16.25.37.png), and a quick-add
// entry point when the query matches nothing. keyboard.js owns the global
// Cmd/Ctrl+K binding and emits 'v2:palette:open'; this file only reacts to
// that event and its own internal nav once open.
//
// Non-modal: no backdrop, no <dialog>, no prompt(). Closes on Escape,
// on selecting a result, or on an outside click — all standard combobox
// dismissal, not modal chrome.
//
// Rendering is split into buildShell() (runs once per open — creates the
// <input> and mounts its 'input' listener) and renderResults() (runs on
// every keystroke — only replaces the pills+results containers below the
// input). An earlier version rebuilt the whole palette, INCLUDING the
// input element itself, via one innerHTML swap inside the input's own
// 'input' handler — that destroys and recreates the element the browser
// is mid-keystroke on, so typing past the first character lost focus and
// silently stopped filtering (found by a critic actually typing a
// multi-character query, not by a synthetic single .value assignment).
// The <input> node is now created once per open and never replaced while
// the palette stays open. The new compose block below (body/attachments)
// lives in that same once-per-open tier — never rebuilt by renderResults()
// — so a typed body or a pasted image survives every keystroke's re-render
// exactly like the input's own focus already did.
//
// Round 4 (this mission's own reference-must-win loop): three literal
// Unicode symbols were standing in for icons here — '⌨' (U+2328 KEYBOARD)
// on the hint trigger, '✕' (U+2715) on the active-project pill's remove
// button, and '↑'/'↓' (U+2191/2193) inside the hint's own <kbd> pair. The
// boss caught the first of these directly on this mission's screenshots
// ("I see emojis in available screenshots while we agreed on an icon
// library"); the sibling t-89 sweep mission explicitly carves this whole
// file out of its own scope with "t-65 is handling its own fix as part of
// its own loop" — this is that fix, applied to all three, not just the
// one the boss happened to name, since the same floor ("a real icon set,
// no emoji") governs all of them identically. Swapped for t-66's vendored
// Lucide set: `icon('command')` for the hint trigger (no dedicated
// "keyboard" shape exists in the 30-icon vendored set; `command` is the
// established glyph this codebase already uses for keyboard-triggered
// affordances), `icon('x')` for the pill remove button (an exact semantic
// match — the vendored set's own 'x' icon), `icon('chevron-up')` /
// `icon('chevron-down')` for the up/down key hints (no dedicated arrow-key
// shape exists either; chevrons are the standard substitute for this exact
// purpose in the cited Linear-register reference material).
//
// t-132: two changes.
//
// 1. BUG FIX — root cause of "the create button does nothing": createMission()
// fell back to a HARDCODED literal project id, 'general', whenever no pill
// was pinned. That id is not a protocol guarantee — it was only ever the
// store's own empty-state seed (hub/lib/store.js EMPTY.projects) — and this
// hub's live project registry has since been curated down to real projects
// only (verified live: GET /api/projects on the served hub returns
// allmiibo-sync/bureau/dungeon-storyteller/job-hunt/jobs-platform/Test/
// trace-bingo/ziip — no 'general' entry). POST /api/tasks 400s on an
// unregistered project (server.js's own registry guard), and this file's
// old `.then(function (r) { if (!r || r.error) return; ...})` silently
// discarded that error — no toast, no console line, no visible state
// change. Click the row, nothing happens: reproduced exactly as reported,
// confirmed via a scratch instance with 'general' deleted (see this
// mission's log for the repro transcript). Two-part real fix, not a
// band-aid re-adding 'general': (a) the create path never again assumes a
// specific id exists — it resolves the same default the board's own
// quick-add `<select>` arrives at implicitly (first project id,
// alphabetically, see defaultProjectId() below and board.js's own
// `ids.sort()` convention for the identical `<option>` list), so it tracks
// whatever the registry actually contains; (b) every API failure on this
// path — this class and any other (a dropped connection, a future 500) —
// now surfaces inline in the palette via a real, visible error message
// instead of vanishing. The create row's own label also now always names
// its destination project (previously only shown when a pill was
// active), so the resolved default is never a silent surprise either.
//
// 2. FEATURE — the palette's create flow now takes an optional body and one
// or more images (paste from clipboard, or a file-picker button for touch),
// via the new compose block built once in buildShell(). Images are
// normalized client-side through a canvas round-trip (normalizeImage()) —
// this both re-encodes anything the picker/clipboard hands back into a
// format the brain's attachment whitelist accepts (hub/lib/knowledge.js
// safePath()) and downscales/re-compresses on a loop until the result
// clears the same 5MB decoded cap that route enforces server-side
// (MAX_ATTACHMENT below mirrors hub/lib/knowledge.js's own constant); an
// image that still can't clear the cap is refused with a clear inline
// message, never silently dropped. On submit: one POST /api/tasks, then
// each normalized image is written to the brain via POST /api/knowledge
// (encoding:'base64', mode:'replace', path projects/<project>/references/
// <task-id>-<n>.<ext>) and registered on the new mission with a PATCH
// /api/tasks/<id> artifact — the same mechanism media.js's Media section
// already reads (its artImg() matches a bare projects/.../*.png path
// directly), so attached images show up there immediately, no extra
// wiring. Images upload sequentially, not in parallel: knowledge.js's
// writes shell out to `git commit` against one repo working tree
// (hub/lib/knowledge.js git()), and concurrent commits there would race.
// The original fast path — type a title, hit Enter, done — is untouched:
// with no body typed and no image pasted, submit is still exactly one
// POST, so the t-53 keyboard-only timed floor (<15s, no images) doesn't
// pay for any of this.
import { icon } from './components.js';

(function () {
  'use strict';

  function ready(cb) {
    if (window.BureauV2) return cb();
    document.addEventListener('DOMContentLoaded', function poll() {
      if (window.BureauV2) cb(); else setTimeout(poll, 50);
    });
  }

  ready(init);

  // Mirrors hub/lib/knowledge.js's own MAX_ATTACHMENT (5MB decoded) — kept
  // as a literal, not fetched, since the cap is a protocol constant, not
  // live server state.
  var MAX_ATTACHMENT = 5 * 1024 * 1024;

  function init() {
    var V2 = window.BureauV2;
    var palette = V2.mounts.palette;
    if (!palette) return;
    injectStyle();

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    var activeProject = null;
    var selectedIndex = 0;
    var lastRows = []; // { kind: 'mission'|'create', id?, ... }
    var inputEl = null;
    var pillsEl = null;
    var resultsEl = null;
    var bodyEl = null;
    var thumbsEl = null;
    var errEl = null;
    var attachBtn = null;
    var fileInput = null;
    var submitBtn = null;

    var pendingImages = []; // { id, blob, ext, name, previewUrl }
    var pendingSeq = 0;
    var creating = false;
    // Bumped by every open()/close(). createMission() snapshots this before
    // its async POST/attach chain and checks it again in every completion
    // branch before touching `creating`, the compose DOM, or calling
    // close() — otherwise a submit started in one open/close session that
    // resolves after the user has already closed and reopened the palette
    // (a perfectly ordinary Escape-then-Cmd-K-again sequence, well within
    // normal network latency) would silently close the NEW session out
    // from under the user and leave `creating` permanently stuck true,
    // relocating this mission's own bug class rather than fixing it. Found
    // by this mission's own inner-critic pass, reproduced with an
    // artificially delayed POST before this guard existed.
    var epoch = 0;

    V2.on('v2:palette:open', function () { open(); });

    function open() {
      activeProject = null;
      epoch++;
      creating = false;
      clearPendingImages(); // drop anything left over from a prior open that was closed without submitting
      buildShell();
      palette.hidden = false;
      inputEl.value = '';
      inputEl.focus();
      renderResults('');
    }
    function close() {
      palette.hidden = true;
      epoch++;
      creating = false;
      clearPendingImages(); // revoke any staged-but-unsubmitted image blob URLs right away, not on the next open()
    }

    document.addEventListener('keydown', function (e) {
      if (palette.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); return; }
      if (e.key === 'Enter') {
        var el = document.activeElement;
        if (el && el.id === 'v2-palette-input') { e.preventDefault(); activateSelected(); }
      }
    });
    document.addEventListener('click', function (e) {
      if (palette.hidden) return;
      if (palette.contains(e.target)) return;
      if (V2.mounts.searchEntry && V2.mounts.searchEntry.contains(e.target)) return;
      close();
    });
    // Image paste: only intercepted when the clipboard actually carries an
    // image (kind 'file', type image/*) — a normal text paste into the
    // title or body falls through untouched, so this never fights the
    // browser's own paste behavior for the common case.
    document.addEventListener('paste', function (e) {
      if (palette.hidden) return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
          var f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (!files.length) return;
      e.preventDefault();
      addImages(files);
    });

    function moveSelection(delta) {
      if (!lastRows.length) return;
      selectedIndex = (selectedIndex + delta + lastRows.length) % lastRows.length;
      highlightSelected();
    }
    function highlightSelected() {
      resultsEl.querySelectorAll('.v2-palette__row').forEach(function (row, i) {
        row.classList.toggle('v2-palette__row--selected', i === selectedIndex);
      });
    }
    function activateSelected() {
      var row = lastRows[selectedIndex];
      if (!row) return;
      if (row.kind === 'mission') { V2.emit('v2:mission:open', { id: row.id }); close(); return; }
      if (row.kind === 'create') { createMission(row.title); return; }
    }

    // The same default the board's own quick-add <select> arrives at
    // implicitly (board.js: unmarked <option>s fall back to the browser's
    // own "select the first one" behavior over `ids.sort()`) — this file
    // has no <select>, so the equivalent has to be resolved explicitly.
    // Never hardcodes a specific id: whatever the registry contains wins.
    function defaultProjectId(state) {
      var ids = (state.projects || []).map(function (pj) { return typeof pj === 'string' ? pj : (pj && pj.id); }).filter(Boolean);
      if (!ids.length) return null;
      return ids.slice().sort()[0];
    }
    function resolveProject(state) { return activeProject || defaultProjectId(state); }

    function showErr(msg) { if (errEl) { errEl.textContent = msg; errEl.hidden = false; } }
    function hideErr() { if (errEl) { errEl.hidden = true; errEl.textContent = ''; } }

    function toast(msg) {
      var toasts = V2.mounts.toasts;
      if (!toasts) return;
      var el = document.createElement('div');
      el.className = 'v2-toast';
      el.textContent = msg;
      toasts.appendChild(el);
      setTimeout(function () { el.remove(); }, 4000);
    }

    function clearPendingImages() {
      pendingImages.forEach(function (img) { if (img.previewUrl) URL.revokeObjectURL(img.previewUrl); });
      pendingImages = [];
    }

    function setBusy(busy) {
      creating = busy;
      if (submitBtn) {
        submitBtn.disabled = busy;
        submitBtn.innerHTML = busy
          ? icon('loader-2', 'v2-icon--spin') + '<span>Creating…</span>'
          : icon('plus') + '<span>Create mission</span>';
      }
      if (attachBtn) attachBtn.disabled = busy;
    }

    function createMission(title) {
      title = title.trim();
      if (!title) { showErr('A mission needs a title.'); return; }
      if (creating) return; // the row click and the compose button can both fire for the same submit
      var state = V2.state || { tasks: [], projects: [] };
      var project = resolveProject(state);
      if (!project) { showErr('No projects are registered on this board — create one first.'); return; }
      hideErr();
      setBusy(true);
      // This submit's own session id: open()/close() bump `epoch` (see its
      // declaration above for why). Every completion branch below checks
      // this before touching `creating`, submitBtn/errEl, or close() — if
      // the palette was closed and/or reopened while this request was in
      // flight, those DOM refs and `creating` now belong to a DIFFERENT
      // session and must be left alone. Attaching images and toasting the
      // result still happen unconditionally: the mission was genuinely
      // created server-side regardless of what the UI did meanwhile, and
      // neither touches session-owned DOM state.
      var myEpoch = epoch;
      var payload = { title: title, project: project, priority: 3, created_by: 'human' };
      var bodyText = bodyEl ? bodyEl.value.trim() : '';
      if (bodyText) payload.body = bodyText;
      var images = pendingImages.slice();
      V2.api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }).then(function (r) {
        if (!r || r.error) {
          if (myEpoch === epoch) { setBusy(false); showErr((r && r.error) || 'Could not reach the hub — try again.'); }
          return;
        }
        var taskId = r.task.id;
        attachImages(taskId, project, images).then(function (failed) {
          toast(taskId + ' created' + (images.length ? (failed ? ' — ' + failed + ' of ' + images.length + ' image(s) failed to attach' : ' with ' + images.length + ' image(s)') : ''));
          V2.refresh();
          if (myEpoch === epoch) { setBusy(false); clearPendingImages(); close(); }
        });
      }, function () {
        if (myEpoch === epoch) { setBusy(false); showErr('Could not reach the hub — try again.'); }
      });
    }

    // Sequential on purpose: hub/lib/knowledge.js's writeKnowledge() shells
    // out to `git commit` against one working tree per write; parallel
    // POSTs here would race that repo. Best-effort — a failed image doesn't
    // roll back the mission (already created) or block its siblings.
    function attachImages(taskId, project, images) {
      var failed = 0, i = 0;
      function next() {
        if (i >= images.length) return Promise.resolve(failed);
        var img = images[i]; var idx = ++i;
        var file = 'projects/' + project + '/references/' + taskId + '-' + idx + '.' + img.ext;
        return blobToBase64(img.blob).then(function (b64) {
          return V2.api('/api/knowledge', {
            method: 'POST',
            body: JSON.stringify({ file: file, content: b64, mode: 'replace', encoding: 'base64', author: 'human', message: taskId + ': image attached from palette create' })
          });
        }).then(function (kr) {
          if (!kr || kr.error) { failed++; return; }
          return V2.api('/api/tasks/' + taskId, {
            method: 'PATCH',
            body: JSON.stringify({ agent: 'human', artifact: { label: img.name || ('Image ' + idx), url: file } })
          }).then(function (pr) { if (!pr || pr.error) failed++; });
        }).catch(function () { failed++; }).then(next);
      }
      return next();
    }

    function blobToBase64(blob) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          var result = String(reader.result || '');
          var idx = result.indexOf(',');
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    // Canvas round-trip: re-encodes into a format the brain's attachment
    // whitelist accepts (png/jpg/gif only — a picker can hand back webp,
    // heic, bmp...) and, on the same pass, downscales/re-compresses until
    // the result clears MAX_ATTACHMENT. PNG is kept only when the source
    // was already png/gif AND already under the cap (keeps a crisp
    // screenshot paste crisp); everything else — including any PNG that's
    // still too big after one pass — re-encodes as JPEG, which compresses
    // far better for photographic content.
    function normalizeImage(file) {
      if (typeof createImageBitmap !== 'function') return Promise.resolve({ error: 'This browser can’t process image attachments — try a newer one, or skip images.' });
      return createImageBitmap(file).catch(function () { return null; }).then(function (bitmap) {
        if (!bitmap || !bitmap.width || !bitmap.height) return { error: 'Could not read "' + (file.name || 'that file') + '" as an image.' };
        var w = bitmap.width, h = bitmap.height;
        var mime = (/^image\/(png|gif)$/i.test(file.type) && file.size <= MAX_ATTACHMENT) ? 'image/png' : 'image/jpeg';
        var quality = 0.92;
        var attempt = 0;
        function tryOnce() {
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w));
          canvas.height = Math.max(1, Math.round(h));
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          return new Promise(function (resolve) { canvas.toBlob(resolve, mime, quality); }).then(function (blob) {
            attempt++;
            if (blob && blob.size <= MAX_ATTACHMENT) return { blob: blob, ext: mime === 'image/png' ? 'png' : 'jpg' };
            if (attempt >= 9) return { error: 'Image too large even after downscaling (' + (file.name || 'pasted image') + ') — try a smaller image.' };
            mime = 'image/jpeg'; // switch off PNG immediately once oversized — JPEG compresses far better
            if (quality > 0.4) quality -= 0.12; else { w *= 0.75; h *= 0.75; }
            return tryOnce();
          });
        }
        return tryOnce();
      });
    }

    function addImages(files) {
      files.forEach(function (file) {
        if (!/^image\//.test(file.type)) { showErr('"' + (file.name || 'that file') + '" is not an image — skipped.'); return; }
        normalizeImage(file).then(function (result) {
          if (result.error) { showErr(result.error); return; }
          hideErr();
          pendingImages.push({ id: 'p' + (++pendingSeq), blob: result.blob, ext: result.ext, name: file.name, previewUrl: URL.createObjectURL(result.blob) });
          renderThumbs();
        });
      });
    }

    function renderThumbs() {
      if (!thumbsEl) return;
      thumbsEl.hidden = !pendingImages.length;
      thumbsEl.innerHTML = pendingImages.map(function (img) {
        return '<div class="v2-palette__thumb">' +
          '<img src="' + img.previewUrl + '" alt="' + esc(img.name || 'pasted image') + '">' +
          '<button type="button" class="v2-palette__thumb-remove v2-hit44" data-id="' + img.id + '" aria-label="Remove image">' + icon('x') + '</button>' +
          '</div>';
      }).join('');
      thumbsEl.querySelectorAll('.v2-palette__thumb-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          var idx = pendingImages.findIndex(function (img) { return img.id === id; });
          if (idx === -1) return;
          URL.revokeObjectURL(pendingImages[idx].previewUrl);
          pendingImages.splice(idx, 1);
          renderThumbs();
        });
      });
    }

    function score(t, q) {
      var id = (t.id || '').toLowerCase(), title = (t.title || '').toLowerCase();
      if (id === q) return 100;
      if (id.indexOf(q) === 0) return 90;
      if (title.indexOf(q) === 0) return 80;
      if (id.indexOf(q) !== -1) return 60;
      if (title.indexOf(q) !== -1) return 50;
      return 0;
    }

    function projLabel(state, id) {
      var p = (state.projects || []).find(function (pj) { return (typeof pj === 'string' ? pj : pj.id) === id; });
      if (!p) return id;
      return typeof p === 'string' ? p : (p.label || id);
    }

    // Built once per open(); the <input>, hint button and compose block
    // (body/attachments) created here are never replaced while the palette
    // stays open — only buildShell() creates DOM for them, so typed body
    // text, staged images and input focus/cursor all survive every
    // keystroke's renderResults() re-render below.
    function buildShell() {
      palette.innerHTML =
        '<div class="v2-palette__head">' +
        '<input class="v2-palette__input" id="v2-palette-input" placeholder="Jump to a mission, or type to create one…" autocomplete="off">' +
        '<button type="button" class="v2-palette__hint" aria-label="Palette keyboard shortcuts">' + icon('command') + '<span class="v2-palette__hint-tip">' +
        '<kbd>' + icon('chevron-up') + '</kbd><kbd>' + icon('chevron-down') + '</kbd> navigate · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</span></button>' +
        '</div>' +
        '<div class="v2-palette__pills" id="v2-palette-pills"></div>' +
        '<div class="v2-palette__results" id="v2-palette-results"></div>' +
        '<div class="v2-palette__compose" id="v2-palette-compose">' +
        '<textarea class="v2-palette__body" id="v2-palette-body" placeholder="Body (optional) — details for whoever picks this up."></textarea>' +
        '<div class="v2-palette__thumbs" id="v2-palette-thumbs" hidden></div>' +
        '<p class="v2-palette__err" id="v2-palette-err" hidden></p>' +
        '<div class="v2-palette__compose-actions">' +
        '<button type="button" class="v2-btn v2-btn--ghost v2-hit44" id="v2-palette-attach-btn">' + icon('paperclip') + '<span>Attach image</span></button>' +
        '<input type="file" id="v2-palette-file-input" accept="image/*" multiple hidden aria-label="Choose image files to attach">' +
        '<span class="v2-palette__paste-hint">or paste an image (Cmd/Ctrl+V)</span>' +
        '<button type="button" class="v2-btn v2-btn--primary v2-hit44" id="v2-palette-submit-btn">' + icon('plus') + '<span>Create mission</span></button>' +
        '</div>' +
        '</div>';
      inputEl = document.getElementById('v2-palette-input');
      pillsEl = document.getElementById('v2-palette-pills');
      resultsEl = document.getElementById('v2-palette-results');
      bodyEl = document.getElementById('v2-palette-body');
      thumbsEl = document.getElementById('v2-palette-thumbs');
      errEl = document.getElementById('v2-palette-err');
      attachBtn = document.getElementById('v2-palette-attach-btn');
      fileInput = document.getElementById('v2-palette-file-input');
      submitBtn = document.getElementById('v2-palette-submit-btn');

      inputEl.addEventListener('input', function () { renderResults(inputEl.value); });
      attachBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files.length) addImages(Array.prototype.slice.call(fileInput.files));
        fileInput.value = ''; // lets the same file be picked again later
      });
      submitBtn.addEventListener('click', function () { createMission(inputEl.value); });
    }

    // Rebuilds ONLY the pills + results containers below the input — never
    // touches inputEl or the compose block, so focus, cursor position, a
    // typed body and any staged images all survive every keystroke.
    function renderResults(query) {
      var state = V2.state || { tasks: [], projects: [] };
      var q = query.trim().toLowerCase();
      var tasks = state.tasks || [];
      var scoped = activeProject ? tasks.filter(function (t) { return t.project === activeProject; }) : tasks;
      var results = q
        ? scoped.map(function (t) { return { t: t, s: score(t, q) }; }).filter(function (r) { return r.s > 0; })
          .sort(function (a, b) { return b.s - a.s; }).slice(0, 8).map(function (r) { return r.t; })
        : scoped.slice().sort(function (a, b) { return a.priority - b.priority || b.created_at.localeCompare(a.created_at); }).slice(0, 8);

      var exactMatch = q && results.some(function (t) { return (t.id || '').toLowerCase() === q || (t.title || '').toLowerCase() === q; });

      lastRows = results.map(function (t) { return { kind: 'mission', id: t.id, t: t }; });
      if (q && !exactMatch) lastRows.push({ kind: 'create', title: query.trim() });
      selectedIndex = 0;

      var projectPills = (state.projects || []).map(function (pj) {
        var id = typeof pj === 'string' ? pj : pj.id;
        return '<button type="button" class="v2-palette__pill' + (activeProject === id ? ' v2-palette__pill--active' : '') + '" data-project="' + esc(id) + '">' +
          esc(projLabel(state, id)) + (activeProject === id ? ' <span class="v2-palette__pill-x">' + icon('x') + '</span>' : '') + '</button>';
      }).join('');
      pillsEl.innerHTML = projectPills;

      var defaultProj = resolveProject(state);
      var rowsHtml = lastRows.map(function (row, i) {
        if (row.kind === 'create') {
          var destLabel = defaultProj ? esc(projLabel(state, defaultProj)) : '—';
          return '<div class="v2-palette__row v2-palette__row--create" data-index="' + i + '">' + icon('plus') + ' Create "' + esc(row.title) + '" in ' + destLabel + '</div>';
        }
        var t = row.t;
        return '<div class="v2-palette__row" data-index="' + i + '">' +
          '<span class="v2-palette__row-id">' + esc(t.id) + '</span>' +
          '<span class="v2-palette__row-title">' + esc(t.title) + '</span>' +
          '<span class="v2-palette__row-meta">' + esc(t.status) + (t.project ? ' · ' + esc(t.project) : '') + '</span>' +
          '</div>';
      }).join('') || '<div class="v2-empty">No matches.</div>';
      resultsEl.innerHTML = rowsHtml;

      pillsEl.querySelectorAll('.v2-palette__pill').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-project');
          activeProject = activeProject === id ? null : id;
          renderResults(inputEl.value);
          inputEl.focus();
        });
      });
      resultsEl.querySelectorAll('.v2-palette__row').forEach(function (rowEl) {
        rowEl.addEventListener('click', function () {
          selectedIndex = +rowEl.getAttribute('data-index');
          activateSelected();
        });
      });
      highlightSelected();
    }
  }

  function injectStyle() {
    if (document.getElementById('v2-palette-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-palette-style';
    style.textContent = [
      '.v2-palette__head { display: flex; align-items: center; gap: var(--v2-space-4, 8px); position: relative; }',
      '.v2-palette__input { flex: 1; font: inherit; font-size: var(--v2-font-size-base, 13px); padding: var(--v2-space-4, 8px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); border-radius: var(--v2-radius-sm, 6px); background: var(--v2-color-bg, var(--v2-bg, transparent)); color: var(--v2-color-text-primary, var(--v2-ink, inherit)); }',
      '.v2-palette__hint { width: 22px; height: 22px; border-radius: var(--v2-radius-full, 999px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); background: transparent; color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-size: 11px; cursor: default; position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }',
      '.v2-palette__hint-tip { display: none; position: absolute; top: 26px; right: 0; white-space: nowrap; background: var(--v2-color-text-primary, #17181a); color: var(--v2-color-text-on-accent, var(--v2-on-accent, #fff)); font-size: 11px; padding: 6px 8px; border-radius: var(--v2-radius-sm, 5px); z-index: var(--v2-z-toast, 70); }',
      '.v2-palette__hint:hover .v2-palette__hint-tip, .v2-palette__hint:focus .v2-palette__hint-tip { display: block; }',
      '.v2-palette__hint-tip kbd { display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,.35); border-radius: 3px; padding: 0 4px; font: inherit; }',
      // round 4: components.css (t-66) is the source of record for .v2-icon
      // sizing, but v2.html never links it (verified: grepped v2.html for
      // "components.css" — zero matches) — the icon() helper's returned
      // <svg class="v2-icon"> was rendering unsized everywhere in the whole
      // v2 tranche, not just here. Same fix as keyboard.js's injectStyle:
      // a local fallback rule in this file's own injected sheet, matching
      // components.css's own values exactly, plus sizing for the pill's
      // remove-icon (.v2-palette__pill-x had no rule at all previously —
      // the raw '✕' character it replaced needed none to be legible).
      // t-132: components.css IS linked in v2.html now (t-93) — this local
      // rule stays anyway, same defensive-fallback reasoning as keyboard.js:
      // it costs nothing when components.css already applies (identical
      // values) and keeps this file's own icons correct if that link is
      // ever removed or reordered.
      '.v2-icon { display: inline-block; width: var(--v2-icon-size-sm, 14px); height: var(--v2-icon-size-sm, 14px); vertical-align: -0.15em; color: currentColor; flex: none; }',
      '.v2-palette__pill-x { display: inline-flex; align-items: center; justify-content: center; margin-left: 2px; }',
      '.v2-palette__pills { display: flex; flex-wrap: wrap; gap: var(--v2-space-3, 6px); margin-top: var(--v2-space-4, 8px); }',
      /* radius-sm (tight, Pure-Linear register), NOT radius-full: a full
         999px pill read as the retired soft-admin-template register a
         critic pass already rejected once on this goal (t-58 round 0) —
         the cited reference's own filter token (Screenshot-2024-08-03-at-
         16.25.37.png) uses the same tight radius as every other bordered
         element, never a fully rounded pill for a rectangular chip. */
      '.v2-palette__pill { font: inherit; font-size: var(--v2-font-size-xs, 11px); padding: 2px var(--v2-space-4, 8px); border-radius: var(--v2-radius-sm, 5px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); background: var(--v2-color-surface, transparent); color: var(--v2-color-text-secondary, var(--v2-ink-2, inherit)); cursor: pointer; }',
      '.v2-palette__pill--active { border-color: var(--v2-color-accent, var(--v2-accent, #3f6fe0)); color: var(--v2-color-accent, var(--v2-accent, #3f6fe0)); }',
      '.v2-palette__results { margin-top: var(--v2-space-4, 8px); max-height: 40vh; overflow-y: auto; }',
      '.v2-palette__row { display: flex; align-items: baseline; gap: var(--v2-space-4, 8px); padding: var(--v2-space-4, 8px); border-radius: var(--v2-radius-sm, 5px); cursor: pointer; font-size: var(--v2-font-size-sm, 12px); }',
      '.v2-palette__row--selected, .v2-palette__row:hover { background: var(--v2-color-row-selected-bg, rgba(63,111,224,.08)); }',
      '.v2-palette__row-id { color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-variant-numeric: tabular-nums; flex: 0 0 auto; }',
      '.v2-palette__row-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.v2-palette__row-meta { color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-size: var(--v2-font-size-xs, 11px); flex: 0 0 auto; }',
      '.v2-palette__row--create { color: var(--v2-color-accent, var(--v2-accent, #3f6fe0)); font-weight: var(--v2-weight-medium, 600); display: flex; align-items: center; gap: var(--v2-space-2, 5px); }',
      // t-132 compose block: body + attachments, always present below the
      // results list (not gated behind a second step) so the fast
      // title-Enter path pays nothing for it, but it's right there the
      // moment someone wants to add more.
      '.v2-palette__compose { margin-top: var(--v2-space-4, 8px); padding-top: var(--v2-space-4, 8px); border-top: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.15))); display: flex; flex-direction: column; gap: var(--v2-space-3, 6px); }',
      '.v2-palette__body { font: inherit; font-size: var(--v2-font-size-sm, 12px); padding: var(--v2-space-4, 8px); min-height: 52px; resize: vertical; border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); border-radius: var(--v2-radius-sm, 6px); background: var(--v2-color-bg, var(--v2-bg, transparent)); color: var(--v2-color-text-primary, var(--v2-ink, inherit)); }',
      '.v2-palette__thumbs { display: flex; flex-wrap: wrap; gap: var(--v2-space-3, 6px); }',
      '.v2-palette__thumb { position: relative; width: 64px; height: 64px; border-radius: var(--v2-radius-sm, 6px); overflow: hidden; border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); flex: 0 0 auto; }',
      '.v2-palette__thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }',
      '.v2-palette__thumb-remove { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: var(--v2-radius-full, 999px); background: rgba(0,0,0,.55); color: #fff; cursor: pointer; padding: 0; }',
      '.v2-palette__thumb-remove .v2-icon { width: 11px; height: 11px; }',
      '.v2-palette__err { color: var(--v2-color-status-bug, #c23434); font-size: var(--v2-font-size-xs, 12px); margin: 0; }',
      '.v2-palette__compose-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--v2-space-3, 8px); }',
      '.v2-palette__compose-actions .v2-btn { display: inline-flex; align-items: center; gap: var(--v2-space-2, 5px); font-size: var(--v2-font-size-xs, 12px); padding: var(--v2-space-2, 6px) var(--v2-space-4, 10px); border-radius: var(--v2-radius-sm, 6px); cursor: pointer; }',
      // Defensive fallback for .v2-btn, same reasoning as .v2-icon above —
      // components.css (linked) already styles these; this keeps them
      // legible if that link is ever missing.
      '.v2-btn { border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); background: var(--v2-color-surface, transparent); color: var(--v2-color-text-secondary, inherit); }',
      '.v2-btn--primary { background: var(--v2-color-accent, #3f6fe0); border-color: var(--v2-color-accent, #3f6fe0); color: var(--v2-color-text-on-accent, #fff); }',
      '.v2-btn:disabled { opacity: .6; cursor: progress; }',
      '.v2-palette__paste-hint { font-size: var(--v2-font-size-xs, 11px); color: var(--v2-color-text-muted, var(--v2-muted, #999)); }',
      '@media (max-width: 480px) { .v2-palette__paste-hint { display: none; } }' // touch-only viewports: the picker button covers it (t-132 acceptance), the desktop-only paste hint is just noise there
    ].join('\n');
    document.head.appendChild(style);
  }
})();
