# Design

Two surfaces, one event stream: the dashboard at `/` and the pixel office at `/office`. This records what's decided and what's still open.

## The dashboard

The dashboard is built on omako-ds, in `hub/public/omako-ds/`. Plain CSS, no build, no dependency. The specimen is at `/ds` on any hub.

- **Ink, paper and dither. No hue.** Inversion is the only colour. Dark mode swaps the two.
- **Hover is inversion, and it's instant.** Nothing floats, nothing is rounded. A shadow is hard ink or dither.
- **Mono for all text, Archivo for page titles only.** Hierarchy comes from weight and size.
- **Two registers.** Poster has 4px rules and big Archivo, for pages people read once. Desk is `data-density="compact"`: 1px rules, mono, hierarchy by weight. The dashboard is desk.
- **Every object is a page with a URL.** A mission, a goal, a project, a brain note. No side panels. The command palette is the one overlay.
- **Themes are system, paper and ink.**
- **Every page works at phone width.**

### Dither

Dither is the one source of tone: patterns of ink on paper, the way a four-colour handheld got its greys.

1. Text never sits on a pattern. Knock it out on paper, or write it beside.
2. A pattern never means something alone. Label it, or give it a title.
3. The ramp (12, 25, 50, 75, 100) is for a quantity or an order of steps. Hatch, cross and bars break the ramp on purpose, for exceptions.
4. Five steps is the limit of what the eye separates at a glance.

### Status

A status is a swatch and a word. The mapping is the app's, in `hub/public/app/status.js`, never in omako-ds. The server-rendered pages hold the same pairs, and a test keeps the two in step.

| Status | Pattern |
|---|---|
| queued | d12 |
| claimed | d25 |
| in progress | d50 |
| review | d75 |
| done | d100 |
| approved | bars |
| blocked | hatch |
| failed | cross |
| discarded | d0 |

### The capability pages

`/r/<token>` and `/m/<token>` are opened from a phone. They're server-rendered with no script, and take omako-ds through stylesheet links. Controls are at least 44px tall there.

## The office

The office is drawn in the register of the 1989 Game Boy: four shades on screen at once, dithering for the tones in between, 8px tiles, 16x16 characters. The hi-bit 16-bit track from an earlier direction is parked, not deleted (PRs #50 and #55).

- **Four shades, one palette at a time.** Meaning comes from shape, position, icons and motion, never from a fifth shade.
- **Charm from the constraints.** Chunky pixels, a tile grid and a small screen are the point. Smoothness goes into easing and choreography: a folder carried to the board, a card left at the boss's door.
- The office animates only the generic activity verbs (docs/protocol.md), never vendor events.
- **Canvas:** 384x216 logical pixels, upscaled by whole device pixels, `image-rendering: pixelated`. The viewer can set the scale; auto picks the largest that fits.
- **Palettes:** four, switchable by the viewer: olive, DMG pea-green, pocket gray and amber, each also available inverted. These belong to the office. The dashboard doesn't have them.
- **Art:** hand-drawn 4-shade sprites, authored as indexed pixel maps in `hub/public/office-assets.js` and browsable at `/office/assets`. No image files.
- **Guarded in CI:** `test/office-guard.sh` checks that every draw stays on the 384x216 canvas and every pixel is one of the palette's four shades, at every phase and view.
- **Type:** OfficePixel (`hub/public/office-font.ttf`) for everything in the office. Crisp text lives in HTML overlays (bubbles, ticker, HUD), not on the canvas.
- **Engine:** hand-rolled canvas, no game library.
- **The website** (getbureau.dev) reuses the office's sprites, palettes and font.
- If external sprite or furniture packs are ever supported, they load from a simple manifest format (a folder of PNGs plus a manifest file), so packs are makeable without touching code.

The office and the dashboard don't share tokens. They do share the idea: a few tones, made by pattern.

### Still open

- **Character identity.** One body with palette swaps (today) or distinct silhouettes per agent. Silhouettes matter if agents are the demo.
- **Day and night.** Whether the office changes with the clock, with activity, or not at all.
- **Sound.** Chimes on review-ready and task-done, an ambient loop, or nothing. Off by default either way.
- **Motion accessibility.** A reduced-motion mode honoring the OS preference; scope unknown until the animation set settles.
- **Pathfinding.** Agents walk in straight lines. A* only if the office layout starts to need it.

## Both surfaces

- Meaning never rides on colour alone.
- Everything renders from the same SSE stream a curl script can feed. No design decision may require a richer event source than the protocol provides.
- The office must be readable as a status display at a glance, from across a room: who is here, who is stuck, what needs the boss.
