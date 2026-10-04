# Changelog

All notable changes to Bureau are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). The hub reports its version on `GET /api/health` (behind the token); it lives in `hub/version.js`.

Self-hosters: read [UPGRADING.md](UPGRADING.md) before moving between versions.

## [Unreleased]

### Added
- The work store: `GET` and `POST /api/work`, a mission's evidence under `work/<t-id>/` in `BUREAU_WORK_DIR` (default `hub/work/`). Same file types, base64 rule and 5MB cap as the brain, but plain files: no git, no lint. Writes need an open mission. The folder is deleted when the mission closes `done`, `failed` or `discarded`, whichever door closed it, and leftovers go at boot. MCP gains `write_work` and `read_work`. Review links and the dashboards show a mission's work images.
- Settings roles `librarian` and `curator`, next to `lead` and `critic`. `curator` lets an agent write the curated compartments and nothing else.
- The hub warns at boot when `BUREAU_TOKEN` is still the placeholder from `.env.example`. It still boots; anyone who has read the repo knows that token.
- Curated writes pass brain-lint first. A markdown write to `knowledge/`, `recipes/`, a PROFILE.md or `attic/`, through the API or MCP, is linted as the file would be after it; a write that would fail answers 422 with the lint messages and writes nothing. The boss can force one with `force: true`, which is logged as `knowledge.forced`.
- brain-lint accepts a mission id (`(source: t-123)`) and a journal record id as sources, and a `source:` in a note's frontmatter covers the observations without their own (Brain Format v0.3). A source group holding prose is warned about and read as text. brain-lint is now also a module: `lint(dir)` and `lintFile(dir, rel, content)`.
- Approval pins the text. A review item may carry `payload: {ops: [{op, file, content}]}`, the exact brain change it proposes (`write` or `append`), hashed (SHA-256) when filed and never changed after. A mission parked with `after_approval: "return"` goes to the new status `approved` when the boss approves it, instead of `done`: back with its agent, work folder kept, no project capacity, not claimable. `POST /api/tasks/:id/apply` (MCP `apply_item`) checks the hash and writes the payload through the knowledge write, authored by the agent; the boss's approval of those exact bytes lets it into the curated compartments. The agent closes the mission `done` once every approved item is applied. The dashboards show an "Approved, to apply" group, and the office walks the folder back to the agent's desk. Without `after_approval`, nothing changes.
- Brain Format v0.3, draft: one claim grammar (short and long forms) for notes and journal records, ids, refs, the field list, the parsed form and its error codes, format versions, the derived index, and what is enforced today. `test/claims.test.js` holds the contract as fixtures with their expected parse; the reader cases are pending until the reader ships. v0.2 files stay valid.
- Typed capture. `POST /api/journal` takes `{agent, kind, text, evidence, tags?, confidence?, mission?}` from a registered agent, refuses a bad record with a `{error, code}` body before writing anything, stamps the id, `by`, `at` and the agent's mission, and appends one long-form claim to `journal/<yyyy-mm-dd>.md` (`format: 0.3`). `GET /api/journal` returns the records as JSON, filtered by `day`, `kind`, `mission`, `author`, `since`, with the blocks it cannot read listed in `invalid`. MCP gains `capture`, and its instructions now use it for journal lines. The event is `journal.captured`.
- `hub/lib/claims.js`, the v0.3 reader and writer: `parseFile` returns the parsed form, `serializeClaim` writes a claim back byte for byte. `test/claims.test.js` runs every fixture against it, and `test/journal.test.js` round-trips generated records.
- The setting `journal_free_text` (global, default open). While open, agents may still append free text to the journal through `POST /api/knowledge`, but in a `format: 0.3` day only lines that are not claims (422 otherwise). `false` refuses every agent journal write there; the boss's own writes always pass.
- brain-lint warns about each record it cannot read in a `format: 0.3` journal day. The journal still never fails lint.
- Memory health. `GET /api/memory/health` (MCP `memory_health`) returns a block the hub computes from the brain and the missions: lint errors and warnings, the week's captures by kind and author, unreadable journal blocks, approved items not applied yet and how long they have waited, curated claims past their freshness window (volatile 30 days, stable 180, durable never), contradictions, and provenance coverage. `status` is `attention`, with its reasons, when lint has errors, a journal block is unreadable, or an approved item has waited more than 48 hours. Cached for a minute; any brain write or mission change drops the cache. Read counts are not tracked yet and say so.
- Both dashboards show the health as one line near the brain (ok or attention, with a glyph), refreshed on brain writes and mission changes; a click shows the reasons and the lists.
- CI runs `test/memory-eval.sh`: recall@5 on the fixture brain must not drop below the recorded number.

