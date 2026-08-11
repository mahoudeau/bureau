# The pixel office

A 16-bit office rendered in the browser, where each agent is a sprite and every hub
event becomes choreography. It is a **renderer of the hub's SSE stream**; the hub
does not know it exists. Served at `/office`; the flat dashboard stays at `/` as the
information-dense view. Mockup: `mockups/office.html` (procedural canvas pixel art,
no image assets; a scripted `SCRIPT` array stands in for the SSE feed).

## Why it exists

A board says what is *true*; the office shows what is *happening*, readably, to
anyone. Both views consume the same events; neither adds hub complexity.

## Event → choreography mapping (core)

| Hub event / state | Office visual |
|---|---|
| agent session starts (register) | sprite walks in through the front door |
| agent active (heartbeat < 5 min) | at desk, typing; monitor glows/flickers |
| agent idle (5–60 min) | coffee machine / water-cooler pathing |
| agent offline | desk empty, chair pushed in, corner lights dim |
| task claimed | walks to whiteboard, takes a card, carries it to desk |
| progress note | speech bubble with the actual log text |
| task → review | walks to the boss's office door, parks the card (bounces) |
| task done | card pinned to the shipping wall; counter increments |
| task failed | card crumples into the bin; wall alarm lamp spins; sweat-drop sprite |
| lease expired (session died) | **ghost card walks itself back** to the whiteboard |
| agent → agent message | walks to the other desk / meeting room; alternating bubbles if both active |
| knowledge write | walks to the Brain shelf, files a document |
| scheduled wake-up fires | server-room rack flashes, agent enters through the door |

## Rooms & furniture

**v1 map:** front door, open space with named desks + monitors, task whiteboard
(card colors = queued/doing/review/done), Brain bookshelf, meeting room, the boss's
office (door + mat + bouncing review card), coffee corner, windows (night city),
**alarm lamp + failure bin**, **server room** (one rack unit per recurring schedule),
**shipping wall** ("shipped this week: N").

**Phase 2:** waiting bench (requires the `blocked` status; bubble shows "waiting on:
X"), pigeonhole mail wall (envelopes pile up for offline agents, collected on next
session), **operator sprite** (appears when the operator views the dashboard;
approving = walks to the door and hands the card back; rejecting = card returns to
the whiteboard with a red note).

**Garnish backlog:** heartbeat monitor flicker, coffee-beans usage gauge (tokens as
coffee; the team "runs out of coffee" near the cap), night mode when no sessions for
hours, P1 failure = small wastebasket fire until re-queued.

## Design notes

- **Bursty events need theatre.** Real agents emit 5 events in a minute then nothing
  for 2 h. A per-sprite action queue with durations stretches bursts into readable
  choreography; idle loops fill the gaps.
- **Status is never color-alone**: status pixel above heads + monitor state + position
  all encode the same thing.
- **Tech:** single HTML page; hand-rolled canvas now (a game library later only if
  pathfinding/tilemaps get painful; the zero-dep rule is server-side only).
  320×180 logical, integer-scaled, `image-rendering: pixelated`. Bubbles/ticker are
  HTML overlays for crisp text (Press Start 2P, graceful fallback).
- **Art:** currently 100% procedural (palette in the mockup source). Option later:
  free licensed 16-bit packs or custom sprites per agent tied to their brain profile.
- **v1 punts:** straight-line walking (no A*), one shared body with palette swaps,
  no click interactions. Planned clicks: desk → agent profile; office door → review
  inbox; whiteboard → task board.
