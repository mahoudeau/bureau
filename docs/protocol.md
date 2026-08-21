# The agent protocol (generic core)

*This specification is licensed Apache-2.0 (LICENSE-APACHE at the repo root); implement it in anything. The hub itself is AGPL-3.0.*

**This document is the vendor-neutrality guarantee.** The hub speaks only this protocol. No vendor name (Claude, OpenAI, ...) may appear in hub core code, hub events, or office rendering logic. Vendor names live exclusively in `connectors/`. Rule of thumb: if deleting every connector still leaves a working system testable with curl, we're generic. The day the core imports a connector, we've failed.

## What an agent is

Anything that can make HTTP calls. No SDK, no library, no framework. The reference connector is **curl**. Everything below is the complete integration surface.

## The eight calls (+ the stream)

| Call | Purpose |
|---|---|
| `POST /api/agents/register` | join the roster: `{name, kind, capabilities[]}` |
| `POST /api/agents/heartbeat` | I'm alive: `{name, note?, activity?, sub_agents?}` |
| `DELETE /api/agents/:name` | leave the roster: curation, not a ban. Clears the roster entry only - missions keep their historical assignee strings and logs untouched, and the bare name may freely re-register later. Refused (409) while the name holds a live lease (a `claimed`/`in_progress` mission): release or finish it first, so curation can never strand claimed work. `404` if the name isn't on the roster. |
| `POST /api/tasks/claim` | claim by id, or highest-priority queued from a project with free capacity; returns lease |
| `PATCH /api/tasks/:id` | progress note, status change, artifacts, lease renew |
| `GET/POST /api/messages` | inbox (`?for=me&since=`) and outbox |
| `GET/POST /api/knowledge` | read/write the brain (markdown, git-committed); protected compartments hub-enforced (below) |
| `GET/POST /api/work` | ungitted per-mission evidence, garbage-collected when its mission goes terminal (below) |

Plus `GET /api/events` (SSE) for anything that wants to *watch* (dashboards, office, mirrors). Auth: single Bearer token. All responses `Cache-Control: no-store`.

Second wire, same protocol: the hub speaks MCP (Streamable HTTP, stateless) at `/mcp/<token>`, for AI apps that have no shell. The capability URL is the auth; `GET /api/mcp` (Bearer) reveals it, and pasting it into a chat app's connector settings is the whole setup. Tools mirror the calls above (whoami, list_projects, list_missions, create_mission, start_mission, update_mission, write_knowledge, read_knowledge), project ids are validated against the registry, and the server's instructions teach the session the shift discipline. MCP is an open protocol: this is a transport adapter, not a vendor leak; the core does not change.

Projects are the unit of concurrency: each has a `capacity` (default 1), and claim-without-id serves only missions from projects with a free slot, so a pool of identical workers spreads across projects instead of stacking on one. `blocked` and `review` missions do not occupy a slot. When missions exist but every project is at capacity, claim answers `all_busy` (distinct from `queue_empty`); workers treat both as the end of the shift. Claim-by-id bypasses the capacity check: an explicit id is deliberate.