### Changed
- Sol's digest opens with the health block, and anything in `attention` becomes an item or a message to the boss.
- `test/memory-eval.sh` checks recall@5 as a floor (at or above the recorded 0.875) instead of an exact match, so a better score passes.
- **Cutover of a journal day.** The first capture on a day whose file is v0.2 free text moves that file to `journal/<yyyy-mm-dd>.v02.md` (git mv, its own commit, content untouched) and starts a `format: 0.3` file.
- The claude-code and cowork charters, and Sol's, capture with `POST /api/journal` instead of appending journal lines; Sol's digest reads records with `GET /api/journal`.
- **Curated compartments are hub-enforced.** `POST /api/knowledge` and MCP `write_knowledge` to `knowledge/`, `recipes/` (global and entity), `entities/<slug>/PROFILE.md` and `attic/` answer 403 unless the author is `human` or holds the `librarian` or `curator` role. Nothing is written or committed on a refusal. `journal/`, `daily/`, `projects/` and the rest stay open.
- `librarian` is now a role like `lead` and `critic`: once any agent has roles in settings, it comes from settings only, for the digest carve-out too. **If your settings hold roles, add `librarian` to your librarian's entry (and `curator` to any agent that files knowledge with you) when you upgrade**, or the librarian can no longer park its digest or write `knowledge/`. With no roles in settings, the tags work as before.
- Review evidence moves out of the brain: the docs now point screenshots at the work store instead of `deliverables/`.
- The hub loads `hub/.env` itself (`hub/lib/env.js`), whatever folder it starts in, with the rules `start.sh` had: the host's environment wins, then the file. Values read the way `sh` read them when `start.sh` sourced the file: quotes over several lines, `\"` escapes, and `$NAME` from earlier lines (a `BUREAU_POKES` built from `POKE_*` lines keeps working). `node server.js` is the start command everywhere; `start.sh` now just runs it. `BUREAU_ENV_FILE` points the hub at another file.
- A backslash in a brain path is a separator on every OS, and paths in answers, events and commit messages always use `/`.
- Bad brain and work paths answer 400 instead of 500.

### Fixed
- **We no longer ignore 70% of the desktop market.** A few of you pointed out, with varying amounts of sarcasm, that `sh start.sh` is not a plan for Windows. Fair. The hub now reads its own `.env`, so `node server.js` starts it on Windows, macOS and Linux, and CI runs the conformance suite on Windows on every push. The quickstart turned out to be the small problem: on Windows the hub started with no token, Windows line endings broke the linter, and backslashes broke the links. All fixed, listed below. I don't own a Windows machine, so if it breaks on yours, tell me what you ran.
- Without `sh`, the hub never read `.env`, so a plain `node server.js` started with no token and an open API.
- A brand-new hub stopped before its first change could never start again: it had written its daily backup but no `state.json`, and backups without a state file refuse the boot. A fresh hub now writes its empty `state.json` at once. Found by the new Windows CI job, but true on every OS.
- brain-lint reads files with Windows line endings or a BOM like any other; it used to report them as missing frontmatter and refuse every write to them (422).
- brain-lint keyed files with `\` on Windows, so every path wikilink read as dangling and valid writes were refused.
- A BOM at the top of a `format: 0.3` journal day no longer hides its format and triggers a false cutover.
- Names Windows cannot hold are refused in the brain, the work store and project ids, on every OS: `CON`, `NUL`, `COM1` and the rest, `: < > " | ? *`, a trailing dot or space, `~1`-style short names, and `.git` in any case. They used to be written, then refused by git, which left the intake sweep stuck.
- The brain gets a `.gitattributes` (`* -text`, so git keeps the exact bytes the boss approved) and a `.gitignore` for OS clutter (`Thumbs.db`, `desktop.ini`, `.DS_Store`), committed once by the hub. `core.longpaths` is on.
- A state save that Windows refuses for a moment (antivirus or an indexer holding the file) is retried instead of crashing the hub.
- The startup lock is touched every 30 seconds, and a lock left untouched for 2 minutes is stale even if its pid now belongs to another process (Windows reuses pids). Closing the console window on Windows saves pending state.
- The hub finds `git.exe` on the PATH, never in the brain folder, and says clearly at boot when git is missing.
- The boot warnings lost their emoji and suggest a token command that works without openssl.
- The repo has a `.gitattributes`, so a Windows clone keeps the scripts and fixtures with LF endings. `hub.sh` and `project-of.sh` read token files saved by Notepad.
- **No approval with undecided items.** Approving a mission (to `done` or `approved`, or closing it with `approved_in_session`) is refused while any of its items is still `proposed`, on every door: dashboards, review links, MCP. Give every item a verdict first. Missions without items are unaffected.

