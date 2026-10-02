# Changelog

All notable changes to Bureau are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). The hub reports its version on `GET /api/health` (behind the token); it lives in `hub/version.js`.

Self-hosters: read [UPGRADING.md](UPGRADING.md) before moving between versions.

## [Unreleased]

### Added
- The work store: `GET` and `POST /api/work`, a mission's evidence under `work/<t-id>/` in `BUREAU_WORK_DIR` (default `hub/work/`). Same file types, base64 rule and 5MB cap as the brain, but plain files: no git, no lint. Writes need an open mission. The folder is deleted when the mission closes `done`, `failed` or `discarded`, whichever door closed it, and leftovers go at boot. MCP gains `write_work` and `read_work`. Review links and the dashboards show a mission's work images.
- Settings roles `librarian` and `curator`, next to `lead` and `critic`. `curator` lets an agent write the curated compartments and nothing else.
- The hub warns at boot when `BUREAU_TOKEN` is still the placeholder from `.env.example`. It still boots; anyone who has read the repo knows that token.
- Brain Format v0.3, draft: one claim grammar (short and long forms) for notes and journal records, ids, refs, the field list, the parsed form and its error codes, format versions, the derived index, and what is enforced today. `test/claims.test.js` holds the contract as fixtures with their expected parse; the reader cases are pending until the reader ships. v0.2 files stay valid.

### Changed
- **Curated compartments are hub-enforced.** `POST /api/knowledge` and MCP `write_knowledge` to `knowledge/`, `recipes/` (global and entity), `entities/<slug>/PROFILE.md` and `attic/` answer 403 unless the author is `human` or holds the `librarian` or `curator` role. Nothing is written or committed on a refusal. `journal/`, `daily/`, `projects/` and the rest stay open.
- `librarian` is now a role like `lead` and `critic`: once any agent has roles in settings, it comes from settings only, for the digest carve-out too. **If your settings hold roles, add `librarian` to your librarian's entry (and `curator` to any agent that files knowledge with you) when you upgrade**, or the librarian can no longer park its digest or write `knowledge/`. With no roles in settings, the tags work as before.
- Review evidence moves out of the brain: the docs now point screenshots at the work store instead of `deliverables/`.

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
