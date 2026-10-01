# Design

Scaffold, not a system. This records the direction, what is decided, and what is still open. Decide against this doc and append; don't redesign in place.

## Direction

**The original Game Boy.** The office is drawn in the register of the 1989 handheld: four shades on screen at once, dithering for the tones in between, 8px tiles, 16x16 characters. It started out aiming at Sea of Stars, modern retro with rich color and dramatic light. The Game Boy direction replaced it. The hi-bit 16-bit track from that time is parked, not deleted (PRs #50 and #55).

What that means concretely:

- **Four shades, one palette at a time.** Meaning comes from shape, position, icons and motion, never from a fifth color.
- **Charm from the constraints.** Chunky pixels, a tile grid and a small screen are the point. Smoothness goes into easing and choreography: a folder carried to the board, a card left at the boss's door.
- **The dashboard stays quiet.** The flat view at `/` is the office's opposite: neutral surfaces, restrained color, information first. The office is the show; the dashboard is the desk drawer.

## Knowns (decided)

- Two surfaces, one event stream: the flat dashboard at `/`, the pixel office at `/office`.
- The office is the brand. The dashboard borrows nothing from the pixel style.
- The office animates only the generic activity verbs (docs/protocol.md), never vendor events.
- **Canvas:** 384x216 logical pixels, upscaled by whole device pixels, `image-rendering: pixelated`. The viewer can set the scale; auto picks the largest that fits.
- **Palettes:** four, switchable by the viewer: olive, DMG pea-green, pocket gray and amber, each also available inverted.
- **Art:** hand-drawn 4-shade sprites, authored as indexed pixel maps in `hub/public/office-assets.js` and browsable at `/office/assets`. No image files.
- **Guarded in CI:** `test/office-guard.sh` checks that every draw stays on the 384x216 canvas and every pixel is one of the palette's four shades, at every phase and view.
- **Type:** OfficePixel (`hub/public/office-font.ttf`) for everything in the office. Crisp text lives in HTML overlays (bubbles, ticker, HUD), not on the canvas. The dashboard uses the system sans.
- **Engine:** hand-rolled canvas, no game library. The zero-dependency rule is server-side only, but nothing has needed a library yet.
- **Dashboard tokens:** the v2 dashboard (`/v2`) takes its colors and spacing from `hub/public/v2/tokens.css`, light and dark, following the system preference. The office takes its colors from its palettes. They don't share tokens, on purpose.
- **The website** (getbureau.dev) reuses the office's sprites, palettes and font, so the brand is one thing.
- If external sprite or furniture packs are ever supported, they load from a simple manifest format (a folder of PNGs plus a manifest file), so packs are makeable without touching code.

## Unknowns (open)

- **Character identity.** One body with palette swaps (today) or distinct silhouettes per agent. Silhouettes matter if agents are the demo.
- **Day and night.** Whether the office changes with the clock, with activity, or not at all.
- **Sound.** Chimes on review-ready and task-done, an ambient loop, or nothing. Off by default either way.
- **Motion accessibility.** A reduced-motion mode honoring the OS preference; scope unknown until the animation set settles.
- **Pathfinding.** Agents walk in straight lines. A* only if the office layout starts to need it.

## Non-negotiables (survive any redesign)

- Meaning never rides on color alone.
- The office must be readable as a status display at a glance, from across a demo room: who is here, who is stuck, what needs the boss.
- Everything renders from the same SSE stream a curl script can feed. No design decision may require a richer event source than the protocol provides.
