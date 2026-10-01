# Changelog

All notable changes to Bureau are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). The hub reports its version on `GET /api/health` (behind the token); it lives in `hub/version.js`.

Self-hosters: read [UPGRADING.md](UPGRADING.md) before moving between versions.

## [Unreleased]

### Added
- `state.json` carries `schema_version`. The hub runs ordered migrations on boot and keeps the previous file as `state.json.pre-migrate-<ts>` first. A file without the field is version 0 and migrates to 1.
- Rolling backups of the state: `state.json.bak.1` (newest) to `.bak.24`, one per hour, plus a daily snapshot `state.json.daily-YYYY-MM-DD`, seven kept. Tunable with `BUREAU_BACKUP_INTERVAL_MS`, `BUREAU_BACKUP_KEEP`, `BUREAU_DAILY_KEEP`.
- The new `GET /api/health` reports `version` and `schema_version`, behind the token. `GET /health` stays public and shows liveness only.
- `hub/version.js`, the single place the version lives. The MCP door's `serverInfo` reads it too.
- `test/storage.sh`, a self-contained check of everything above.

### Changed
- State writes are fsynced before the rename.
- A shutdown (SIGINT, SIGTERM) flushes a pending write instead of dropping it. Before, a write inside the 100 ms debounce window was lost.

### Fixed
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

[Unreleased]: https://github.com/mahoudeau/bureau/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mahoudeau/bureau/releases/tag/v0.1.0
