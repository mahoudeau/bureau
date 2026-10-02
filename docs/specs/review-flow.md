---
title: Review flow
compartment: spec
summary: How work reaches the boss, the capability links he rules with, itemized verdicts, answers to blocked missions, chat approvals, and what pings.
scope: project:bureau
---

# Review flow

What happens once work waits on a judgment or an answer. Who may park and clear which missions is in `missions-and-gates.md`; this file covers the door itself. Sources point at the code as of 2026-10-01 (main after #99); when they disagree with this file, the code is the fact.

## Actors

- **The worker**: the agent that parks a mission in `review` or `blocked`.
- **The boss**: rules from the dashboard, a capability link, or a chat session, always as `agent: "human"`, except a chat approval, which the agent records for him.
- **The critic**: rules on `critic`-gate reviews from the API.
- **The hub**: mints and burns links, records verdicts, mirrors events to Discord when configured and allowed.

## Rules

### Capability links

- RULE-REVIEW-01: Entering `review` mints two links, approve and send back, each a random 128-bit token valid 7 days. (source: hub/lib/store.js:749, hub/lib/store.js:784-790)
- RULE-REVIEW-02: Entering `blocked` mints one answer link, valid 7 days. (source: hub/lib/store.js:752)
- RULE-REVIEW-03: Any move out of `review` deletes its links, and any move out of `blocked` deletes its answer link. A link works once by construction. (source: hub/lib/store.js:748-753)
- RULE-REVIEW-04: Opening a link (GET) renders a page and changes nothing, so a chat preview cannot act on it. Acting is a POST from that page. (source: hub/server.js:203-217)
- RULE-REVIEW-05: A link whose mission has left the expected status (`review` for approve and send back, `blocked` for answer), or whose date has passed, gets a 410 page. (source: hub/server.js:208-213)
- RULE-REVIEW-06: Approve moves the mission to `done`, or to `approved` when it was parked with `after_approval: "return"` (RULE-MISSIONS-34). Send back and answer move it to `queued`, and need a note: the correction or the answer. (source: hub/lib/store.js:797-800, hub/server.js:224-226)
- RULE-REVIEW-07: A link acts as `agent: "human"`, so it clears boss-gate missions. Its log entry carries `kind` `approve`, `send_back` or `answer`. (source: hub/server.js:232-233, hub/lib/store.js:772)
- RULE-REVIEW-08: A send back or an answer returns the mission reserved for its previous assignee. (source: hub/lib/store.js:758-761)
- RULE-REVIEW-09: The link page shows the brain images its mission's artifacts cite (png, jpg, jpeg, gif), fetched through `/r/<token>/img?file=`, never with the hub token. That route serves only the files the mission's artifacts cite, and only while the token exists and has not expired; anything else is a 404. (source: hub/server.js:60-67, hub/server.js:83-86, hub/server.js:187-201)
- RULE-REVIEW-19: The work store joins RULE-REVIEW-09: the link page also shows every image in its own mission's `work/<t-id>/` folder, cited or not, and the image route serves them. A `work/` path of any other mission is a 404, even when an artifact cites it. (source: hub/server.js evidenceAllowed(), evidenceFiles(), readEvidence(), the /r/<token>/img route)

### Itemized review

- RULE-REVIEW-10: A PATCH with `items` appends proposals with server ids `i1`, `i2`, ..., verdict `proposed`. Titles are cut at 200 characters, bodies at 20000; an item with no title is skipped. (source: hub/lib/store.js:721-730)
- RULE-REVIEW-11: A PATCH with `verdicts` sets `approved` or `rejected` per item id and saves a comment of up to 2000 characters. The verdicts land in the mission log as one line, with `kind: "verdict"` when the boss filed them. (source: hub/lib/store.js:731-742)
- RULE-REVIEW-12: The link page offers Accept, Reject or Later per item. Later leaves the item `proposed`, so a partial review never approves the rest. (source: hub/server.js:75-81, hub/server.js:227-231)
- RULE-REVIEW-20: Approving, from a link, the dashboards or MCP, is refused while any item would stay `proposed` (RULE-MISSIONS-33). The link page then shows the form again with the undecided ids, and the link stays live. (source: hub/lib/store.js updateTask(), hub/server.js review link POST)
- RULE-REVIEW-21: The link page and the dashboards show each item's payload as it will be written (op, file, content) with its short hash, and say when approving returns the mission to its agent. (source: hub/server.js reviewForm(), hub/public/index.html openTask(), hub/public/v2/peek-panel.js payloadRows())

### Pings and records

- RULE-REVIEW-13: With `DISCORD_WEBHOOK_URL` set and the notify policy allowing it, a `review` on a `boss`-gate mission pings Discord. A `critic`-gate review never pings. (source: hub/lib/discord.js:6, hub/lib/discord.js:21-29, hub/lib/discord.js:60-61)
- RULE-REVIEW-14: When the notify policy allows it, a `blocked` mission pings as waiting on the boss, with its note. (source: hub/lib/discord.js:30-34, hub/lib/discord.js:60-61)
- RULE-REVIEW-15: Links appear in pings only when `BUREAU_PUBLIC_URL` is set. Review, blocked, done and failed pings then also carry a View link. (source: hub/lib/discord.js:15-17, hub/lib/discord.js:26-36)
- RULE-REVIEW-16: The View link (`/m/<token>`) is a read-only page of the full mission: status, brief, artifacts, log. It never grants an action. (source: hub/server.js:254-268)
- RULE-REVIEW-17: The notify policy is the `notify` setting, the mission's project overriding the global one: `all` (the default), `review` (review pings only), `blocked` (blocked pings only), `none`. It filters every Discord ping; events with no project, such as messages and brain writes, follow the global setting. (source: hub/server.js:21-28, hub/lib/store.js:543-551, hub/lib/discord.js:50-61)

### Chat approvals

- RULE-REVIEW-18: Under approval policy `in-session`, the boss may approve in the chat: the agent closes the mission `done` with his exact words in `approved_in_session`, even out of a boss-gate review. The hub logs the quote on the mission and as a `task.approved_in_session` event. Under any other policy the quote is refused and the boss rules from the dashboard or a link (RULE-MISSIONS-20, RULE-MISSIONS-25). (source: hub/lib/store.js:677-683, hub/lib/store.js:699-705, hub/lib/store.js:774-777, hub/server.js:505)

## Journeys

1. **Approve from the phone.** A critic-cleared mission parks in boss-gate review (RULE-REVIEW-01). Discord pings with approve, send back and View (RULE-REVIEW-13, RULE-REVIEW-15). The boss opens approve, reads, taps the button: the mission is `done` and both links die (RULE-REVIEW-06, RULE-REVIEW-03).
2. **Send back with a correction.** The boss opens send back, writes what should change, submits. The mission is `queued` again, reserved for its builder (RULE-REVIEW-06, RULE-REVIEW-08), who reads the note on its next claim.
3. **The librarian's digest.** The librarian files one item per proposed change, each carrying its exact text as a payload (RULE-REVIEW-10, RULE-MISSIONS-31), and parks the mission with `after_approval: "return"`. The boss accepts some and rejects some with comments; every item needs a verdict before he can approve (RULE-REVIEW-20). The approval returns the digest to the librarian as `approved`, and the next night applies what was approved through the apply route (RULE-MISSIONS-35).
4. **A blocked question.** A worker blocks on a question. The ping carries an answer link (RULE-REVIEW-02, RULE-REVIEW-14); the answer goes to the log and the mission returns to the worker (RULE-REVIEW-06, RULE-REVIEW-08).
5. **A yes in the chat.** On an `in-session` project, the boss says "ship it" to consul. Consul closes the mission `done` with that quote; no link is used and the log shows who recorded it (RULE-REVIEW-18).

## Edge cases

- The boss approves from the dashboard, then taps the old link: 410, nothing happens (RULE-REVIEW-03, RULE-REVIEW-05).
- Send back with an empty note: the page reloads asking for the note, nothing changes (RULE-REVIEW-06).
- A mission left in review for more than 7 days: its links show 410 and the boss rules from the dashboard (RULE-REVIEW-05).
- A mission re-enters review after a send back: fresh links are minted; the old ones are gone (RULE-REVIEW-01, RULE-REVIEW-03).
- A live link asks for a brain image its mission does not cite: 404 (RULE-REVIEW-09).
- A live link asks for another mission's work image, or the mission cites one: 404, and the page leaves it out (RULE-REVIEW-19).
- The boss approves from a link: the mission is `done` and its work images are deleted with it (RULE-KNOWLEDGE-27). Parked with `after_approval: "return"`, it is `approved` instead and its work folder stays (RULE-MISSIONS-34).
- Notify set to `blocked` on a project: its reviews reach the dashboard only, no ping (RULE-REVIEW-17).
