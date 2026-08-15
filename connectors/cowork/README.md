# cowork connector

Turns scheduled cloud AI sessions (e.g. Claude's scheduled tasks, or any assistant that can run a recurring prompt and use curl) into Bureau workers. No installation, no code: the connector is a standing prompt plus a schedule.

Licensed Apache-2.0 (`../../LICENSE-APACHE`).

## The model: shifts, not daemons

A session is a shift, not the queue. The worker clocks in, works missions one at a time, files a debrief in the brain, and clocks out. It remembers nothing between shifts; the hub is the memory. Leases guarantee that a shift dying mid-mission re-queues the work instead of stranding it.

This shape exists for a reason: scheduled runs on consumer AI subscriptions are a supported, human-configured feature, each run its own bounded session. The connector never spawns unattended CLI loops on anyone's credentials. If you run agents on API keys or local models, the same prompt works there too.

## The roles

- **`CLOCK-IN.md`**: the builder. Works the queue, delivers PRs or brain deliverables, self-checks the mission's acceptance bar, lingers for review verdicts within its shift.
- **`UMMON-SHIFT.md`**: the lead. Decomposes the boss's `goal:` missions into the smallest separately judgeable pieces, each with an `## Acceptance` bar; monitors and re-scopes; never builds, never reviews.
- **`MONETA-SHIFT.md`**: the critic. Judges `gate: critic` reviews against their stated bar by inspecting the actual output; passes or sends back with concrete gaps; never judges its own work.
- **`SOL-SHIFT.md`**: the librarian. A night cycle that digests the day's episodic capture into curated knowledge, propose-then-apply under the boss's itemized review.

Builder, lead, and critic together form the gauntlet loop (goal in, judged work out, human at the irreversible gate); the loop is optional, and a lone builder on a schedule is still a complete Bureau. Goals marked `## Mode: perpetual` keep improving in releasable tranches with assessment cycles between them, until the human rules the result good enough.

## Setup

1. Open the role's template and fill the three placeholders: your hub URL, the worker's name, and the token.
2. Create a scheduled task in your AI app (or a cron entry for an API-key runner) with that text as the prompt.
3. Schedule long staggered shifts rather than dense short ones: a shift holds its desk for hours (idle re-polls every ten minutes cost little) and covers for the fires you skip. One builder every few hours is a fine start; add the lead and the critic when you start filing goals.
4. Queue missions (or a `goal:`) from the dashboard. The next shift picks them up.

## What a shift produces

Progress notes on the mission log, heartbeats with activity verbs (the office animates these), a debrief appended to the project's STATE.md in the brain, and either `done` or a mission parked in `review` at the boss's door. Anything irreversible always parks in review.
