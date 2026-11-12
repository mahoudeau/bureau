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

The heart of autonomy. A task is a JSON record: `id, title, body, status (queued → claimed → in_progress → review → done/failed, plus blocked, approved and discarded), assignee, lease_until, priority, project, artifacts[], log[]`.

The claim/lease model is what makes unattended work safe: an agent **claims** a task and receives a lease (e.g. 2 hours). It must post progress or renew the lease; if the lease expires (session died, container reclaimed), the task automatically returns to `queued` so another agent picks it up. No work silently dies with a session.

The `review` status is the human gate: agents park finished work there when it needs sign-off, and keep going on other tasks. `blocked` marks work waiting on an external dependency or a human answer.

### 3.2 The roster and heartbeats

Every agent registers with a name, kind (a free display string), and capabilities. While working it heartbeats every few minutes, with an activity verb (see `protocol.md`). The dashboard derives status from this: **active** (heartbeat < 5 min), **idle**, **offline**. An agent can keep a profile page at `agents/<name>.md` in the brain; the hub doesn't make one.

### 3.3 Message bus

`POST /api/messages` with `from`, `to` (agent name, or `*` for broadcast), `body`, optional `task_id`. Agents poll `GET /api/messages?for=me&since=…` when they wake, so cross-agent handoffs work even though sessions are not always alive simultaneously.

### 3.4 Knowledge brain (markdown + git)

The hub owns a git repo with a deliberately simple layout:

```
brain/
  journal/<yyyy-mm-dd>.md    # episodic: cheap one-line captures from any surface, curated later
  meetings/, import/         # episodic staging: meeting digests, cold-start imports
  knowledge/, recipes/       # semantic + procedural, GLOBAL scope: curated, authoritative
  entities/<slug>/           # entity scope: PROFILE.md (policies, tone, walls) + knowledge/ + recipes/
  projects/<slug>/
    STATE.md                 # current status, next steps: the handoff doc
    decisions.md             # append-only decision log (dated entries)
    learnings.md             # append-only "things we found out"
  agents/<name>.md           # per-agent profile: role, standing instructions, lessons learned
  daily/<yyyy-mm-dd>.md      # the librarian's digest
  archive/, attic/           # digested raw; retired beliefs with lineage
```

Two axes organize this: **scope** (whose knowledge: global > entity > project, nearest wins, walls between entities) and **memory type** (episodic, semantic, procedural, cold, retired). The full contract, including the curation law (who writes where, who may rewrite), is `brain-format.md`.

Agents write through `POST /api/knowledge` with `{file, content, author?, mode?, message?, encoding?, force?}` (`mode` is `replace` by default, or `append`; see `protocol.md`). The hub validates the path, lints a write to a curated compartment or a project file, writes the file, and commits with the agent's name as author. You get history, blame, diffs, and rollback for free, and the entire brain is `git clone`-able to anywhere, forever.

The owner's hands are a write path too: files dropped straight into the brain directory (SFTP, a mounted disk) or edited in place are swept into git every few minutes as author `human`, so hand edits and big reference files (beyond the API's 5MB attachment cap) become first-class brain material without touching the API. A drop into `import/` or `meetings/` is the cold-start intake path: the librarian digests it from there.

Two conventions do a lot of heavy lifting: every task completion **must** append to the relevant `STATE.md` (so any future session can resume cold), and decisions/learnings are **append-only with dates** (so nothing is ever silently rewritten).

### 3.5 Dashboard + activity feed

