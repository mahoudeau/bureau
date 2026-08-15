# The agent protocol (generic core)

*This specification is licensed Apache-2.0 (LICENSE-APACHE at the repo root); implement it in anything. The hub itself is AGPL-3.0.*

**This document is the vendor-neutrality guarantee.** The hub speaks only this protocol. No vendor name (Claude, OpenAI, ...) may appear in hub core code, hub events, or office rendering logic. Vendor names live exclusively in `connectors/`. Rule of thumb: if deleting every connector still leaves a working system testable with curl, we're generic. The day the core imports a connector, we've failed.

## What an agent is

Anything that can make HTTP calls. No SDK, no library, no framework. The reference connector is **curl**. Everything below is the complete integration surface.

## The six calls (+ the stream)

| Call | Purpose |
|---|---|
| `POST /api/agents/register` | join the roster: `{name, kind, capabilities[]}` |
| `POST /api/agents/heartbeat` | I'm alive: `{name, note?, activity?}` |
| `POST /api/tasks/claim` | claim by id, or highest-priority queued from a project with free capacity; returns lease |
| `PATCH /api/tasks/:id` | progress note, status change, artifacts, lease renew |
| `GET/POST /api/messages` | inbox (`?for=me&since=`) and outbox |
| `GET/POST /api/knowledge` | read/write the brain (markdown, git-committed) |

Plus `GET /api/events` (SSE) for anything that wants to *watch* (dashboards, office, mirrors). Auth: single Bearer token. All responses `Cache-Control: no-store`.

Second wire, same protocol: the hub speaks MCP (Streamable HTTP, stateless) at `/mcp/<token>`, for AI apps that have no shell. The capability URL is the auth; `GET /api/mcp` (Bearer) reveals it, and pasting it into a chat app's connector settings is the whole setup. Tools mirror the calls above (whoami, list_projects, list_missions, create_mission, start_mission, update_mission, write_knowledge, read_knowledge), project ids are validated against the registry, and the server's instructions teach the session the shift discipline. MCP is an open protocol: this is a transport adapter, not a vendor leak; the core does not change.

Projects are the unit of concurrency: each has a `capacity` (default 1), and claim-without-id serves only missions from projects with a free slot, so a pool of identical workers spreads across projects instead of stacking on one. `blocked` and `review` missions do not occupy a slot. When missions exist but every project is at capacity, claim answers `all_busy` (distinct from `queue_empty`); workers treat both as the end of the shift. Claim-by-id bypasses the capacity check: an explicit id is deliberate.

A project can also carry an `entity` (a slug, optional, settable on create and PATCH, cleared with an empty string): the scope wall it sits behind in the brain (`entities/<slug>/`, see `brain-format.md`). The hub stores and serves the field; the walls themselves are enforced by the standing prompts in v1.

A project can also carry a `repo` (an https clone URL, optional like `entity`): where its code lives, so building agents clone the address instead of guessing it.

Missions support itemized review: `PATCH /api/tasks/:id` with `{"items": [{title, body}]}` appends proposal items (server-assigned ids), and the review capability page and dashboard render each with Accept / Reject / Later plus a comment. Verdicts (`{"verdicts": [{id, verdict, comment}]}` on the same PATCH, or the review form) persist on the mission and land in its log, so a later session applies exactly what was approved.

**Two-tier review: the `gate`.** Every mission carries `gate: "boss"` (default) or `"critic"`. A boss-gate mission in `review` moves out (`done` or `queued`) only when `agent` is `human`; the hub refuses anyone else. Anyone may raise a gate to `boss`; only the boss or the lead agent set `critic`. The irreversible list (deploys, merges to main, external sends, purchases, doctrine changes, credentials) is boss-gate by law. Discord review pings fire only for boss-gate missions.

Goals are a convention, not an API object: a mission titled `goal: ...` filed by the human, carrying a `## Bar` of concrete references. The lead agent decomposes it into missions with `## Acceptance` sections a fresh-context critic can verify; goal-titled missions do not occupy project capacity. See `architecture.md` for the gauntlet loop and perpetual goals.

