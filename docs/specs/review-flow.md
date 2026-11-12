---
title: Review flow
compartment: spec
summary: How work reaches the boss, who rules on it from the dashboard, itemized verdicts, answers to blocked missions and chat approvals.
scope: project:bureau
---

# Review flow

What happens once work waits on a judgment or an answer. Who may park and clear which missions is in `missions-and-gates.md`; this file covers the door itself. Sources point at the code as of 2026-11-12 (branch omako-sign-in, doc 30); when they disagree with this file, the code is the fact.

## Actors

- **The worker**: the agent that parks a mission in `review` or `blocked`.
- **The boss**: rules from the dashboard, signed in, on any device, or from a chat session. Always as `agent: "human"`, except a chat approval, which the agent records for him.
- **An approver**: a person the boss added with the role `approver` (`docs/protocol.md`, "Sign-in"). Rules from the dashboard as `human`, like the boss, and nothing else.
- **The critic**: rules on `critic`-gate reviews from the API.
- **The hub**: records verdicts and statuses, and shows what waits on the Desk. It sends no outside notification.

## Rules

### Where the boss rules

- RULE-REVIEW-01 to 05, 09, 13 to 17, 19: removed with doc 30 (D12). The review, send-back and answer links (`/r/`), their image route (`/r/<token>/img`), the view links (`/m/`), Discord pings and the `notify` setting are gone. Schema migration 1 to 2 drops `review_links`, `answer_link` and `view_token` from missions and `notify` from settings. (source: hub/lib/store.js MIGRATIONS)
- RULE-REVIEW-22: The Desk shows what waits on the boss: boss-gate missions in `review` and missions `blocked` on him. He rules from the mission's page in the dashboard. (source: hub/public/app/pages/desk.js, hub/public/app/pages/mission.js)
- RULE-REVIEW-23: An owner and an approver rule the same way: `PATCH /api/tasks/:id` with the dashboard's session cookie, as `agent: "human"`. The log entry carries `via`, the person's email, so "human" is never anonymous. An approver may write nothing else; a viewer may write nothing. (source: hub/server.js sessionPrincipal(), hub/lib/auth.js checkRule(), hub/lib/store.js updateTask())
- RULE-REVIEW-06: Approve moves the mission to `done`, or to `approved` when it was parked with `after_approval: "return"` (RULE-MISSIONS-34). Send back and answer move it to `queued`; the dashboard asks for a note, the correction or the answer. (source: hub/lib/store.js updateTask(), hub/public/app/pages/mission.js sendBack())
- RULE-REVIEW-07: A ruling's log entry carries `kind` `approve`, `send_back` or `answer`. (source: hub/lib/store.js humanKind())
- RULE-REVIEW-08: A send back or an answer returns the mission reserved for its previous assignee. (source: hub/lib/store.js updateTask())

### Itemized review

- RULE-REVIEW-10: A PATCH with `items` appends proposals with server ids `i1`, `i2`, ..., verdict `proposed`. Titles are cut at 200 characters, bodies at 20000; an item with no title is skipped. (source: hub/lib/store.js updateTask())
- RULE-REVIEW-11: A PATCH with `verdicts` sets `approved` or `rejected` per item id and saves a comment of up to 2000 characters. Only the boss files them, which includes an approver, who acts as `human` (RULE-MISSIONS-37). The verdicts land in the mission log as one line, with `kind: "verdict"`. (source: hub/lib/store.js updateTask())
- RULE-REVIEW-12: The mission page offers Accept, Reject or Later per item. Later stores the verdict `later`: a ruling, deferred on purpose. An item nobody ruled on stays `proposed` and starts with no choice selected, so a partial review never approves or defers the rest by default. (source: hub/public/app/pages/mission.js)
- RULE-REVIEW-20: Approving, from the dashboard or MCP, is refused while any item would stay `proposed` (RULE-MISSIONS-33). The answer names the undecided ids. (source: hub/lib/store.js updateTask())
- RULE-REVIEW-21: The dashboard shows each item's payload as it will be written (op, file, content) with its short hash, and says when approving returns the mission to its agent. (source: hub/public/app/pages/mission.js)

### Chat approvals

- RULE-REVIEW-18: Under approval policy `in-session`, the boss may approve in the chat: the agent closes the mission `done` with his exact words in `approved_in_session`, even out of a boss-gate review. The hub logs the quote on the mission and as a `task.approved_in_session` event. Under any other policy the quote is refused and the boss rules from the dashboard (RULE-MISSIONS-20, RULE-MISSIONS-25). (source: hub/lib/store.js updateTask())

## Journeys

1. **Approve from the phone.** A critic-cleared mission parks in boss-gate review. The boss opens the dashboard on his phone, signed in with OMAKO, and sees it on the Desk (RULE-REVIEW-22). He reads it and approves: the mission is `done` (RULE-REVIEW-06).
2. **Send back with a correction.** The boss sends back from the mission page, with what should change. The mission is `queued` again, reserved for its builder (RULE-REVIEW-06, RULE-REVIEW-08), who reads the note on its next claim.
3. **The librarian's digest.** The librarian files one item per proposed change, each carrying its exact text as a payload (RULE-REVIEW-10, RULE-MISSIONS-31), and parks the mission with `after_approval: "return"`. The boss accepts some and rejects some with comments; every item needs a verdict before he can approve (RULE-REVIEW-20). The approval returns the digest to the librarian as `approved`, and the next night applies what was approved through the apply route (RULE-MISSIONS-35).
4. **A blocked question.** A worker blocks on a question. It shows on the Desk; the boss answers from the mission page. The answer goes to the log and the mission returns to the worker (RULE-REVIEW-06, RULE-REVIEW-08).
5. **A yes in the chat.** On an `in-session` project, the boss says "ship it" to consul. Consul closes the mission `done` with that quote, and the log shows who recorded it (RULE-REVIEW-18).
6. **An approver rules.** The boss added a colleague as `approver`. She signs in, approves a review: the log reads `by: human`, `via: <her email>` (RULE-REVIEW-23). She cannot change settings or mint tokens.

## Edge cases

- Send back with an empty note: the dashboard asks for the note first and sends nothing (RULE-REVIEW-06). The hub itself does not require one.
- A mission re-enters review after a send back: it shows on the Desk again; nothing old is left to act on.
- The boss approves: the mission is `done` and its work images are deleted with it (RULE-KNOWLEDGE-27). Parked with `after_approval: "return"`, it is `approved` instead and its work folder stays (RULE-MISSIONS-34).
- A viewer opens a review: she sees it and cannot rule (RULE-REVIEW-23).
- An old `/r/` or `/m/` link from before the upgrade: 404.
