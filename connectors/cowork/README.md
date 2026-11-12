# cowork connector

Turns scheduled cloud AI sessions (e.g. Claude's scheduled tasks, or any assistant that can run a recurring prompt and use curl) into Bureau workers. No installation, no code: the connector is a standing prompt plus a schedule.

Licensed Apache-2.0 (`../../LICENSE-APACHE`).

## The model: shifts, not daemons

A session is a shift, not the queue. The worker clocks in, works missions one at a time, files a debrief in the brain, and clocks out. It remembers nothing between shifts; the hub is the memory. Leases guarantee that a shift dying mid-mission re-queues the work instead of stranding it.

This shape exists for a reason: scheduled runs on consumer AI subscriptions are a supported, human-configured feature, each run its own bounded session. The connector never spawns unattended CLI loops on anyone's credentials. If you run agents on API keys or local models, the same prompt works there too.

## The roles and the default staff

Bureau ships a template for each role, with a default name from the Hyperion Cantos. A fresh hub has no workers: one shows up when you schedule its template. Every name is just a string in a template, so rename freely.

- **`CLOCK-IN.md`**: the builders, by default **Bettik** (the tireless doer), **Severn** (the observer and researcher), and **Kassad** (the hard missions). They work the queue, deliver PRs or brain deliverables, self-check the mission's acceptance bar, and linger for review verdicts within their shift.
- **`UMMON-SHIFT.md`**: the lead, by default **Ummon**. Decomposes the boss's `goal:` missions into the smallest separately judgeable pieces, each with an `## Acceptance` bar; monitors and re-scopes; never builds, never reviews.
- **`MONETA-SHIFT.md`**: the critic, by default **Moneta**. Judges `gate: critic` reviews against their stated bar by inspecting the actual output; passes or sends back with concrete gaps; never judges its own work.
- **`SOL-SHIFT.md`**: the librarian, by default **Sol**. A night cycle that digests the day's episodic capture into curated knowledge, propose-then-apply under the boss's itemized review.
- **`BRAWNE-SHIFT.md`**: QA, by default **Brawne**. Sweeps the dashboard across viewports and themes, files one mission per defect with its evidence.
- The interactive envoy (your editor and chat sessions, see the claude-code and chat connectors) is **Consul** by default.

Builder, lead, and critic together form the gauntlet loop (goal in, judged work out, human at the irreversible gate); the loop is optional, and a lone builder on a schedule is still a complete Bureau. Goals marked `## Mode: perpetual` keep improving in releasable tranches with assessment cycles between them, until the human rules the result good enough.

## Setup

1. Mint the worker a token: Settings, Tokens, or `node hub/tools/token.js mint <name> <project>`. On a strict hub each worker needs its own, named after it. On a legacy hub the shared `BUREAU_TOKEN` works.
2. On a strict hub, give the worker its role in Settings (lead, critic, librarian). The `capabilities` a template registers with are a label there, not authority.
3. Open the role's template and fill the three placeholders: your hub URL, the worker's name, and the token.
4. Create a scheduled task in your AI app (or a cron entry for an API-key runner) with that text as the prompt.
5. Schedule a few shifts, not many. A shift clocks out as soon as the work runs dry, and with `BUREAU_POKES` set (see pokes in `docs/protocol.md`), new work summons a worker within seconds. One builder every few hours is a fine start; add the lead and the critic when you start filing goals.
6. Queue missions from the dashboard (`/missions/new`, or `/goals/new` for a goal). The next shift picks them up.

## What a shift produces

Progress notes on the mission log, heartbeats with activity verbs (the office animates these), a debrief appended to the project's STATE.md in the brain, and either `done` or a mission parked in `review` at the boss's door. The standing prompts tell a worker to park anything irreversible in review. That's a prompt, not a wall: the hub gates the mission's status and can't stop a worker holding deploy credentials.
