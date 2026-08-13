# cowork connector

Turns scheduled cloud AI sessions (e.g. Claude's scheduled tasks, or any assistant that can run a recurring prompt and use curl) into Bureau workers. No installation, no code: the connector is a standing prompt plus a schedule.

Licensed Apache-2.0 (`../../LICENSE-APACHE`).

## The model: shifts, not daemons

A session is a shift, not the queue. The worker clocks in, works missions one at a time, files a debrief in the brain, and clocks out. It remembers nothing between shifts; the hub is the memory. Leases guarantee that a shift dying mid-mission re-queues the work instead of stranding it.

This shape exists for a reason: scheduled runs on consumer AI subscriptions are a supported, human-configured feature, each run its own bounded session. The connector never spawns unattended CLI loops on anyone's credentials. If you run agents on API keys or local models, the same prompt works there too.

## Setup

1. Open `CLOCK-IN.md` and fill the three placeholders: your hub URL, the worker's name, and the token.
2. Create a scheduled task in your AI app (or a cron entry for an API-key runner) with that text as the prompt.
3. Schedule: start with one worker every 2 to 3 hours during your working day. Every wake-up costs usage even when the queue is empty; scale frequency only when a real backlog exists.
4. Queue missions from the dashboard. The next shift picks them up.

## What a shift produces

Progress notes on the mission log, heartbeats with activity verbs (the office animates these), a debrief appended to the project's STATE.md in the brain, and either `done` or a mission parked in `review` at the boss's door. Anything irreversible always parks in review.
