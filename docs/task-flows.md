# Task flows: adding & reviewing

## Adding tasks: four doors, one queue

1. **Dashboard quick-add**: title, project (a dropdown of registered projects, `general` by default), priority. Works from a phone. Projects live in the Projects pane: create with any human name (a path-safe id is derived: "Trace Bingo" becomes `trace-bingo`), relabel freely, filter the board per project, delete when no missions are open. Deleting touches neither closed history nor the brain, and closed missions never resurrect a deleted project. The deep id-rename API also exists and moves the brain folder with its git history.
2. **Any agent session**: "add these three tasks to the hub" → the session POSTs via curl or its connector.
3. **Raw curl** from anywhere: `curl -X POST $BUREAU_URL/api/tasks -H "Authorization: Bearer $BUREAU_TOKEN" -d '{"title":"…","priority":1}'`
4. **Later, a chat command channel** (e.g. Discord): commands accepted from the boss's user ID only.

Agents can also file tasks for each other (delegation shows up in the feed/office).

## Reviewing: the `review` column is the boss's inbox

Flow: agent finishes gated work → task parks in `review` → notification ping ("review needed: t-42") + office sprite waits at the boss's door → the boss judges from the task record, which carries the **full work log** and **artifacts** (PR links, files, brain entries).

**Dashboard detail panel:** click a card → log + artifacts + two actions:
- **Approve** → status `done` (office: card to shipping wall)
- **Send back** → status `queued` with the boss's note attached; the agent reads the note as its correction on next claim (office: card back to whiteboard + red note)

**Review from anywhere:** when `BUREAU_PUBLIC_URL` is set, the review ping carries two links, approve and send back. Each opens a small confirmation page served by the hub: approve is one tap; send back asks for the note, which stays required. Links are mission-scoped, single-use, and expire after 7 days.

**Read from anywhere:** review, done, and failed pings also carry a View link: a read-only page of the full mission record (brief, artifacts, complete log), so the answer is one tap away before any brain browser exists. View links are per-mission, unguessable, and never grant actions.

**Chat fallback:** tell any connected agent session "approve t-42" / "send t-42 back, the tone is wrong" and it PATCHes the hub.

## Statuses

`queued → claimed → in_progress → review → done | failed`, plus auto-requeue on lease expiry and `blocked` for waiting-on-external or waiting-on-boss.
