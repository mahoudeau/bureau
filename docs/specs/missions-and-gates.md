---
title: Missions and gates
compartment: spec
summary: How a mission is filed, claimed, leased, reserved and closed, and who may move it in and out of review.
scope: project:bureau
---

# Missions and gates

What the hub does with a mission from filing to close. Format: `docs/brain-format.md`, "Specs". Sources point at the code as of this writing; when they disagree with this file, the code is the fact.

## Actors

- **The boss**: the human. Acts as `agent: "human"`, from the dashboard or a capability link.
- **Pool workers**: agents registered with `kind: "cowork"`, interchangeable shift workers.
- **The envoy**: any non-cowork agent (by default consul), whose context lives outside a shift.
- **The lead**: any agent whose `capabilities` include `"lead"`.
- **The critic**: any agent whose `capabilities` include `"critic"`.
- **The librarian**: any agent whose `capabilities` include `"librarian"`.
- **The hub**: stores state, expires leases, enforces the gates.

## Rules

### Filing

- RULE-MISSIONS-01: A new mission starts `queued`, unassigned, with priority 3 unless given (1 is highest), project `general` unless given, and gate `boss` unless `critic` is asked for. (source: hub/lib/store.js:262-286)
- RULE-MISSIONS-02: A mission's project must already exist in the registry. An unknown id is refused with the list of existing ids, on both the HTTP API and MCP. (source: hub/server.js:327-329, hub/server.js:503)
- RULE-MISSIONS-03: The statuses are `queued`, `claimed`, `in_progress`, `blocked`, `review`, `done`, `failed`, `discarded`. Any other status is refused. (source: hub/lib/store.js:195, hub/lib/store.js:451)
- RULE-MISSIONS-04: Every mission gets a read-only view token at creation, for the mission record page. (source: hub/lib/store.js:280-281)

### Claiming

- RULE-MISSIONS-05: Claim by id succeeds only on a `queued` mission, whatever its project's load or reservation. (source: hub/lib/store.js:328-331, hub/lib/store.js:360-361)
- RULE-MISSIONS-06: Claim without id serves the claimable queued mission with the lowest priority number, oldest first on ties, from a project with a free slot. (source: hub/lib/store.js:353-358)
- RULE-MISSIONS-07: A project's slots are its `capacity` (default 1). A slot is taken by a `claimed` or `in_progress` mission whose title does not start with `goal:`. Blocked, review and closed missions take none. (source: hub/lib/store.js:24, hub/lib/store.js:338-341)
- RULE-MISSIONS-08: Claim without id answers `queue_empty` when nothing claimable is queued, and `all_busy` when missions are queued but every project is full. (source: hub/lib/store.js:356-358)
- RULE-MISSIONS-09: A claim sets status `claimed`, the assignee, and a lease of `lease_minutes` (default 120). The claiming name joins the roster if it was not on it. (source: hub/lib/store.js:362-366, hub/server.js:390)

### Leases and reservations

- RULE-MISSIONS-10: An expired lease on a `claimed` or `in_progress` mission sends it back to `queued`, reserved for the agent that held it. Expiry is checked on every claim, on task and state reads, and on a sweep every 60 seconds by default. (source: hub/lib/store.js:303-322, hub/server.js:582-585)
- RULE-MISSIONS-11: A move from `blocked` or `review` back to `queued` reserves the mission for its previous assignee. (source: hub/lib/store.js:466-469)
- RULE-MISSIONS-12: A reserved mission is claimable without id by its holder only, except when the holder is a `cowork` agent and the reservation is older than `BUREAU_RESERVATION_TTL_MIN` minutes (default 30). A non-cowork holder's reservation never lapses. (source: hub/lib/store.js:346-352)
- RULE-MISSIONS-13: Any successful claim clears the reservation. (source: hub/lib/store.js:360-361)
- RULE-MISSIONS-14: `done`, `failed`, `discarded`, `review` and `blocked` clear the lease. `blocked` keeps the assignee; `queued` clears both. (source: hub/lib/store.js:453-455)
- RULE-MISSIONS-15: Only a PATCH with `lease_minutes` renews a lease. A heartbeat does not. (source: hub/lib/store.js:471, hub/lib/store.js:157-174)

### Gates and roles

- RULE-MISSIONS-16: Roles are read from capability tags, never from names. `agent: "human"` passes every role check, and the lead passes the critic's. (source: hub/lib/store.js:381-386, docs/protocol.md "Authorization is role-based")
- RULE-MISSIONS-17: Anyone may raise a mission's gate to `boss`. Only the boss or the lead may set `critic`. (source: hub/lib/store.js:405-409)
- RULE-MISSIONS-18: A `boss`-gate mission enters `review` only by the critic, the lead or the boss. Anyone else is refused. Missions with no gate field count as `boss`. (source: hub/lib/store.js:418-419)
- RULE-MISSIONS-19: The librarian may park its own digest into review: the agent carries the `librarian` tag and the mission title starts with the agent's name and a colon. Both are required. (source: hub/lib/store.js:393-397, hub/lib/store.js:418)
- RULE-MISSIONS-20: A `boss`-gate mission in `review` moves to `done` or `queued` only by `agent: "human"`. (source: hub/lib/store.js:423-424)
- RULE-MISSIONS-21: The hub places no limit on who moves a `critic`-gate mission out of review. That the critic judges and the builder does not is convention, held by the standing prompts. (source: hub/lib/store.js:423, connectors/cowork/MONETA-SHIFT.md "Hard rules")
- RULE-MISSIONS-22: Registering replaces an agent's capabilities. An empty array is ignored, and every change is logged as `agent.capabilities_changed` with before and after. (source: hub/lib/store.js:103-110)

## Journeys

1. **A pool worker's mission.** The worker claims without id and gets the top mission from a free project (RULE-MISSIONS-06, RULE-MISSIONS-07) with a 120-minute lease (RULE-MISSIONS-09). It sets `in_progress`, posts notes, renews the lease on long work (RULE-MISSIONS-15), and closes `done`, or hands boss-gate work to the critic (RULE-MISSIONS-18).
2. **The envoy asks the boss.** Consul sets its mission `blocked` with a question; the lease clears and consul stays assignee (RULE-MISSIONS-14). The boss answers, the mission returns to `queued` reserved for consul (RULE-MISSIONS-11), and no pool worker can take it, however long it waits (RULE-MISSIONS-12).
3. **A goal.** The boss files `goal: ...`; the lead claims it by id and holds it open while children run. The goal takes no project slot, so its children can still be claimed (RULE-MISSIONS-07).

## Edge cases

- A shift dies mid-mission: the lease expires and the mission returns reserved for the dead shift. Being `cowork`, its reservation lapses after 30 minutes and the pool takes it (RULE-MISSIONS-10, RULE-MISSIONS-12).
- The envoy's lease expires: the mission waits for consul with no time limit (RULE-MISSIONS-12).
- An explicit claim by id takes a mission reserved for someone else and clears the reservation (RULE-MISSIONS-05, RULE-MISSIONS-13).
- A builder sets `review` on a boss-gate mission: refused, and the refusal tells it to hand the round to the critic (RULE-MISSIONS-18).
- A session re-registers with a short capabilities list and drops a role tag: the drop takes effect and the log shows when (RULE-MISSIONS-22).
