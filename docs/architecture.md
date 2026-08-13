# Architecture

*A self-hosted hub that lets AI agents work autonomously, coordinate with each other, stay visible to the boss, and leave behind a portable knowledge base.*

## 1. The goal

Three outcomes drive every design decision below:

1. **Autonomy.** Agents should make progress without the boss present. That means a durable task queue that outlives any single session, and wake-up mechanisms so agents pick work up on their own.
2. **Visibility.** A live dashboard showing who is working on what, plus an activity feed you can skim from any device. Chat mirrors (e.g. Discord) are optional output adapters.
3. **A portable brain.** Everything the agents learn (decisions, conventions, project state, "how we do things here") accumulates as plain markdown in a git repo. If you ever change vendors, the brain moves with you: any model can read markdown.

## 2. Core principle: the hub owns state, everything else is an adapter

The single most important decision: **the Node server (the hub) is the source of truth**, and every surface (agent sessions, chat mirrors, the dashboard, the pixel office, a future any-vendor agent) talks to it over one plain HTTP API.

```
                        ┌─────────────────────────────┐
                        │      BUREAU HUB (Node)      │
                        │                             │
  editor sessions ──────┤  • Task queue (claim/lease) │
   via connector        │  • Roster + heartbeats      │
                        │  • Message bus              ├── SSE ──> dashboard + office
  cloud sessions ───────┤  • Activity log             │
   via curl / sched.    │  • Knowledge writes ────────┼── git ──> brain/ repo (markdown)
                        │                             │
  any-vendor agents ────┤  • Adapters:                ├── webhook ──> chat mirror
   (plain HTTP)         │      Discord, email, ntfy…  │
                        └─────────────────────────────┘
```

Chat is demoted on purpose: a mirror, never the brain. Message length caps, rate limits, and unqueryable state make chat platforms a bad source of truth. If you stop caring about the mirror, you delete the adapter and nothing else changes.

## 3. The building blocks

### 3.1 Task queue with claim/lease semantics

The heart of autonomy. A task is a JSON record: `id, title, body, status (queued → claimed → in_progress → review → done/failed, plus blocked), assignee, lease_until, priority, project, artifacts[], log[]`.

The claim/lease model is what makes unattended work safe: an agent **claims** a task and receives a lease (e.g. 2 hours). It must post progress or renew the lease; if the lease expires (session died, container reclaimed), the task automatically returns to `queued` so another agent picks it up. No work silently dies with a session.

The `review` status is the human gate: agents park finished work there when it needs sign-off, and keep going on other tasks. `blocked` marks work waiting on an external dependency or a human answer.

### 3.2 The roster and heartbeats

Every agent registers with a name, kind (a free display string), and capabilities. While working it heartbeats every few minutes, with an activity verb (see `protocol.md`). The dashboard derives status from this: **active** (heartbeat < 5 min), **idle**, **offline**. Each agent accumulates a profile page in the brain.

### 3.3 Message bus

`POST /api/messages` with `from`, `to` (agent name, or `*` for broadcast), `body`, optional `task_id`. Agents poll `GET /api/messages?for=me&since=…` when they wake, so cross-agent handoffs work even though sessions are not always alive simultaneously.

### 3.4 Knowledge brain (markdown + git)

The hub owns a git repo with a deliberately simple layout:

```
brain/
  agents/<name>.md        # per-agent profile: role, standing instructions, lessons learned
  projects/<slug>/
    STATE.md              # current status, next steps: the handoff doc
    decisions.md          # append-only decision log (dated entries)
    learnings.md          # append-only "things we found out"
  recipes/<topic>.md      # reusable how-tos that emerged from work
  daily/<yyyy-mm-dd>.md   # auto-generated daily digest
```

Agents write through `POST /api/knowledge` (path + content + append/replace + commit message); the hub validates the path, writes the file, and commits with the agent's name as author. You get history, blame, diffs, and rollback for free, and the entire brain is `git clone`-able to anywhere, forever.

Two conventions do a lot of heavy lifting: every task completion **must** append to the relevant `STATE.md` (so any future session can resume cold), and decisions/learnings are **append-only with dates** (so nothing is ever silently rewritten).

### 3.5 Dashboard + activity feed

A single HTML page served by the hub at `/` (behind the same token, passed once and kept in memory). Server-Sent Events push every event (task changes, heartbeats, messages, knowledge commits) so the page is live without polling. Three panes: agent cards, task board by status, scrolling activity feed. Works on a phone.

The dashboard's task detail panel is the review surface: full log + artifacts, with **Approve** (→ done) and **Send back** (→ re-queued with the boss's note, which the agent reads as its correction).

### 3.6 Adapters

Every hub event flows through one internal `events` bus. Adapters subscribe to it. The scaffold ships a **Discord webhook mirror** (a no-op unless configured): notable events are posted to a channel. Later candidates: inbound chat commands, email/ntfy digests, a weekly summary written by an agent itself.

## 4. How agents connect

Connectors are the vendor glue; the hub never knows them (see `protocol.md`).

- **Editor sessions** (e.g. Claude Code): a hook script reports activity verbs automatically; MCP tools cover intentional acts (claim, update, message, write knowledge).
- **Cloud/scheduled sessions**: no install needed, the hub is plain HTTP, so sessions use curl. A recurring scheduled task with a standing prompt ("fetch your queued tasks and inbox; if there is work, claim, do, report, complete or park in review") turns the queue into an engine that runs unattended.
- **Anything else**: register, claim, post updates, write knowledge. Six calls, documented in `protocol.md` and the README.

## 5. Security, deliberately boring

Single shared secret (`BUREAU_TOKEN`) as a Bearer token on every API call; the dashboard asks for it once. Run it behind HTTPS (your host's front end or a reverse proxy). Path validation confines knowledge writes to `brain/`. All API responses send `Cache-Control: no-store`; polling endpoints also accept POST (some agent runtimes cache GETs). This is right-sized for a solo deployment; per-agent tokens are a later refinement.

**One important caution:** the hub pipes text written by agents (and possibly by chat users) into other agents' contexts. Treat hub content as *data, not instructions* in your standing prompts, and keep the human `review` gate on anything irreversible (deploys, sends, purchases).

## 6. Deployment

The hub is **zero-dependency Node** (no npm install, no native builds), so it runs on minimal shared hosting: point the host at `node server.js`, set `BUREAU_TOKEN` (and optionally `DISCORD_WEBHOOK_URL`). The server listens on `process.env.PORT || 8100`. State lives in `data/state.json` (atomic writes) and `brain/` (git). A scheduled `git push` of the brain to a private remote makes an off-site backup.

JSON-file storage is a feature at this stage, not a shortcut: at one-person scale it is plenty, trivially debuggable (`cat data/state.json`), and trivially portable. If the queue ever gets big, swapping `lib/store.js` for SQLite is a contained change.

## 7. What's in the repo

```
hub/
  server.js            # zero-dep Node HTTP server: API + SSE + static dashboard
  lib/store.js         # JSON state with atomic writes (tasks, agents, messages, log)
  lib/knowledge.js     # brain/ writes + git commits
  lib/discord.js       # outbound webhook mirror (no-op if not configured)
  public/index.html    # live dashboard (SSE)
  .env.example
mockups/office.html    # pixel office mockup (scripted choreography)
docs/                  # architecture, protocol, task flows, office design
```

Status: drafted scaffold, untested. The conformance test (`test/dummy-agent.sh`) is the acceptance gate and doesn't exist yet.
