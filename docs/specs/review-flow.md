---
title: Review flow
compartment: spec
summary: How work reaches the boss, the capability links he rules with, itemized verdicts, answers to blocked missions, and what pings.
scope: project:bureau
---

# Review flow

What happens once work waits on a judgment or an answer. Who may park and clear which missions is in `missions-and-gates.md`; this file covers the door itself. Sources point at the code as of this writing; when they disagree with this file, the code is the fact.

## Actors

- **The worker**: the agent that parks a mission in `review` or `blocked`.
- **The boss**: rules from the dashboard, a capability link, or a chat session, always as `agent: "human"`.
- **The critic**: rules on `critic`-gate reviews from the API.
- **The hub**: mints and burns links, records verdicts, mirrors events to Discord when configured.

## Rules

### Capability links

- RULE-REVIEW-01: Entering `review` mints two links, approve and send back, each a random 128-bit token valid 7 days. (source: hub/lib/store.js:457, hub/lib/store.js:483-489)
- RULE-REVIEW-02: Entering `blocked` mints one answer link, valid 7 days. (source: hub/lib/store.js:460)
- RULE-REVIEW-03: Any move out of `review` deletes its links, and any move out of `blocked` deletes its answer link. A link works once by construction. (source: hub/lib/store.js:456-461)
- RULE-REVIEW-04: Opening a link (GET) renders a page and changes nothing, so a chat preview cannot act on it. Acting is a POST from that page. (source: hub/server.js:193-206)
- RULE-REVIEW-05: A link whose mission has left the expected status (`review` for approve and send back, `blocked` for answer), or whose date has passed, gets a 410 page. (source: hub/server.js:197-202)
- RULE-REVIEW-06: Approve moves the mission to `done`. Send back and answer move it to `queued`, and need a note: the correction or the answer. (source: hub/lib/store.js:496-499, hub/server.js:213-215)
- RULE-REVIEW-07: A link acts as `agent: "human"`, so it clears boss-gate missions. (source: hub/server.js:221, docs/protocol.md "Two-tier review")
- RULE-REVIEW-08: A send back or an answer returns the mission reserved for its previous assignee. (source: hub/lib/store.js:466-469)
- RULE-REVIEW-09: The link page shows the brain images its mission's artifacts point at (png, jpg, gif), fetched through `/r/<token>/img`, never with the hub token. That route serves any binary brain attachment by file name while the token exists, without checking the date or the mission's artifacts. (source: hub/server.js:72-81, hub/server.js:182-190)

### Itemized review

- RULE-REVIEW-10: A PATCH with `items` appends proposals with server ids `i1`, `i2`, ..., verdict `proposed`. Titles are cut at 200 characters, bodies at 20000; an item with no title is skipped. (source: hub/lib/store.js:428-437)
- RULE-REVIEW-11: A PATCH with `verdicts` sets `approved` or `rejected` per item id and saves a comment of up to 2000 characters. The verdicts land in the mission log as one line. (source: hub/lib/store.js:438-449)
- RULE-REVIEW-12: The link page offers Accept, Reject or Later per item. Later leaves the item `proposed`, so a partial review never approves the rest. (source: hub/server.js:64-70, hub/server.js:217-220)

### Pings and records

- RULE-REVIEW-13: With `DISCORD_WEBHOOK_URL` set, a `review` on a `boss`-gate mission pings Discord. A `critic`-gate review never pings. (source: hub/lib/discord.js:21-29)
- RULE-REVIEW-14: A `blocked` mission pings as waiting on the boss, with its note. (source: hub/lib/discord.js:30-34)
- RULE-REVIEW-15: Links appear in pings only when `BUREAU_PUBLIC_URL` is set. Review, blocked, done and failed pings then also carry a View link. (source: hub/lib/discord.js:15-17, hub/lib/discord.js:26-36)
- RULE-REVIEW-16: The View link (`/m/<token>`) is a read-only page of the full mission: status, brief, artifacts, log. It never grants an action. (source: hub/server.js:243-256)

## Journeys

1. **Approve from the phone.** A critic-cleared mission parks in boss-gate review (RULE-REVIEW-01). Discord pings with approve, send back and View (RULE-REVIEW-13, RULE-REVIEW-15). The boss opens approve, reads, taps the button: the mission is `done` and both links die (RULE-REVIEW-06, RULE-REVIEW-03).
2. **Send back with a correction.** The boss opens send back, writes what should change, submits. The mission is `queued` again, reserved for its builder (RULE-REVIEW-06, RULE-REVIEW-08), who reads the note on its next claim.
3. **The librarian's digest.** The librarian files one item per proposed change (RULE-REVIEW-10) and parks the mission. The boss accepts some, rejects some with comments, leaves the rest for later (RULE-REVIEW-11, RULE-REVIEW-12). The next night applies what was approved.
4. **A blocked question.** A worker blocks on a question. The ping carries an answer link (RULE-REVIEW-02, RULE-REVIEW-14); the answer goes to the log and the mission returns to the worker (RULE-REVIEW-06, RULE-REVIEW-08).

## Edge cases

- The boss approves from the dashboard, then taps the old link: 410, nothing happens (RULE-REVIEW-03, RULE-REVIEW-05).
- Send back with an empty note: the page reloads asking for the note, nothing changes (RULE-REVIEW-06).
- A mission left in review for more than 7 days: its links show 410 and the boss rules from the dashboard (RULE-REVIEW-05).
- A mission re-enters review after a send back: fresh links are minted; the old ones are gone (RULE-REVIEW-01, RULE-REVIEW-03).