**Unified reservations.** Any transition out of `review` or `blocked` back to `queued`, and any lease expiry, re-queues the mission `reserved_for` its previous holder (with a `reserved_at` stamp): the agent with context gets first claim. Pool claims skip reservations, with one expiry: a `cowork` holder's reservation lapses after `BUREAU_RESERVATION_TTL_MIN` minutes (default 30; its shift may be over), a non-`cowork` holder's never lapses. Any claim clears the reservation.

**Brain attachments.** The knowledge API also accepts small binaries (`.png .jpg .jpeg .gif .svg .pdf`, 5MB cap): `POST /api/knowledge` with `encoding: "base64"` (replace-only), read back as `content_base64` or raw bytes with `&raw=1`. Convention: goal-bar references under `projects/<p>/references/`, review-evidence screenshots under `deliverables/`.

Session guidance for connectors: a session is a shift, not the queue. Make every task self-contained (claim, work, write knowledge, update status, claim next) and keep state in the hub, never in session context. Leases turn dead sessions into requeued work; fresh sessions resume from the hub, not from memory.

`kind` is a free string (`cowork`, `claude-code`, `sdk`, `n8n`, `human`, ...) used for display/grouping, with one deliberate exception: `cowork` marks an agent as an interchangeable pool worker, and only the reservation rules read it (a non-`cowork` agent's missions come back reserved after an answer or a lease expiry, because that agent likely holds local context a pool worker cannot see). Everything else attaches no behavior to `kind`.

## Generic activity vocabulary

The stickiness trap isn't the API, it's the UI animating vendor event names. The office animates ONLY these hub-level verbs (sent via heartbeat `activity` or task log entries); every connector maps its native events into them:

| Verb | Meaning | Office animation |
|---|---|---|
| `editing` | writing/changing files or content | typing at desk |
| `reading` | searching, reading, browsing | reading at desk |
| `executing` | running commands/builds/tests | terminal flicker |
| `thinking` | planning, reasoning, no output yet | thought bubble |
| `waiting_input` | needs a human answer | bubble + waves at camera |
| `waiting_permission` | needs approval to proceed | bubble at the boss's door |
| `blocked` | waiting on external dependency | sits on the waiting bench |
| `idle` | alive, no work | coffee machine / wander |

(Example mapping, claude-code connector: `PostToolUse(Edit|Write)` → `editing`, `PostToolUse(Read|Grep|Glob)` → `reading`, `PostToolUse(Bash)` → `executing`, `Notification/permission` → `waiting_permission`, `Stop` → `idle`.)

## Connectors

A connector is any glue that (a) reports a runtime's activity into the protocol and/or (b) wakes agents up in that runtime. Connectors are optional, live in `connectors/<name>/`, and are one-directional dependencies: connectors know the hub; the hub never knows connectors.

| Connector | Report side | Wake side |
|---|---|---|
| `curl` (reference) | agent self-reports | none (manual) |
| `claude-code` | hook script → verbs (auto heartbeats) + MCP tools for intentional acts | user launches sessions |
| `cowork` | session curls the API per its standing prompt | scheduled tasks fire every N hours |
| `cron-sdk` (any vendor) | script self-reports | plain cron on any box |
| `n8n` | HTTP nodes | n8n schedule triggers |
| future: codex / gemini / cursor / ... | map their events → verbs | their schedulers |

Wake-up is legitimately runtime-specific: the hub guarantees a durable queue (and later, optional outbound webhook "pokes"); *how* each runtime wakes is connector business.

## Conformance: the dummy agent

`test/dummy-agent.sh`, a plain shell script that registers, heartbeats with each verb, claims a task, posts progress, writes knowledge, messages another agent, and parks work in review, using nothing but curl. It is the acceptance test for the core **and the standing proof of genericity**: the hub must be fully exercisable, and the office fully animated, by this script alone, before any connector exists. If a feature can't be reached by the dummy agent, the feature is designed wrong.

## Migration story

Because the contract is this small, migrating between vendors means writing one connector, or none: self-reporting via curl works. The brain is markdown+git and moves anywhere. This document plus `docs/task-flows.md` is the complete onboarding for any future agent, human or machine.
