# cowork connector

Turns scheduled cloud AI sessions (e.g. Claude's routines, or any assistant that can run a recurring prompt with an MCP connector) into Bureau workers. No installation, no code: the connector is a standing prompt, a schedule, and one signed-in Bureau connector per worker.

Licensed Apache-2.0 (`../../LICENSE-APACHE`).

## The model: shifts, not daemons

A session is a shift, not the queue. The worker clocks in, works missions one at a time, files a debrief in the brain, and clocks out. It remembers nothing between shifts; the hub is the memory. Leases guarantee that a shift dying mid-mission re-queues the work instead of stranding it.

This shape exists for a reason: scheduled runs on consumer AI subscriptions are a supported, human-configured feature, each run its own bounded session. The connector never spawns unattended CLI loops on anyone's credentials. If you run agents on API keys or local models, the same prompt works there too, as long as the runner can reach an MCP server.

## Identity: one connector per worker

Each worker reaches the hub through its own MCP connector, named `Bureau (<agent>)`, at `https://<hub>/mcp/agent/<agent>`. The address holds no secret. The owner adds it once, signs in with OMAKO, and allows the app in Bureau; from then on every tool on that connector acts as that agent. The prompts never hold a token and never call the hub with curl. A worker whose connector is missing, still waiting for an owner, or denied stops at its first call and says so.

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

1. **Turn on sign-in for the agent.** In Bureau, Settings, Sign-in tab, under "Agents that sign in", add the worker's name. The tab shows its address: `https://<hub>/mcp/agent/<name>`.
2. **Give it its role.** On a hub with roles in Settings, give the worker its role there (lead, critic, librarian). The `capabilities` a template clocks in with are a label there, not authority.
3. **Add the connector in claude.ai.** Settings, Connectors, add a custom connector named `Bureau (<name>)` with the agent's address. Sign in with OMAKO when claude.ai asks.
4. **Allow the app.** Back in Bureau, the app waits on the Desk under "Apps waiting for you" (and in Settings, Sign-in). Allow it for that agent. Deny anything you did not connect yourself.
5. **Paste the charter.** Open the role's template, fill the worker's name (and, for Brawne, the hub's address she sweeps), and use the text below the line as the routine's prompt. Attach the worker's `Bureau (<name>)` connector to the routine, and no other Bureau connector.
6. **Schedule a few shifts, not many.** A shift clocks out as soon as the work runs dry, and with `BUREAU_POKES` set (see pokes in `docs/protocol.md`), new work summons a worker within seconds. One builder every few hours is a fine start; add the lead and the critic when you start filing goals.
7. **Queue missions from the dashboard** (`/missions/new`, or `/goals/new` for a goal). The next shift picks them up.

Outbound credentials stay in the routine's environment as before: `BUREAU_GIT_TOKEN` to clone and push code, `BUREAU_DOCS_TOKEN` for the lead's read-only docs clone. They are GitHub's, not the hub's.

## What a shift produces

Progress notes on the mission log, heartbeats with activity verbs (the office animates these), a debrief appended to the project's STATE.md in the brain, and either `done` or a mission parked in `review` at the boss's door. The boss rules from the dashboard. The standing prompts tell a worker to park anything irreversible in review. That's a prompt, not a wall: the hub gates the mission's status and can't stop a worker holding deploy credentials.