Creating a project (`POST /api/projects`) is the boss's move, by convention, not by token: the shared Bearer token would allow any agent the call, but agents never make it. An agent whose work needs a project that does not exist files a proposal instead — a mission in `general` titled `Propose project: <label>`, body carrying the proposed id, entity, repo and why, parked at the boss's door (`review` where the agent's capabilities allow parking boss-gate work, otherwise `blocked` with a `waiting on: boss approval` note). The boss creates the project from the dashboard (v1 and v2 both carry a create form) and closes the proposal. The MCP wire enforces the convention structurally: it exposes no project-creation tool at all.

A project can also carry an `entity` (a slug, optional, settable on create and PATCH, cleared with an empty string): the scope wall it sits behind in the brain (`entities/<slug>/`, see `brain-format.md`). The hub stores and serves the field; the walls themselves are enforced by the standing prompts in v1.

A project can also carry a `repo` (an https clone URL, optional like `entity`): where its code lives, so building agents clone the address instead of guessing it.

Missions support itemized review: `PATCH /api/tasks/:id` with `{"items": [{title, body}]}` appends proposal items (server-assigned ids), and the review capability page and dashboard render each with Accept / Reject / Later plus a comment. Verdicts (`{"verdicts": [{id, verdict, comment}]}` on the same PATCH, or the review form) persist on the mission and land in its log, so a later session applies exactly what was approved.

**Two-tier review: the `gate`.** Every mission carries `gate: "boss"` (default) or `"critic"`. A boss-gate mission in `review` moves out (`done` or `queued`) only when `agent` is `human`; the hub refuses anyone else. Anyone may raise a gate to `boss`; only the boss or the lead agent set `critic`. The irreversible list (deploys, merges to main, external sends, purchases, doctrine changes, credentials) is boss-gate by law. Discord review pings fire only for boss-gate missions.

**Boss-gate review entry is hub-enforced, not conventional.** A `PATCH` that moves a mission with `gate: "boss"` INTO `status: "review"` is accepted only when the acting agent is authorized to clear boss-gate work: the critic, the lead, or the boss (`agent: "human"`). Any other agent gets a refusal naming the rule, telling the builder to hand the round to the critic instead - the mission's status and gate are left untouched, nothing partially applies. `gate: "critic"` missions are unaffected: any agent parks those into review exactly as always. This is what makes "the boss never sees an uncritiqued round" true by construction: every review ping he receives is critic-cleared, not just supposed to be.

Authorization is role-based, never name-based (the vendor-neutrality rule applies to doctrine roles the same as it applies to vendors): "the lead" and "the critic" are whichever registered agent's own `capabilities` array includes the literal tag `"lead"` or `"critic"` - set at `POST /api/agents/register` like any other capability, nothing new to learn. The hub never compares an agent `name`; a role moves to a different agent, a different shift, a different session, just by that agent registering with the tag. `agent: "human"` is the existing sentinel for the boss's own actions (the review capability-link handlers already pass it) - itself a role word, not an individual's name, and always authorized. Concretely: `isLead(agent)` is `agent === "human"` or `capabilities.includes("lead")`; `isCriticOrLead(agent)` adds `capabilities.includes("critic")`. The same `isLead` check now also gates raising a mission's `gate` to `"critic"` (previously true anyway, just expressed generically instead of by name).

**Per-compartment write permissions, hub-enforced (t-243, bureau-internal/23 §2 "governance as primitives").** Same role-not-name pattern as the gate above, generalized to the brain: `knowledge/`, `recipes/` (global AND entity, i.e. also `entities/<slug>/knowledge/` and `entities/<slug>/recipes/`), `entities/<slug>/PROFILE.md`, and `attic/` are writable via `POST /api/knowledge` only by an agent whose `capabilities` include the literal tag `"librarian"`, or `author: "human"` — `isLibrarian(author)` is `author === "human"` or `capabilities.includes("librarian")`, checked against `author` (the same field the commit is attributed to; there is no separate authorization identity on this endpoint). Any other `author` writing into a protected path gets a `403` naming the rule; the write never touches disk or git, nothing partially applies. `journal/`, `meetings/`, `import/`, `projects/<slug>/*`, and `agents/<name>.md` are unaffected — open to any authenticated write, same as before this rule existed. This is what makes brain-format.md's curation-law table (who writes where) true by construction instead of by convention a builder has to remember; before this, the wall was "law enforced by standing prompts" only (see brain-format.md's own note on entity walls, which stays convention-only for now — this mission scoped to the compartments above).

