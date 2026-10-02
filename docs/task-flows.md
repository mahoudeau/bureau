# Task flows: adding & reviewing

## Adding tasks: five doors, one queue

1. **Dashboard quick-add**: title, project (a dropdown of registered projects, `general` by default), priority. Works from a phone. Projects live in the Projects pane: create with any human name (a path-safe id is derived: "Trace Bingo" becomes `trace-bingo`), relabel freely, filter the board per project, delete when no missions are open. Deleting touches neither closed history nor the brain, and closed missions never resurrect a deleted project. The deep id-rename API also exists and moves the brain folder with its git history.
2. **Any agent session**: "add these three tasks to the hub" → the session POSTs via curl or its connector.
3. **Raw curl** from anywhere: `curl -X POST $BUREAU_URL/api/tasks -H "Authorization: Bearer $BUREAU_TOKEN" -d '{"title":"…","priority":1}'`
4. **Any chat with the MCP connector**: a conversation on a connected chat app opens missions itself (create_mission), works them, and files debriefs, proactively when the account's preferences say so.
5. **Later, a chat command channel** (e.g. Discord): commands accepted from the boss's user ID only.

Agents can also file tasks for each other (delegation shows up in the feed/office).

## Reviewing: the `review` column is the boss's inbox

Flow: agent finishes gated work → task parks in `review` → notification ping ("review needed: t-42") + office sprite waits at the boss's door → the boss judges from the task record, which carries the **full work log** and **artifacts** (PR links, files, brain entries).

**Dashboard detail panel:** click a card → log + artifacts + two actions:
- **Approve** → status `done` (office: card to shipping wall), or `approved` when the mission was parked with `after_approval: "return"` (below)
- **Send back** → status `queued` with the boss's note attached; the agent reads the note as its correction on next claim (office: card back to whiteboard + red note)

**Review from anywhere:** when `BUREAU_PUBLIC_URL` is set, the review ping carries two links, approve and send back. Each opens a small confirmation page served by the hub: approve is one tap; send back asks for the note, which stays required. Links are mission-scoped, single-use, and expire after 7 days.

**Read from anywhere:** review, done, and failed pings also carry a View link: a read-only page of the full mission record (brief, artifacts, complete log), so the answer is one tap away before any brain browser exists. View links are per-mission, unguessable, and never grant actions.

**Chat fallback:** tell any connected agent session "approve t-42" / "send t-42 back, the tone is wrong" and it PATCHes the hub.

**Pair mode: approval in the session counts.** When the boss works live with consul and approves the result in the chat, consul closes the mission `done` itself, straight from `in_progress`, with his exact words in `approved_in_session` (where the project's approval policy is `in-session`, the hub logs the quote; where it isn't set, the note `approved by boss in session: "<his exact words>"` does the same job). No second approval in the dashboard. Consul does not park it in `review` first: a boss-gate mission in review closes only by the boss's hand, so parking it would force the double click. `review` stays for two cases: work finished while the boss is away, and irreversible steps (deploys, merges, external sends, purchases, credentials) he has not explicitly approved in the chat.

**Items need a verdict before approval.** A mission with review items is approved only when every item is accepted or rejected. "Later" is fine for saving verdicts, but an approve with an item still proposed is refused, on the dashboards, the review link and MCP alike.

**Approval pins the text.** An item that proposes a brain change carries the exact text in its `payload`, hashed when it is filed. The boss reads that text on the review page and approves those bytes. When the mission was parked with `after_approval: "return"`, approving does not close it: it goes to `approved`, back with its agent, its work folder intact. The agent applies each accepted item with `POST /api/tasks/:id/apply` (the hub checks the hash and writes the text itself, no retyping), then closes the mission `done`. The dashboards show these missions in their own group, "Approved, to apply", with each item's applied state.

## Statuses

`queued → claimed → in_progress → review → done | failed`, plus auto-requeue on lease expiry and `blocked` for waiting-on-external or waiting-on-boss. With `after_approval: "return"`: `review → approved → done`.
