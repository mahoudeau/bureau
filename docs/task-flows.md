# Task flows: adding & reviewing

## Adding tasks: four doors, one queue

1. **The dashboard**: `/missions/new` for title, project (`general` by default), body, template and images, or Cmd-K, type a title, Cmd-Enter for a quick one. Works from a phone. Projects live at `/projects`: create with any human name (a path-safe id is derived: "Trace Bingo" becomes `trace-bingo`), relabel freely, delete when no missions are open. The board at `/missions` filters by project. Deleting touches neither closed history nor the brain, and closed missions never resurrect a deleted project. Renaming a project's id (`/projects/:id`) moves its missions, tokens, settings and the brain folder with its git history.
2. **Any agent session**: "add these three tasks to the hub" → the session POSTs via curl or its connector.
3. **Raw curl** from anywhere: `curl -X POST $BUREAU_URL/api/tasks -H "Authorization: Bearer $BUREAU_TOKEN" -d '{"title":"…","priority":1}'`
4. **Any chat with the MCP connector**: a conversation on a connected chat app opens missions itself (create_mission), works them, and files debriefs, proactively when the account's preferences say so.

Planned, not built: a chat command channel (e.g. Discord), taking commands from the boss's user ID only.

Agents can also file tasks for each other (delegation shows up in the feed/office).

## Reviewing: the `review` column is the boss's inbox

Flow: agent finishes gated work → task parks in `review` → notification ping ("review needed: t-42") + office sprite waits at the boss's door → the boss judges from the task record, which carries the **full work log** and **artifacts** (PR links, files, brain entries).

**The mission page:** `/missions/:id`, reached from the Desk or the board → log + artifacts + two actions:
- **Approve** → status `done` (office: card to shipping wall), or `approved` when the mission was parked with `after_approval: "return"` (below)
- **Send back** → status `queued` with the boss's note attached; the agent reads the note as its correction on next claim (office: card back to whiteboard + red note)

**Review from anywhere:** when `BUREAU_PUBLIC_URL` is set, the review ping carries two links, approve and send back. Each opens a small confirmation page served by the hub: approve is one tap; send back asks for the note, which stays required. Links are mission-scoped, single-use, and expire after 7 days.

**Answer from anywhere:** a mission parked `blocked` with a question gets an Answer link the same way. It opens a page with the question and a field for your answer; sending it re-queues the mission for its agent with your answer as the note.

**Read from anywhere:** review, done, and failed pings also carry a View link: a read-only page of the full mission record (brief, artifacts, complete log), so the answer is one tap away. View links are per-mission, unguessable, and never grant actions.

**Chat fallback:** tell any connected agent session "approve t-42" / "send t-42 back, the tone is wrong" and it PATCHes the hub.

**Pair mode: approval in the session counts.** When the boss works live with consul and approves the result in the chat, consul closes the mission `done` itself, straight from `in_progress`, with his exact words in `approved_in_session` (this needs the project's approval policy to be `in-session`; the hub logs the quote, and any other policy refuses the close, so consul parks the mission in `review` instead). No second approval in the dashboard. Consul does not park it in `review` first: a boss-gate mission in review closes only by the boss's hand, so parking it would force the double click. `review` stays for two cases: work finished while the boss is away, and irreversible steps (deploys, merges, external sends, purchases, credentials) he has not explicitly approved in the chat.

**Items need a verdict before approval.** A mission with review items is approved only when every item is ruled: accepted, rejected, or deferred with Later. Later is a decision, and the librarian carries those items to its next digest. An item nobody ruled on starts with no choice selected, and an approve with such an item is refused, on the dashboard, the review link and MCP alike.

**Approval pins the text.** An item that proposes a brain change carries the exact text in its `payload`, hashed when it is filed. The boss reads that text on the review page and approves those bytes. When the mission was parked with `after_approval: "return"`, approving does not close it: it goes to `approved`, back with its agent, its work folder intact. The agent applies each accepted item with `POST /api/tasks/:id/apply` (the hub checks the hash and writes the text itself, no retyping), then closes the mission `done`. The dashboard marks these missions Approved, and the mission page shows each item's applied state.

## Statuses

`queued → claimed → in_progress → review → done | failed`, plus auto-requeue on lease expiry and `blocked` for waiting-on-external or waiting-on-boss. With `after_approval: "return"`: `review → approved → done`. `discarded` closes a mission that was never going to be work: a duplicate, a test, or one replaced by a better-cut mission.
