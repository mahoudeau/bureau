# chat connector

Turning conversations into Bureau workers. Not a connector in the code sense, and that is the point: the hub itself speaks MCP, so a chat app needs no glue at all. Setup is a URL and a paragraph. Licensed Apache-2.0 (`../../LICENSE-APACHE`).

## Setup

1. **Get the connector URL** from your hub: `GET /api/mcp` with your Bearer token returns it. The URL is a capability: whoever has it can work your Bureau, so treat it like a password (keep it in a file, rotate by rotating the hub's stored token).
2. **Add it in the chat app**: in claude.ai it is Settings, then Connectors, then add custom connector; name it Bureau, paste the URL. No OAuth, no other fields. If the app validates the connector on save, that validation is itself a protocol round-trip: a clean save means the door works.
3. **Tool permissions**: allow the four read tools always (whoami, list_projects, list_missions, read_knowledge); put the four write tools (create_mission, start_mission, update_mission, write_knowledge) wherever your trust sits: needs-approval gives you a click per action while you watch the flow, always-allow makes it fully fluid.
4. **Make it proactive**: the server teaches connected sessions the shift discipline through its own MCP instructions, but instructions answer *how*, not *whether*. To make every conversation reach for the Bureau on its own, add this to the app's global preferences (adapt the envoy name; the Bureau's is consul):

> When the Bureau connector is available and the conversation involves substantive work (research, writing, building, planning, analysis), use it on your own initiative, without being asked. Workflow: check list_missions first for queued missions reserved for the envoy and continue those before anything else; pick the project with list_projects (ask only if genuinely ambiguous, never invent ids); before working, read the scope chain with read_knowledge (global knowledge/ and recipes/, then the project's entity if it has one: entities/<slug>/PROFILE.md and its knowledge/ and recipes/, then projects/<project>/STATE.md; nearest scope wins, and never read another entity's tree); open a mission with create_mission before doing the work; start_mission to claim it; post progress with update_mission at meaningful steps; before finishing, file a debrief with write_knowledge to projects/<project>/STATE.md, three labeled parts: what changed, what was learned, next step; then close the mission done, or review for sign-off. Deliverables worth keeping go to projects/<project>/deliverables/ in the brain, not just the chat. File learnings at the scope where they are true; when unsure, file lower and let the librarian promote. Quick questions and casual conversation need no mission, but after any small task that taught a preference, correction, term, or fact, file a one-line journal entry with write_knowledge to journal/<yyyy-mm-dd>.md (mode append, format "- HH:MM [chat] did X for <project>; learned: Y"); skip it when nothing was learned.

## What a connected conversation can do

Open and work missions, post progress the boss reads on the dashboard and Discord, park work for review, read and write the brain, and file journal lines, the same rules as every other worker, enforced by the same hub. Scheduled runs in the same app (where the platform offers them) inherit the connector and the preferences, so recurring chats behave identically.

## Honest limits

Preferences make bureau-first behavior the strong default, not a guarantee: chat models exercise judgment, and an occasional conversation may need a nudge. And a conversation cannot be woken from outside: answered questions and reserved missions are picked up when a session next starts, which is why the scheduled workers exist.