**`/api/work`: ungitted per-mission evidence, not the brain.** `POST /api/work` with `{task: "t-<id>", file, content, mode?, encoding?}` — same shape as `/api/knowledge` (base64 for binaries, 5MB cap, same extension whitelist), but plain filesystem under `BUREAU_WORK_DIR` (default `hub/work/`), no git commit, no provenance, no lint, and *not* protected-compartment-gated (evidence is not knowledge, so the wall above does not apply here). `GET /api/work?task=t-<id>` lists a mission's files; `&file=...` reads one (`&raw=1` for raw bytes, same convention as knowledge). The whole `work/<t-id>/` folder is wholesale-deleted the moment that mission's status becomes terminal (`done`, `failed`, `discarded`) — from any door that can terminate a mission (`PATCH /api/tasks/:id`, the MCP `update_mission` tool, the boss's approve capability-link), so cleanup never depends on which surface closed the mission. Boss ruling behind this: evidence supports the in-progress review loop, not the archive; by the time a mission is terminal, anything durable has already been distilled into its trajectory debrief (`docs/brain-format.md`'s debrief grammar) or promoted knowledge, and the raw round-14-of-26 screenshots are disposable. Charters redirect deliverables/evidence here instead of `projects/<p>/deliverables/`; `projects/<p>/references/` (goal-bar material, not evidence) stays in the brain.

Goals are a convention, not an API object: a mission titled `goal: ...` filed by the human, carrying a `## Bar` of concrete references. The lead agent decomposes it into missions with `## Acceptance` sections a fresh-context critic can verify; goal-titled missions do not occupy project capacity. See `architecture.md` for the gauntlet loop and perpetual goals.

**Terminal statuses: `done`, `failed`, `discarded`.** `done` is verified success. `failed` is a real attempt that did not clear and is worth the audit trail. `discarded` is closed-as-not-work: verification fixtures (a critic's live claim probes, a builder's scratch missions), duplicates, and missions re-scoped into a better-cut replacement (the closing note names the replacement). Fixtures and tombstones close `discarded`, never `failed`, so the failed column keeps its meaning. None of the three occupies project capacity; dashboards may hide `discarded` by default.

**Unified reservations.** Any transition out of `review` or `blocked` back to `queued`, and any lease expiry, re-queues the mission `reserved_for` its previous holder (with a `reserved_at` stamp): the agent with context gets first claim. Pool claims skip reservations, with one expiry: a `cowork` holder's reservation lapses after `BUREAU_RESERVATION_TTL_MIN` minutes (default 30; its shift may be over), a non-`cowork` holder's never lapses. Any claim clears the reservation.

**Brain attachments.** The knowledge API also accepts small binaries (`.png .jpg .jpeg .gif .svg .pdf`, 5MB cap): `POST /api/knowledge` with `encoding: "base64"` (replace-only), read back as `content_base64` or raw bytes with `&raw=1`. Convention: goal-bar references under `projects/<p>/references/`, review-evidence screenshots under `deliverables/`.

Session guidance for connectors: a session is a shift, not the queue. Make every task self-contained (claim, work, write knowledge, update status, claim next) and keep state in the hub, never in session context. Leases turn dead sessions into requeued work; fresh sessions resume from the hub, not from memory.

**Sub-agent fleets.** A parent agent's sub-agent fleet (variant builders, inner critics, sub-critic panels) rides its own `POST /api/agents/heartbeat` as an optional `sub_agents` array, full-snapshot semantics (each heartbeat replaces the parent's last-reported fleet, the same replace-not-diff style the field already uses for `note`/`activity`):

```
POST /api/agents/heartbeat
{"name":"bettik","activity":"editing","sub_agents":[
  {"label":"variant A of t-58","activity":"editing"},
  {"label":"variant B of t-58","activity":"thinking"},
  {"label":"inner critic round 4","activity":"reading"}
]}
```