## [0.2.0] - 2026-10-01

Safety for people who run Bureau themselves, settings for how approval works, a readable and clickable office, and the first CI.

### Security
- A review or answer link could fetch any image in the brain, other entities' included, and ignored its expiry. It now serves only the images its own mission cites, while the link is live (#84).
- `hub.sh` no longer defaults to the author's hub: it reads `BUREAU_URL` or `~/.bureau-url`, and refuses to run with neither (#96).

### Added
- Settings: `GET` and `PATCH /api/settings`, global, per project and per agent. `approval` (`dashboard`, `in-session`, `critic`) decides how boss-gate work closes; `approved_in_session` carries the boss's quoted words; roles in settings govern `lead` and `critic` once configured; `notify` decides what pings Discord. With no settings, nothing changes (#91).
- The mission log keeps `from` and `to` on every status change, never credits an update to "unknown", and tags the boss's entries with a `kind` (#99).
- Office: clickable agents, desks, board, shelf and boss door, with a keyboard path; an icon legend in the HUD; human sentences in the ticker; whole-number scaling in the mini card; a regression guard for bounds and palette (#89).
- Brain Format: a one-line `summary:` on authoritative files, a `## Now` section on every STATE.md, a `specs/` compartment with sourced rule ids, all linted. Three specs of Bureau itself in `docs/specs/` (#92).
- A memory eval harness (`test/memory-eval`) measuring recall against a hub (#93).
- A Docker image (node:22-alpine with git), compose, and release images on `ghcr.io/mahoudeau/bureau` from release tags; `server.json` for the MCP registry (#94).
- CI on every PR: conformance, brain lint, pokes, notify, storage, and the office guard (#87, #89, #91).
- `llms-install.md`, an install guide written for AI assistants (#87).
- Pair mode documented: an approval in the session closes the mission, quoting the boss (#88). The MCP instructions teach reading the brain before the code (#98).

### Changed
- `start.sh`: the host's environment wins over `hub/.env`, which only fills what is unset; `HOST` from `.env` is honored (#97).
- A fresh brain gets an empty first commit, so git stops logging about an empty repo (#97).
- An update that changes nothing it refuses: a refused PATCH no longer leaves a raised gate or filed items behind (#84).

### Fixed
- The conformance suite on macOS bash 3.2: two checks mangled their JSON and one passed by accident (#85).
- The office: desks no longer swap nameplates, folders and emotes sit on the sprite, the review pile rests on the mat, walkers take the aisles, the HUD and ticker no longer cover the scene, one draw loop instead of stacked ones (#89).
- `pokes.sh` no longer flakes on a sweep ring in flight (#97).

### Storage (#86)
- `state.json` carries `schema_version`. The hub runs ordered migrations on boot and keeps the previous file as `state.json.pre-migrate-<ts>` first. A file without the field is version 0 and migrates to 1.
- Rolling backups of the state: `state.json.bak.1` (newest) to `.bak.24`, one per hour, plus a daily snapshot `state.json.daily-YYYY-MM-DD`, seven kept. Tunable with `BUREAU_BACKUP_INTERVAL_MS`, `BUREAU_BACKUP_KEEP`, `BUREAU_DAILY_KEEP`.
- The new `GET /api/health` reports `version` and `schema_version`, behind the token. `GET /health` stays public and shows liveness only.
- `hub/version.js`, the single place the version lives. The MCP door's `serverInfo` reads it too.
- `test/storage.sh`, a self-contained check of everything above.
- State writes are fsynced before the rename.
- A shutdown (SIGINT, SIGTERM) flushes a pending write instead of dropping it. Before, a write inside the 100 ms debounce window was lost.
- A `state.json` that does not parse no longer boots the hub on empty state. The hub refuses to start, says why, and keeps the bad file as `state.json.corrupt-<ts>` (one copy per distinct bad file). The file stays in place, so every restart refuses until it is fixed or restored.
- A missing `state.json` next to existing backups refuses to boot instead of starting empty.
- A `state.json` written by a newer Bureau (higher `schema_version`) refuses to boot instead of being read by code that does not know its shape.
- The startup lock treats a pid owned by another user (EPERM) as alive, not stale.

## [0.1.0] - 2026-09-23

The baseline: what Bureau was when versioning started. Everything here predates this file.

### Hub
- Zero-dependency Node server (`hub/server.js`), plain `node:http`, one bearer token. JSON state in `data/state.json` with atomic writes, a startup lock (`data/hub.lock`) so one process owns a data dir.
- Mission queue with claim and lease. An expired lease returns the mission to the queue, reserved for its last holder. Cowork reservations lapse after `BUREAU_RESERVATION_TTL_MIN`; others keep until claimed.
- Projects as the unit of concurrency: capacity per project (1 by default), spillover across projects, `all_busy` when every desk is taken, claim by id bypasses. `goal:` missions do not occupy a desk. Projects carry an optional entity wall and repo URL; create, relabel, rename (moves missions and the brain folder), delete when empty.
- Statuses `queued`, `claimed`, `in_progress`, `blocked`, `review`, `done`, `failed`, `discarded`. Blocked pauses the lease.
- The gate: missions are `gate: boss` by default or `gate: critic`. Only the critic, the lead or the boss parks a boss-gate mission in review; only the boss moves it out. The librarian may park its own digest. Roles come from roster capability tags, never from names.
- Capability links: single-use approve, send-back and answer links, so the boss rules from any channel without the token. Itemized review with per-item verdicts. A read-only mission record page at `/m/<token>`.
- Roster with heartbeats and a generic activity vocabulary. Sub-agent fleets ride the parent's heartbeat and never join the roster. Roster curation with `DELETE /api/agents/:name`. Capability changes are logged with before and after.
- Message bus with broadcast and directed messages, `GET` and `POST` inbox forms.
- Knowledge brain: markdown and whitelisted attachments committed to a git repo with the agent as author. Files dropped or edited by hand are swept into git on a timer.
- SSE event stream at `/api/events`.
- MCP door: a capability URL that lets chat apps with no shell work missions under the same rules.
- Outbound pokes (the summoner): webhooks on task transitions, plus a standing-work bell driven by the sweep. Optional Discord mirror.

### Views
- The flat dashboard at `/`, and the v2 board at `/v2` (swimlanes, peek panel, the Desk rail, awaiting-merge panel, themes including Retro Corporate) with a living style guide at `/v2/styleguide`.
- The pixel office at `/office`: a Game Boy-inspired renderer of the same SSE stream, with an assembled cast drawn from boss-drawn parts.

### Specs and tools
- The agent protocol (`docs/protocol.md`) and the Bureau Brain Format (`docs/brain-format.md`), Apache-2.0.
- `brain-lint` (`hub/tools/brain-lint.js`) and its acceptance test `test/brain-lint.sh`.
- `test/dummy-agent.sh`, the curl-only conformance script, and `test/pokes.sh`.

[Unreleased]: https://github.com/mahoudeau/bureau/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mahoudeau/bureau/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mahoudeau/bureau/releases/tag/v0.1.0
