---
title: Missions and gates
compartment: spec
summary: How a mission is filed, claimed, leased, reserved and closed, who may move it in and out of review, and what the approval policy adds.
scope: project:bureau
---

# Missions and gates

What the hub does with a mission from filing to close. Format: `docs/brain-format.md`, "Specs". Sources point at the code as of 2026-10-01 (main after #99); when they disagree with this file, the code is the fact.

## Actors

- **The boss**: the human. Acts as `agent: "human"`, from the dashboard or a capability link.
- **Pool workers**: agents registered with `kind: "cowork"`, interchangeable shift workers.
- **The envoy**: any non-cowork agent (by default consul), whose context lives outside a shift.
- **The lead**: the agent holding the `lead` role: from settings once any agent has roles there, from its `capabilities` otherwise.
- **The critic**: the agent holding the `critic` role, read the same way.
- **The librarian**: the agent holding the `librarian` role, read the same way as the lead.
- **A curator**: an agent holding the `curator` role, read the same way. It may write the curated brain compartments (`knowledge-api.md`) and has no other power.
- **The hub**: stores state, expires leases, enforces the gates and the approval policy.

## Rules

### Filing

- RULE-MISSIONS-01: A new mission starts `queued`, unassigned, with priority 3 unless given (1 is highest) and project `general` unless given. Its gate is the one asked for, else the project's `default_gate` setting, else the global one, else `boss`. Any value but `critic` becomes `boss`. (source: hub/lib/store.js:386-412, hub/lib/store.js:543-551)
- RULE-MISSIONS-02: A mission's project must already exist in the registry. An unknown id is refused with the list of existing ids, on both the HTTP API and MCP. (source: hub/server.js:343-345, hub/server.js:529-530)
- RULE-MISSIONS-03: The statuses are `queued`, `claimed`, `in_progress`, `blocked`, `review`, `approved`, `done`, `failed`, `discarded`. Any other status is refused. `done`, `failed` and `discarded` are terminal; `approved` is not. (source: hub/lib/store.js TASK_STATUSES, TERMINAL_STATUSES)
- RULE-MISSIONS-04: Every mission gets a read-only view token at creation, for the mission record page. (source: hub/lib/store.js:406-407)

### Claiming

- RULE-MISSIONS-05: Claim by id succeeds only on a `queued` mission, whatever its project's load or reservation. (source: hub/lib/store.js:454-457, hub/lib/store.js:486-487)
- RULE-MISSIONS-06: Claim without id serves the claimable queued mission with the lowest priority number, oldest first on ties, from a project with a free slot. (source: hub/lib/store.js:479-484)
- RULE-MISSIONS-07: A project's slots are its `capacity` (default 1). A slot is taken by a `claimed` or `in_progress` mission whose title does not start with `goal:`. Blocked, review, approved and closed missions take none. (source: hub/lib/store.js:81, hub/lib/store.js:464-467)
- RULE-MISSIONS-08: Claim without id answers `queue_empty` when nothing claimable is queued, and `all_busy` when missions are queued but every project is full. (source: hub/lib/store.js:482-484)
- RULE-MISSIONS-09: A claim sets status `claimed`, the assignee, and a lease of `lease_minutes` (default 120). The claiming name joins the roster if it was not on it. (source: hub/lib/store.js:488-493, hub/server.js:417)

### Leases and reservations

- RULE-MISSIONS-10: An expired lease on a `claimed` or `in_progress` mission sends it back to `queued`, reserved for the agent that held it. Expiry is checked on every claim, on task and state reads, and on a sweep every 60 seconds by default. (source: hub/lib/store.js:429-448, hub/server.js:286, hub/server.js:328, hub/server.js:609-612)
- RULE-MISSIONS-11: A move from `blocked` or `review` back to `queued` reserves the mission for its previous assignee. (source: hub/lib/store.js:758-761)
- RULE-MISSIONS-12: A reserved mission is claimable without id by its holder only, except when the holder is a `cowork` agent and the reservation is older than `BUREAU_RESERVATION_TTL_MIN` minutes (default 30). A non-cowork holder's reservation never lapses. (source: hub/lib/store.js:472-478)
- RULE-MISSIONS-13: Any successful claim clears the reservation. (source: hub/lib/store.js:486-487)
- RULE-MISSIONS-14: `done`, `failed`, `discarded`, `review`, `blocked` and `approved` clear the lease. `blocked` and `approved` keep the assignee; `queued` clears both. (source: hub/lib/store.js updateTask() status block)
- RULE-MISSIONS-15: Only a PATCH with `lease_minutes` renews a lease. A heartbeat does not. (source: hub/lib/store.js:763, hub/lib/store.js:281-298)

### Gates and roles

- RULE-MISSIONS-16: Roles are never read from names. The roles are `lead`, `critic`, `librarian` and `curator`. Once any agent has `roles` in settings, every role comes from `settings.agents` only, for every agent: an agent missing there holds none, whatever it registered with. With no roles in settings, they come from capability tags. `agent: "human"` passes every role check, and the lead passes the critic's. (source: hub/lib/store.js agentHasCapability(), rolesConfigured(), agentHasRole(), isLead(), isCriticOrLead(), canCurate(), ROLES)
- RULE-MISSIONS-17: Anyone may raise a mission's gate to `boss`. Only the boss or the lead (per RULE-MISSIONS-16) may set `critic`. (source: hub/lib/store.js:684-686)
- RULE-MISSIONS-18: A `boss`-gate mission enters `review` only by the critic, the lead or the boss. Anyone else is refused. Missions with no gate field count as `boss`, and an update that also changes the gate is judged against the gate it asks for. (source: hub/lib/store.js:688, hub/lib/store.js:697-698)
- RULE-MISSIONS-19: The librarian may park its own digest into review: the agent holds the `librarian` role (RULE-MISSIONS-16) and the mission title starts with the agent's name and a colon. Both are required. (source: hub/lib/store.js isOwnLibrarianDigest(), updateTask() review entry)
- RULE-MISSIONS-20: A `boss`-gate mission in `review` moves to `done` or `queued` only by `agent: "human"`. One exception: under approval policy `in-session`, an agent may close it `done` with `approved_in_session` (RULE-MISSIONS-25). (source: hub/lib/store.js:699-705)
- RULE-MISSIONS-21: The hub places no limit on who moves a `critic`-gate mission out of review, and the approval policy does not apply to it. That the critic judges and the builder does not is convention, held by the standing prompts. (source: hub/lib/store.js:704, hub/lib/store.js:709, connectors/cowork/MONETA-SHIFT.md "Hard rules")
- RULE-MISSIONS-22: Registering replaces an agent's capabilities. An empty array is ignored, and every change is logged as `agent.capabilities_changed` with before and after. Once roles are in settings, role tags (`lead`, `critic`, `librarian`, `curator`) are still stored but grant nothing; the log entry and the register response say so in a `note`. (source: hub/lib/store.js upsertAgent(), ignoredRoleTags(), hub/server.js POST /api/agents/register route)
- RULE-MISSIONS-29: `librarian` and `curator` both write the curated brain compartments (RULE-KNOWLEDGE-20). Only `librarian` adds the digest carve-out (RULE-MISSIONS-19); `curator` grants nothing on missions. (source: hub/lib/store.js canCurate(), isOwnLibrarianDigest())

### Updates, approval and the log

- RULE-MISSIONS-23: An update runs every check before it changes anything. A refused update leaves the mission exactly as it was, gate included. (source: hub/lib/store.js:671-716)
- RULE-MISSIONS-24: The approval policy is the `approval` setting, the project's overriding the global one: `dashboard`, `in-session` or `critic`. It bites only when an agent other than the boss closes a `boss`-gate mission `done`, from any status. `dashboard` refuses it; `in-session` needs `approved_in_session`; `critic` needs the critic or the lead. Unset, nothing is added to RULE-MISSIONS-20, so an agent may close a boss-gate mission `done` from any status but `review`. (source: hub/lib/store.js:532, hub/lib/store.js:543-551, hub/lib/store.js:706-716)
- RULE-MISSIONS-25: `approved_in_session` carries the boss's words from the chat. It must be non-empty, the project's policy must be `in-session`, and the status must be `done`; anything else is refused. When accepted, the mission gets a second log entry `approved by boss in session: "<quote>" (recorded by <agent>)` and the hub logs a `task.approved_in_session` event with the quote. (source: hub/lib/store.js:677-683, hub/lib/store.js:703, hub/lib/store.js:774-777)
- RULE-MISSIONS-26: Settings are read with `GET /api/settings` and changed with `PATCH /api/settings`, in three sections: `global`, `projects` (by existing project id) and `agents` (by name, `roles` only). The patch merges key by key, `null` clears a key or an entry, unknown keys and values are refused, and nothing is applied unless everything validates. Every change logs `settings.changed`; a role change also logs `agent.roles_changed`. (source: hub/lib/store.js:553-632, hub/server.js:352-360)
- RULE-MISSIONS-27: Every update is credited to an agent. With no `agent` given, the hub credits the mission's assignee; with no assignee either, it answers 400 `agent required`. (source: hub/lib/store.js:662-669, hub/server.js:429)
- RULE-MISSIONS-28: A log entry is `{ts, by, note}`. A status change adds `from` and `to`, also on claims and lease expiry. With no note, it reads `status → <status>` or `updated`. Entries by `human` carry `kind`: `approve`, `send_back`, `answer`, `verdict` or `edit`, as given or inferred from the move. (source: hub/lib/store.js:645-656, hub/lib/store.js:768-773, hub/lib/store.js:438, hub/lib/store.js:493, hub/lib/store.js:741)
- RULE-MISSIONS-30: An update that leaves a mission `done`, `failed` or `discarded` deletes its work store folder (RULE-KNOWLEDGE-27), whoever made it and through whichever door. (source: hub/lib/store.js updateTask(), TERMINAL_STATUSES)

### Approval pins the text

- RULE-MISSIONS-31: A review item may carry `payload: {ops: [{op, file, content}]}`, `op` being `write` or `append`, `file` a text path the knowledge API would accept. When the item is filed, the hub stores each op as exactly `{op, file, content}` and `payload_sha256`, the SHA-256 of `JSON.stringify(ops)`. A bad payload is refused and nothing is filed; the whole payload is capped at 5MB. (source: hub/lib/store.js payloadError(), canonicalOps(), payloadHash())
- RULE-MISSIONS-32: A filed payload never changes. An items entry naming an existing item id with a payload is refused, and an applied item's verdict cannot change. (source: hub/lib/store.js updateTask() item checks)
- RULE-MISSIONS-33: An approval is a move from `review` to `done`, or a close carrying `approved_in_session`. It is refused, with the undecided item ids, while any item would still read `proposed` once the request's own verdicts are counted. Missions without items are unaffected. (source: hub/lib/store.js updateTask() approving)
- RULE-MISSIONS-34: The update that parks a mission in `review` may carry `after_approval: "return"`; each park sets or clears it. An approval of such a mission lands on `approved` instead of `done`, with the boss's log entry `from: review, to: approved, kind: approve`. (source: hub/lib/store.js updateTask(), humanKind())
- RULE-MISSIONS-35: `POST /api/tasks/:id/apply` with `{agent, item}` writes an item's payload, op by op, through the knowledge API's write, authored by `agent`, without the curated-compartment check. It needs the mission `approved`, the item `approved`, a payload not yet applied, `agent` the assignee or `human`, and the recomputed hash equal to `payload_sha256` (else 409, nothing written). The item then records `applied_at`, `applied_by`, `commit` and `payload_sha256`. (source: hub/lib/store.js applyCheck(), applyItem(), hub/server.js applyApproved())
- RULE-MISSIONS-36: An `approved` mission leaves only for `done`, by its assignee or the boss, once every approved item with a payload is applied, or for `failed` or `discarded` by the boss. It takes no new items. (source: hub/lib/store.js updateTask() approved exits)

## Journeys

1. **A pool worker's mission.** The worker claims without id and gets the top mission from a free project (RULE-MISSIONS-06, RULE-MISSIONS-07) with a 120-minute lease (RULE-MISSIONS-09). It sets `in_progress`, posts notes, renews the lease on long work (RULE-MISSIONS-15), and closes `done`, or hands boss-gate work to the critic (RULE-MISSIONS-18).
2. **The envoy asks the boss.** Consul sets its mission `blocked` with a question; the lease clears and consul stays assignee (RULE-MISSIONS-14). The boss answers, the mission returns to `queued` reserved for consul (RULE-MISSIONS-11), and no pool worker can take it, however long it waits (RULE-MISSIONS-12).
3. **A goal.** The boss files `goal: ...`; the lead claims it by id and holds it open while children run. The goal takes no project slot, so its children can still be claimed (RULE-MISSIONS-07).
4. **Pair mode.** The project's policy is `in-session`. The boss says yes in the chat; consul closes the mission `done` from `in_progress` with his words in `approved_in_session`, and the log keeps the quote (RULE-MISSIONS-24, RULE-MISSIONS-25).
5. **The librarian's digest.** The librarian files items carrying the exact text as payloads (RULE-MISSIONS-31) and parks the digest with `after_approval: "return"` (RULE-MISSIONS-34). The boss rules every item and approves; the digest lands on `approved`, its work folder intact. Next shift the librarian applies each approved item (RULE-MISSIONS-35) and closes it `done` (RULE-MISSIONS-36).

## Edge cases

- A shift dies mid-mission: the lease expires and the mission returns reserved for the dead shift. Being `cowork`, its reservation lapses after 30 minutes and the pool takes it (RULE-MISSIONS-10, RULE-MISSIONS-12).
- The envoy's lease expires: the mission waits for consul with no time limit (RULE-MISSIONS-12).
- An explicit claim by id takes a mission reserved for someone else and clears the reservation (RULE-MISSIONS-05, RULE-MISSIONS-13).
- A builder sets `review` on a boss-gate mission: refused, and the refusal tells it to hand the round to the critic (RULE-MISSIONS-18). If the same PATCH asked for `gate: boss`, the gate stays as it was (RULE-MISSIONS-23).
- A session re-registers with a short capabilities list and drops a role tag: the drop takes effect and the log shows when (RULE-MISSIONS-22). Once roles live in settings, the drop changes no authority (RULE-MISSIONS-16).
- `approved_in_session` on a project whose policy is `dashboard` or unset: refused, nothing changes (RULE-MISSIONS-25, RULE-MISSIONS-23).
- A PATCH with no `agent` on a queued mission: 400, nothing logged as `unknown` (RULE-MISSIONS-27).
- The boss sets roles for consul, ummon and moneta but forgets the librarian: its `librarian` tag stops counting, so it can neither park its digest nor write `knowledge/` until settings give it the role (RULE-MISSIONS-16, RULE-MISSIONS-19, RULE-MISSIONS-29).
- A curator titles a mission with its own name and parks it: refused like any plain agent (RULE-MISSIONS-29, RULE-MISSIONS-18).