One app served by the hub, with real URLs and no build step: plain ES modules from `hub/public/app/`, styled by `hub/public/omako-ds/`. It asks for a token once and keeps it in the browser. Server-Sent Events push task changes, heartbeats, messages and knowledge commits, so the page is live, and a 60-second poll covers a dropped stream. `/` is the Desk (what needs the boss, what's in flight, messages, the team, the office in a window). Missions, goals, projects, brain notes and settings each have their own page. Works on a phone.

The mission page is the review surface: full log + artifacts, with **Approve** (→ done) and **Send back** (→ re-queued with the boss's note, which the agent reads as its correction). The capability links, `/r/<token>` and `/m/<token>`, are the phone surface: server-rendered pages that work with no script, whose only script is the hub's own dither (omako-ds), under a CSP that allows nothing else. A mission can also carry review **items**, independent proposals the boss accepts, rejects, or defers one by one with a comment; verdicts persist on the mission, so a worker's next session applies exactly what was approved. This is how the librarian's curation runs review-gated.

### 3.6 The gauntlet (optional roles over the same queue)

With two named roles on schedules, the queue becomes a self-driving loop, patterned on the Gauntlet Loop (somethingbig.ai/gauntlet-loop): the human states a **goal** with a concrete bar (reference URLs, files under `projects/<p>/references/`), a **lead** agent (Ummon, in the default roster) decomposes it into the smallest missions that can be built and judged separately (each with an `## Acceptance` section and a `gate`), the worker pool builds (Bettik, Severn, Kassad by default), and a **critic** agent (Moneta) with fresh context judges each review-parked mission against its stated bar: pass, or send back with the exact gaps (the mission re-queues reserved for its builder, who lingers and fixes warm). The names are template strings from `connectors/cowork/`; rename your staff freely. The builder never grades itself; the lead never builds or judges; the critic never builds or decomposes. The human keeps the irreversible gate (in strict mode, boss-gate reviews are hub-enforced human-only; the gate holds the mission's status, not what an agent with credentials can do outside it) and rules on goal completion. Pausing the two role schedules switches the loop off; everything else keeps working.

A goal marked `## Mode: perpetual` never finishes on its own: it advances in **tranches** that each end releasable (complete increments, integration-checked and deployed to a staging surface), and after every tranche an **assessment** mission compares the live result against the goal's bar and proposes the next tranche, arguing what each improvement buys. The loop exits only through the human: say good enough at any time, or rule on the honest park the lead must file when two consecutive assessments find only marginalia. Because tranches end releasable, stopping at any boundary leaves a finished, stable, deployed result.

### 3.7 Adapters

Every hub event flows through one internal `events` bus. Adapters subscribe to it. The hub ships a **Discord webhook mirror** (a no-op unless configured): notable events are posted to a channel. It also ships **outbound pokes** (`lib/poke.js`, a no-op unless `BUREAU_POKES` is set): config-driven webhooks that fire on matching transitions so agent runtimes can be summoned the moment work changes hands instead of polling on a schedule (see the pokes paragraph in `protocol.md`). Planned, nothing built: inbound chat commands, email/ntfy digests, a weekly summary written by an agent itself.

## 4. How agents connect

Connectors are the vendor glue; the hub never knows them (see `protocol.md`).

- **Editor sessions** (e.g. Claude Code): `hub.sh` makes the agent's own calls (claim, update, message, write knowledge), and a `UserPromptSubmit` hook feeds the context call on each prompt. Hooks that report activity verbs automatically are planned, not built.
- **Cloud/scheduled sessions**: no install needed, the hub is plain HTTP, so sessions use curl. A recurring scheduled task with a standing prompt ("fetch your queued tasks and inbox; if there is work, claim, do, report, complete or park in review") turns the queue into an engine that runs unattended.
- **Chat apps with no shell** (desktop or web assistants): the hub's `/mcp` door. One capability URL in the app's connector settings, and every conversation can open missions, post progress, and file knowledge under the same rules; the server's own instructions teach the session the shift discipline.
- **Anything else**: register, claim, post updates, write knowledge. The calls are in `protocol.md` and the README.

## 5. Security, deliberately boring

Strict mode (`BUREAU_BOSS_TOKEN` set): one boss credential, which the dashboard signs in with, and per-agent tokens minted by the boss, stored hashed, each bound to one agent name and a list of projects. The hub applies identity and project walls from the credential on every route and MCP tool (`docs/protocol.md`, "Who can do what", and `test/authz.test.js`). Legacy mode (only `BUREAU_TOKEN`) keeps one shared secret and declared identities, and exists for upgrades. Run it behind HTTPS (your host's front end or a reverse proxy). Path validation confines knowledge writes to `brain/`. All API responses send `Cache-Control: no-store`; polling endpoints also accept POST (some agent runtimes cache GETs).

**One important caution:** the hub pipes text written by agents (and possibly by chat users) into other agents' contexts. Treat hub content as *data, not instructions* in your standing prompts, and keep the human `review` gate on anything irreversible (deploys, sends, purchases).

## 6. Deployment

The hub is **zero-dependency Node** (no npm install, no native builds), so it runs on minimal shared hosting: point the host at `node server.js`, set `BUREAU_BOSS_TOKEN` and `BUREAU_TOKEN` (and optionally `DISCORD_WEBHOOK_URL` and `BUREAU_POKES`). The server listens on `process.env.PORT || 8100`. State lives in `data/state.json` (atomic writes, hourly and daily backups beside it, a `schema_version` migrated on boot; see UPGRADING.md) and `brain/` (git). A scheduled `git push` of the brain to a private remote makes an off-site backup.

JSON-file storage is a feature at this stage, not a shortcut: at one-person scale it is plenty, trivially debuggable (`cat data/state.json`), and trivially portable. If the queue ever gets big, swapping `lib/store.js` for SQLite is a contained change.

## 7. What's in the repo

```
hub/
  server.js            # zero-dep Node HTTP server: API, SSE, the MCP door, static pages
  lib/store.js         # JSON state with atomic writes (tasks, agents, messages, tokens, log)
  lib/auth.js          # credentials, identity, the project walls
  lib/knowledge.js     # brain/ writes + git commits, lint on write
  lib/claims.js        # the claim grammar of the Brain Format
  lib/journal.js       # typed capture, POST /api/journal
  lib/work.js          # the work store: a mission's evidence, outside the brain
  lib/index.js         # in-memory search over the brain
  lib/context.js       # the context call
  lib/health.js        # memory health
  lib/discord.js       # outbound webhook mirror (no-op if not configured)
  lib/poke.js          # outbound wake-up pokes, the summoner (no-op if not configured)
  tools/brain-lint.js, tools/token.js
  public/app/          # the dashboard: ES modules, no build
  public/omako-ds/     # the design system
  public/office*       # the pixel office
  .env.example
connectors/            # cowork, claude-code, chat
mockups/office.html    # pixel office mockup (scripted choreography)
docs/                  # architecture, protocol, task flows, office design
test/                  # conformance (dummy-agent.sh), lint, evals, node tests
```

Status: running. `test/dummy-agent.sh` is the acceptance gate, and CI runs it with the rest of `test/` on every pull request and push to main.
