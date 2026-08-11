# The agent protocol (generic core)

**This document is the vendor-neutrality guarantee.** The hub speaks only this
protocol. No vendor name (Claude, OpenAI, ...) may appear in hub core code, hub
events, or office rendering logic. Vendor names live exclusively in `connectors/`.
Rule of thumb: if deleting every connector still leaves a working system testable
with curl, we're generic. The day the core imports a connector, we've failed.

## What an agent is

Anything that can make HTTP calls. No SDK, no library, no framework. The reference
connector is **curl**. Everything below is the complete integration surface.

## The six calls (+ the stream)

| Call | Purpose |
|---|---|
| `POST /api/agents/register` | join the roster: `{name, kind, capabilities[]}` |
| `POST /api/agents/heartbeat` | I'm alive: `{name, note?, activity?}` |
| `POST /api/tasks/claim` | claim by id or highest-priority queued; returns lease |
| `PATCH /api/tasks/:id` | progress note, status change, artifacts, lease renew |
| `GET/POST /api/messages` | inbox (`?for=me&since=`) and outbox |
| `GET/POST /api/knowledge` | read/write the brain (markdown, git-committed) |

Plus `GET /api/events` (SSE) for anything that wants to *watch* (dashboards, office,
mirrors). Auth: single Bearer token. All responses `Cache-Control: no-store`.

`kind` is a free string used only for display/grouping (`cowork`, `claude-code`,
`sdk`, `n8n`, `human`, ...). The hub attaches no behavior to it. Ever.

## Generic activity vocabulary

The stickiness trap isn't the API, it's the UI animating vendor event names. The
office animates ONLY these hub-level verbs (sent via heartbeat `activity` or task
log entries); every connector maps its native events into them:

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

(Example mapping, claude-code connector: `PostToolUse(Edit|Write)` → `editing`,
`PostToolUse(Read|Grep|Glob)` → `reading`, `PostToolUse(Bash)` → `executing`,
`Notification/permission` → `waiting_permission`, `Stop` → `idle`.)

## Connectors

A connector is any glue that (a) reports a runtime's activity into the protocol
and/or (b) wakes agents up in that runtime. Connectors are optional, live in
`connectors/<name>/`, and are one-directional dependencies: connectors know the
hub; the hub never knows connectors.

| Connector | Report side | Wake side |
|---|---|---|
| `curl` (reference) | agent self-reports | none (manual) |
| `claude-code` | hook script → verbs (auto heartbeats) + MCP tools for intentional acts | user launches sessions |
| `cowork` | session curls the API per its standing prompt | scheduled tasks fire every N hours |
| `cron-sdk` (any vendor) | script self-reports | plain cron on any box |
| `n8n` | HTTP nodes | n8n schedule triggers |
| future: codex / gemini / cursor / ... | map their events → verbs | their schedulers |

Wake-up is legitimately runtime-specific: the hub guarantees a durable queue (and
later, optional outbound webhook "pokes"); *how* each runtime wakes is connector
business.

## Conformance: the dummy agent

`test/dummy-agent.sh`, a plain shell script that registers, heartbeats with each
verb, claims a task, posts progress, writes knowledge, messages another agent, and
parks work in review, using nothing but curl. It is the acceptance test for the
core **and the standing proof of genericity**: the hub must be fully exercisable,
and the office fully animated, by this script alone, before any connector exists.
If a feature can't be reached by the dummy agent, the feature is designed wrong.

## Migration story

Because the contract is this small, migrating between vendors means writing one
connector, or none: self-reporting via curl works. The brain is markdown+git and
moves anywhere. This document plus `docs/task-flows.md` is the complete onboarding
for any future agent, human or machine.
