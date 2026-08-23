// v2/awaiting-merge.js — t-116 (goal: t-53). Owns nothing but its own
// injected DOM; touches no other file, per this mission's own scope.
//
// Closes a legibility gap the boss found directly (relayed via consul's
// note on t-53, 2026-08-16T17:37Z): critic-closed missions park their
// code in an open PR awaiting his merge, but the evidence screenshots
// live in mission Media on /v2 while the merge decision sits on GitHub
// with no evidence attached — from where he actually decides (GitHub),
// he can't see what he's approving. One place on the dashboard: every
// open PR tied to a mission, each showing that mission's evidence
// inline plus a direct PR link, so a ready tranche reads as one
// reviewable moment instead of a scatter of GitHub tabs.
//
// Self-contained surface, same shape search.js (t-73) already uses for
// exactly this reason: its own trigger + its own non-modal panel,
// appended once to document.body, touching no other module's DOM or
// mount points (this surface has no pre-existing mount in v2.html —
// there was nothing to attach to, and the mission's own scope forbids
// editing any other v2/*.js file's logic to add one).
//
// Cross-referencing missions to PRs: the protocol has no dedicated PR
// field (confirmed by reading docs/protocol.md and this repo's own
// mission logs before writing this file — t-109/t-112/etc. all post the
// PR link as a free-form `artifact` entry, `{"label": "PR #N: ...",
// "url": "https://github.com/.../pull/N"}`). Parsed off that existing
// convention rather than inventing hidden state the hub doesn't store,
// per this mission's own instruction.
//
// GitHub PR state: this repo is public, so the unauthenticated GitHub
// REST API (api.github.com, which serves CORS for anonymous GET on
// public-repo endpoints) can confirm a PR is still genuinely open
// (merged/closed PRs are filtered out — a mission whose PR already
// merged is not "awaiting" anything, even if its bureau-side status
// hasn't been flipped to reflect that yet). No token, no client-side
// secret. KNOWN LIMITATION, stated plainly rather than silently
// papered over: this session's own sandboxed dev environment blocks
// outbound headless-browser HTTPS entirely at the network layer
// (confirmed independently in t-111's audit — even a plain
// https://example.com fetch resets the connection; curl through the
// same proxy works fine, so it's a browser/CONNECT-tunnel limitation
// of THIS dev sandbox, not of the GitHub API itself), so the live
// api.github.com call could not be empirically click-tested end to end
// the way every other claim in this mission's closing note was. Coded
// defensively per the acceptance's own instruction — a failed/blocked/
// rate-limited fetch degrades to showing the entry anyway (PR state
// marked "unconfirmed"), never to hiding it or blanking the page,
// which is the fail-safe direction: a boss who can't fully trust one
// row's live state is far better served than one who never sees a
// tranche because a network call quietly ate it.
//
// t-129 (goal: t-53) split: the boss's own complaint — a flat list mixed
// t-59-style round-N branch PRs (mission still looping, not his to
// merge) in with PRs whose missions are genuinely done. This surface
// answers one question, "what's waiting on ME", so it now buckets every
// PR-carrying mission into READY (mission done, or in review at
// gate:boss — his own click is the only thing left) or IN-LOOP (mission
// queued/claimed/in_progress, or in review at gate:critic — still
// mid-loop, not his turn yet). READY renders first and undimmed; IN-LOOP
// renders muted below it. The trigger's count — both the light on-load
// pass and the network-confirmed pass — counts READY rows only, since
// that's the number that answers "how many need me right now".
(function () {
  'use strict';

  var GITHUB_PR_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/;

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
    injectStyle();

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    // t-172 (boss law): a row leaves the list ONLY on a confirmed terminal
    // fact — a genuine 200 saying the PR is closed/merged — never because a
    // fetch failed, rate-limited, or a re-render raced. State is therefore
    // kept as {state, ts} with per-state lifetimes: 'closed' is permanent,
    // 'open' is rechecked after a TTL, and a FAILED check never overwrites
    // the last known state at all (it only ever fills a void).
    var prState = {};                 // "owner/repo#N" -> { state: 'open'|'closed'|'unconfirmed', ts }
    var OPEN_TTL = 120000;            // recheck open PRs at most every 2 min (unauthenticated API is 60 req/h)
    var inflight = {};                // key -> Promise, so bursts share one fetch instead of stacking
    // t-200: a CLOSED verdict is a permanent fact — remember it across page
    // loads so each merged PR ever costs exactly one successful API call.
    // Without this, the whole merged history (dozens of missions) re-checks
    // on every load, devours the 60/h anonymous budget, rate-limits, and
    // floods the panel with unconfirmed ghost rows the boss must scroll past.
    var LS_KEY = 'v2-awaitmerge-closed';
    try {
      (JSON.parse(localStorage.getItem(LS_KEY) || '[]')).forEach(function (k) {
        prState[k] = { state: 'closed', ts: 0 };
      });
    } catch (_) {}
    function rememberClosed(key) {
      try {
        var seen = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
        if (seen.indexOf(key) === -1) { seen.push(key); localStorage.setItem(LS_KEY, JSON.stringify(seen)); }
      } catch (_) {}
    }
    // Rate-limit hygiene: one 403 pauses ALL fetching for a cooldown window
    // (retrying into a spent budget only wastes the refill). Fetching itself
    // happens only on the metered ticker below, never on render.
    var rateLimitedUntil = 0;

    // t-240 (the Desk): the floating trigger + popover are retired. This
    // surface now renders into the #v2-desk-merge slot the Desk reserves
    // in the side rail (needs-me-now.js emits 'v2:desk:merge-mount' after
    // each of its own renders, since re-rendering the rail replaces the
    // slot element). PR-state logic is unchanged; only presentation moved.
    function mergeMount() { return document.getElementById('v2-desk-merge'); }

    // A mission "carries" a PR if the LAST github.com/.../pull/N link in
    // its own artifacts list matches — last, not first, so a mission
    // whose branch was re-cut into a fresh PR (an old link superseded by
    // a new one, same shape as t-114/t-115 each opening their own PR off
    // a fresh branch) always points at its current one, not a stale one.
    function prLinkFor(task) {
      var arts = task.artifacts || [];
      for (var i = arts.length - 1; i >= 0; i--) {
        var m = GITHUB_PR_RE.exec(String(arts[i].url || ''));
        if (m) return { owner: m[1], repo: m[2], number: m[3], url: arts[i].url };
      }
      return null;
    }

    // READY = the boss's own click is the only thing left standing
    // between this PR and merged: the mission itself is done, or it's
    // sitting in review at gate:boss (already survived the critic loop,
    // promoted to him by the critic/lead, per t-119's own gate rule —
    // never self-promoted by a builder). Everything else with an open PR
    // (queued, claimed, in_progress, blocked, or review at gate:critic —
    // still mid critic-loop per t-53's own judging protocol) is still
    // in the loop: a real open PR, but not his turn yet.
    function isReady(task) {
      return task.status === 'done' || (task.status === 'review' && task.gate === 'boss');
    }

    // t-164 (boss-filed): a discarded/failed mission isn't "still in the
    // loop" — it's dead, there's nothing left to merge or wait on, even
    // if its PR happens to still be technically open on GitHub (nobody
    // closes the PR when a mission is discarded; that's a separate gap,
    // not this file's to fix). hub/lib/store.js's own TASK_STATUSES names
    // exactly two terminal-abandoned states distinct from the successful
    // terminal 'done' — 'failed' and 'discarded' (same pair store.js
    // itself already excludes from "open work" project-capacity counts,
    // e.g. line ~218's isOpen-style filter) — reused here rather than
    // inventing a second definition of "abandoned" for this file alone.
    function isAbandoned(task) {
      return task.status === 'failed' || task.status === 'discarded';
    }

    // Short human label for why a row sits where it sits — shown on
    // IN-LOOP rows so the muted section reads as "still cooking, here's
    // the stage" rather than an unexplained dimming.
    function statusLabel(task) {
      if (task.status === 'review') return 'review · gate ' + (task.gate || '?');
      return String(task.status || 'unknown').replace(/_/g, ' ');
    }

    function artImg(a) {
      var m = String(a.url || a.label || '').match(/([\w./-]+\.(?:png|jpe?g|gif))/i);
      if (m && !/^https?:/i.test(m[1])) return m[1];
      var m2 = String(a.url || '').match(/[?&]file=([\w./%-]+\.(?:png|jpe?g|gif))/i);
      return m2 && m2[1];
    }

    // Reuses media.js's own thumbnail markup/class names (.v2-media__grid/
    // __thumb/__cap) — that file's <style id="v2-media-style"> is always
    // present in the document (media.js loads unconditionally per
    // v2.html's module list, independent of peek-panel state), so no CSS
    // is duplicated here; only the fetch/render logic is, since this
    // mission's own scope forbids editing media.js to export a shared
    // helper ("do not modify any other existing v2/*.js file's own logic").
    function thumbsFor(task) {
      var imgs = (task.artifacts || []).map(artImg).filter(Boolean);
      if (!imgs.length) return '<div class="v2-empty">No evidence attached.</div>';
      return '<div class="v2-media__grid">' + imgs.map(function (img) {
        var src = '/api/knowledge?file=' + encodeURIComponent(decodeURIComponent(img)) + '&raw=1&token=' + encodeURIComponent(V2.token);
        return '<a class="v2-media__thumb" href="' + src + '" target="_blank" rel="noopener">' +
          '<img src="' + src + '" alt="" loading="lazy"></a>';
      }).join('') + '</div>';
    }

    // t-200 round 2 (pair mode, 2026-08-21): the per-PR ticker was correct
    // but arithmetically too slow to warm up — ~30 merged-history PRs at
    // one request/minute is half an hour of "unconfirmed" ghost rows,
    // which is the original complaint intact. One LIST call per repo
    // (`pulls?state=open&per_page=100`) returns every open PR at once, so
    // a single request resolves the entire history: candidates present in
    // the list are confirmed open, candidates absent are confirmed closed
    // (permanent, cached). Absence implies closed ONLY when the list is
    // complete — a paginated response (Link: rel="next", >100 open PRs)
    // marks opens but never infers a close from absence. The boss law is
    // unchanged: a failed or rate-limited fetch changes nothing at all.
    function fetchRepoStates(owner, repo, candidateKeys) {
      var repoKey = owner + '/' + repo;
      if (inflight[repoKey]) return inflight[repoKey];
      if (Date.now() < rateLimitedUntil) return Promise.resolve(false);
      var url = 'https://api.github.com/repos/' + owner + '/' + repo + '/pulls?state=open&per_page=100';
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeout = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
      inflight[repoKey] = fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: controller ? controller.signal : undefined })
        .then(function (r) {
          if (timeout) clearTimeout(timeout);
          if (!r.ok) {
            if (r.status === 403 || r.status === 429) rateLimitedUntil = Date.now() + 600000; // 10 min global pause
            return false; // keep every last-known state untouched
          }
          var complete = !/rel="next"/.test(r.headers.get('Link') || '');
          return r.json().then(function (list) {
            if (!Array.isArray(list)) return false;
            var openSet = {};
            list.forEach(function (pr) { if (pr && pr.number) openSet[repoKey + '#' + pr.number] = true; });
            candidateKeys.forEach(function (key) {
              if (openSet[key]) {
                prState[key] = { state: 'open', ts: Date.now() };
              } else if (complete) {
                prState[key] = { state: 'closed', ts: Date.now() };
                rememberClosed(key); // permanent fact, survives reloads
              }
            });
            return true;
          });
        })
        .catch(function () {
          if (timeout) clearTimeout(timeout);
          return false; // network/CORS/abort: keep last known
        })
        .then(function (ok) { delete inflight[repoKey]; return ok; });
      return inflight[repoKey];
    }

    // t-240: a Desk-grammar row — one dense line (PR link + ellipsized
    // mission title), evidence collapsed behind a native <details> so the
    // rail stays a column of lines until the boss asks for pixels.
    function row(task, pr, state) {
      var badge = state === 'unconfirmed' ? '<span class="v2-awaitmerge-row__unconfirmed">unconfirmed</span>' : '';
      var thumbs = thumbsFor(task);
      var evidence = thumbs.indexOf('v2-media__thumb') !== -1
        ? '<details class="v2-awaitmerge-row__evidence"><summary>evidence</summary>' + thumbs + '</details>'
        : '';
      return '<div class="v2-list__row v2-awaitmerge-row">' +
        // t-145 (goal: t-53): .v2-hit44 — invisible 44px hit zone on the link.
        '<a class="v2-awaitmerge-row__pr v2-hit44" href="' + esc(pr.url) + '" target="_blank" rel="noopener">#' + esc(pr.number) + '</a>' +
        '<span class="v2-list__row-body">' +
        '<span class="v2-list__row-title v2-awaitmerge-row__title">' + esc(task.id) + ' · ' + esc(task.title) + '</span>' +
        (badge || evidence ? '<span class="v2-list__row-meta">' + badge + evidence + '</span>' : '') +
        '</span></div>';
    }

    // Splits the states-resolved candidate list into READY (rendered
    // first, undimmed) and IN-LOOP (rendered below, muted) — the only
    // classification this file needs, driven off task.status/task.gate,
    // never off PR state (PR state only ever decides in/out of the list
    // at all, per the merged/closed filter above it).
    function bucket(resolved) {
      var readyRows = [], inLoopRows = [];
      resolved.forEach(function (o) { (isReady(o.task) ? readyRows : inLoopRows).push(o); });
      return { ready: readyRows, inLoop: inLoopRows };
    }

    // Trigger count = READY only (t-129's own instruction: the number on
    // the trigger answers "how many need me right now", not "how many
    // PRs exist"). Same open-count-with-unconfirmed-fallback shape the
    // pre-split count used, just scoped to the ready bucket.
    function readyCount(readyRows) {
      var confirmed = readyRows.filter(function (o) { return o.state === 'open'; }).length;
      // t-200 follow-up (boss saw "30 awaiting" during a rate-limit window):
      // the trigger number counts CONFIRMED-open ready PRs only. Under total
      // uncertainty it reads low-and-honest instead of high-and-wrong; the
      // rows themselves still render (never hidden by a failed check), and
      // the persisted closed-cache makes the confirmed count exact after one
      // warm-up window, permanently.
      return confirmed;
    }

    // t-128 fix, composed with the t-129 split: the trigger count must be
    // the real, network-verified count from page load onward, tracking live
    // updates while the panel stays closed — and per t-129 it counts the
    // READY bucket only. render() always resolves the count on every call;
    // only the panel BODY markup is gated on visibility (rebuilding hidden
    // DOM is wasted work; fetchPrState's cache absorbs the repeat network
    // cost across calls).
    // t-172: renders are differential (the DOM is only touched when the
    // computed markup actually changed — no interstitial "Checking…" wipe,
    // which was the visible flicker). Since the t-200 metered ticker they
    // are also fully synchronous cache reads, so ordering races are gone
    // by construction.
    var lastBodyHtml = null;

    function paintBody(html) {
      var el = mergeMount();
      if (!el) return; // the Desk hasn't rendered its slot yet
      // The Desk replaces the slot element on every rail render, so compare
      // against the slot's actual content, not just our last string.
      if (html !== lastBodyHtml || el.innerHTML === '') { lastBodyHtml = html; el.innerHTML = html; }
    }

    // t-240: rendered as a Desk section — header with the honest confirmed
    // count, READY rows only. In-loop PR-bearing missions no longer render
    // here at all: loop state is the board's job (the boss's own governing
    // rule for the rail: only what the board structurally cannot show).
    function render() {
      var state = V2.state;
      var tasks = (state && state.tasks) || [];
      var candidates = tasks.map(function (t) {
        if (isAbandoned(t)) return null; // t-164: discarded/failed missions never enter the list
        var pr = prLinkFor(t);
        return pr ? { task: t, pr: pr } : null;
      }).filter(Boolean);

      // t-200 metered ticker (boss ruling): renders NEVER fetch. They read
      // the cache synchronously and paint; the background ticker below is
      // the only thing that ever talks to GitHub, at a fixed one request
      // per minute, so blowing the 60/h anonymous quota is arithmetically
      // impossible no matter how often the page renders.
      var open = candidates.map(function (c) {
        var key = c.pr.owner + '/' + c.pr.repo + '#' + c.pr.number;
        var known = prState[key];
        return { task: c.task, pr: c.pr, state: (known && known.state) || 'unconfirmed' };
      }).filter(function (o) { return o.state !== 'closed'; });
      var b = bucket(open);
      var head = '<h3 class="v2-needs-me-now__group-title">⎇ Awaiting merge · ' + readyCount(b.ready) + '</h3>';
      paintBody(head + (b.ready.length
        ? '<div class="v2-list">' + b.ready.map(function (o) { return row(o.task, o.pr, o.state, true); }).join('') + '</div>'
        : '<div class="v2-empty">Nothing ready to merge.</div>'));
    }

    // The metered ticker, round 2: once a minute, refresh ONE REPO's whole
    // open-PR set (in practice there is exactly one repo, so every candidate
    // resolves on the first tick — merged history included). Spend is at
    // most one request per minute per construction, same ceiling as before,
    // but warm-up went from ~30 minutes to ~2 seconds.
    function tickFetch() {
      if (Date.now() < rateLimitedUntil) return;
      var tasks = (V2.state && V2.state.tasks) || [];
      // Group non-closed candidates per repo; a repo needs a tick when any
      // of its candidates is unknown or its confirmed-opens have gone stale.
      var byRepo = {};
      tasks.forEach(function (t) {
        if (isAbandoned(t)) return;
        var pr = prLinkFor(t);
        if (!pr) return;
        var key = pr.owner + '/' + pr.repo + '#' + pr.number;
        var known = prState[key];
        if (known && known.state === 'closed') return;
        var repoKey = pr.owner + '/' + pr.repo;
        var g = byRepo[repoKey] = byRepo[repoKey] || { owner: pr.owner, repo: pr.repo, keys: [], due: false };
        g.keys.push(key);
        if (!known || known.state === 'unconfirmed' || Date.now() - known.ts >= OPEN_TTL) g.due = true;
      });
      var pick = null;
      Object.keys(byRepo).forEach(function (rk) {
        var g = byRepo[rk];
        if (g.due && !inflight[rk] && (!pick || g.keys.length > pick.keys.length)) pick = g;
      });
      if (!pick) return;
      fetchRepoStates(pick.owner, pick.repo, pick.keys).then(function () { requestRender(); });
    }
    setInterval(tickFetch, 60000);
    setTimeout(tickFetch, 1500); // first tick shortly after load

    // SSE ticks arrive far faster than PR reality changes (eight agents
    // heartbeating, every mission note). Coalesce them: leading render for
    // immediacy, then at most one trailing render per window.
    var renderTimer = null, renderQueued = false;
    function requestRender() {
      if (renderTimer) { renderQueued = true; return; }
      render();
      renderTimer = setTimeout(function () {
        renderTimer = null;
        if (renderQueued) { renderQueued = false; requestRender(); }
      }, 3000);
    }

    V2.on('v2:state', function () { requestRender(); });
    // The Desk re-emits this after every rail render (its innerHTML replace
    // destroys our slot's content), so we repaint into the fresh slot.
    V2.on('v2:desk:merge-mount', function () { lastBodyHtml = null; render(); });
    render(); // cold-load paint from the persisted cache; the ticker refines it
  }

  function injectStyle() {
    if (document.getElementById('v2-awaitmerge-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-awaitmerge-style';
    // t-240: trigger/popover styles retired with the floating surface; the
    // Desk section reuses .v2-list row grammar (organisms.css) — only the
    // handful of merge-specific hooks remain here.
    style.textContent = [
      '.v2-awaitmerge-row { cursor: default; }',
      '.v2-awaitmerge-row__pr { flex: none; font-size: 12px; color: var(--v2-color-accent, #3f6fe0); text-decoration: none; white-space: nowrap; font-variant-numeric: tabular-nums; }',
      '.v2-awaitmerge-row__pr:hover { text-decoration: underline; }',
      '.v2-awaitmerge-row__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.v2-awaitmerge-row__unconfirmed { font-size: 11px; color: var(--v2-color-status-at-risk, #f2a30f); margin-right: var(--v2-space-2, 6px); }',
      '.v2-awaitmerge-row__evidence summary { cursor: pointer; font-size: 11px; color: var(--v2-color-text-muted, #71727c); list-style: none; }',
      '.v2-awaitmerge-row__evidence summary::-webkit-details-marker { display: none; }',
      '.v2-awaitmerge-row__evidence summary::before { content: "▸ "; }',
      '.v2-awaitmerge-row__evidence[open] summary::before { content: "▾ "; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();