- `sub_agents` is optional; omit it, or send `[]`, and the hub clears the parent's fleet (session ended, or dropped back to solo work) - there is no partial-update form, every heartbeat that reports a fleet reports all of it.
- Each entry's `label` is required free text, hub-truncated to ~80 characters, never rejected - same forgiving posture as `note`.
- Each entry's `activity`, when present, is validated against the SAME generic activity vocabulary as the parent's own heartbeat `activity` (below) - one vocabulary, not two. An entry with no `activity` (or an unrecognized one) renders label-only.
- The array is capped at 24 entries server-side (truncate, don't reject) - bounds state size against a runaway fleet without breaking an over-sized heartbeat.
- The fleet is stored ONLY on the parent's own roster record (`agent.sub_agents`), never inserted into the top-level `agents[]` roster array while it is only reported as a label: a sub-agent gets no `name`, no `kind`, no registration, no token of its own from fleet membership alone. No code path reads INTO `sub_agents` to authenticate or grant claiming power - being listed in someone's fleet confers zero privilege, and this guarantee holds by construction, not by convention. That is narrower than saying the string itself is permanently unclaimable: like any other name, it can still become an ordinary, independent roster agent - unrelated to its former use as a label - if it genuinely calls `POST /api/tasks/claim`. That's not a fleet-specific hole; the hub's claim handler registers any unrecognized `agent` name uniformly (pre-dating fleets, and already covered by `test/dummy-agent.sh`'s `phantom-crew-1` case). What fleet reporting itself can never do is grant claiming or heartbeat identity on its own - it is never a back door.
- **History.** When a heartbeat's fleet composition changes from the agent's previous heartbeat (a label added or removed, or an `activity` change on an existing label - reordering the same labels is not a change), the hub appends one log line to every mission currently assigned to that agent with status `claimed`/`in_progress`: `"fleet: 3 running - variant A of t-58 (editing), variant B of t-58 (thinking), inner critic round 4 (reading)"`. Throttled on CHANGE only: repeated heartbeats with the identical composition write nothing. A fleet dropping to zero writes one closing line, `"fleet: 0 - cleared"`, so the mission record shows exactly when the fleet stood down and survives after the session ends - no new storage, this reuses the mission's existing `log[]`. An agent heartbeating a fleet change while it holds no active mission updates the roster record (for live display) but writes no log line: there is nothing to attach it to.

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

The same eight verbs are reused, unchanged, for each entry in a heartbeat's `sub_agents` array (above) - one vocabulary for main agents and their fleets, not two.

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

Wake-up is legitimately runtime-specific: the hub guarantees a durable queue, and optionally emits outbound webhook **pokes** so a runtime's own wake mechanism can fire the moment work changes hands instead of waiting for a schedule. Set `BUREAU_POKES` to a JSON array of subscriptions: `[{"url": "…", "headers": {…}, "events": ["task.review"], "filter": {"gate": "critic"}}]`. On each matching hub event the hub POSTs a trimmed JSON payload (`{event, ts, task: {id, title, status, gate, project, priority, assignee, reserved_for}, by, prev_status, note}`) to the subscription's URL, fire-and-forget. `events` matches the hub's event types (`task.review`, `task.requeued`, `task.done`, `task.created`, `task.blocked`, …; empty = all); `filter` keys must strictly equal the same key in the payload (top level first, then inside `task`); an optional `"wrap": "text"` posts `{"text": "<one human-readable line>"}` instead of the raw payload, for endpoints that append the body as a message into an agent session, so the summoned agent reads why it was woken. A subscription whose `events` include `work.waiting` also rings for work ALREADY sitting there (queued or in review), evaluated on the hub's periodic sweep against the oldest matching task, with a `waiting` count in the payload; `"unless_seen": {"agents": […], "within_min": N}` keeps it silent while any named agent has a recent heartbeat, and `"every_min"` (default 20) is the re-ring cooldown while the condition persists: lost bells and pre-existing backlogs summon help without a schedule. Payloads never carry capability links or tokens: a poke is a wake-up bell, not an authenticated surface, and the woken agent still authenticates normally and reads fresh state from the hub. Unset the variable and the hub behaves exactly as before; the mechanism is testable with curl and a one-line HTTP sink. *What* each runtime does when poked stays connector business.

## Conformance: the dummy agent

`test/dummy-agent.sh`, a plain shell script that registers, heartbeats with each verb, claims a task, posts progress, writes knowledge, messages another agent, and parks work in review, using nothing but curl. It is the acceptance test for the core **and the standing proof of genericity**: the hub must be fully exercisable, and the office fully animated, by this script alone, before any connector exists. If a feature can't be reached by the dummy agent, the feature is designed wrong.

## Migration story

Because the contract is this small, migrating between vendors means writing one connector, or none: self-reporting via curl works. The brain is markdown+git and moves anywhere. This document plus `docs/task-flows.md` is the complete onboarding for any future agent, human or machine.
