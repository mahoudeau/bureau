# Design

Scaffold, not a system. This records the direction, what is decided, and what is still open. It becomes a real design system only after the office look is settled; until then, decide against this doc and append, do not redesign in place.

## Direction

**Inspiration: Sea of Stars.** Modern retro, not authentic retro. Pixel art with today's rendering: rich saturated color, dramatic light, painterly skies through the windows, smooth animation. The office should feel warm and alive, like a place you would want to check on, not a museum of 1994 constraints. We take the constraints that read as charm (chunky pixels, limited palette per element, tile grid) and drop the ones that read as poverty (dithered gradients, 3-frame walks, flat lighting).

What that means concretely for Bureau:

- **Light is the mood carrier.** Time of day changes the office: warm lamps at night, cool morning light, long shadows in the evening. Quiet hours look quiet. Activity looks lit.
- **Color is saturated but disciplined.** Each element owns a small ramp. Status meaning never rides on hue alone; position, icon, and animation carry it too.
- **Animation is fluid where it counts.** Walk cycles and idle loops can be simple; the money is in easing, bounce, and transitions (a card floating to the shipping wall, a ghost card drifting back to the board).
- **The dashboard stays quiet.** The flat view at `/` is the office's opposite: neutral surfaces, restrained color, information first. The office is the show; the dashboard is the desk drawer.

## Knowns (decided)

- Two surfaces, one event stream: flat dashboard at `/`, pixel office at `/office`.
- The office is the brand. The dashboard borrows nothing from the pixel style.
- Office animates only the generic activity verbs (docs/protocol.md), never vendor events.
- Canvas at a small logical resolution, integer-scaled, `image-rendering: pixelated`. The mockup uses 320x180; resolution may change, the integer-scaling rule does not.
- Crisp text lives in HTML overlays (bubbles, ticker, HUD), not on the canvas.
- Art is currently 100% procedural (drawn in code, no image assets). Whether that survives contact with the Sea of Stars bar is an open question below.
- Status colors on the dashboard follow the token roles already in `hub/public/index.html` (light and dark, system preference).
- A shared `tokens.css` will be extracted when office v1 is wired, so the two surfaces stop drifting.
- If external sprite or furniture packs are ever supported, they load from a simple manifest format (a folder of PNGs plus a manifest file), so packs are makeable without touching code.

## Unknowns (open, decide during office v1)

- **Final office palette.** The mockup's warm SNES-ish palette is a placeholder. Needs a real ramp set designed under the Sea of Stars bar, validated for contrast in both day and night scenes.
- **Lighting technique.** Sea of Stars lighting in a hand-rolled canvas: per-tile tint layers, a simple normal-map trick, or baked day/night palettes. Pick the cheapest one that looks alive.
- **Day/night source.** Mapped to the server's local time, the viewer's, or to activity (office dims when no sessions have run)? Leaning: activity first, clock second.
- **Tile size and character resolution.** 16px tiles with 12x16 characters (current mockup) vs 32px tiles with taller characters. Bigger reads better on large screens and matches the inspiration; costs more art.
- **Procedural vs drawn assets.** Procedural got the mockup approved cheaply. The Sea of Stars bar probably wants real sprite sheets eventually, custom or from licensed packs. Decide when the palette is locked.
- **Character identity.** One body with palette swaps (current) vs distinct silhouettes per agent. Distinct silhouettes matter if agents are the demo.
- **Typeface.** Press Start 2P is the placeholder; it is loud. Candidates: a quieter pixel font for the HUD, system sans for the dashboard (already true).
- **Sound.** Chimes on review-ready and task-done, ambient office loop, or nothing. Off by default either way.
- **Engine.** Hand-rolled canvas vs PixiJS/Phaser from CDN. Hand-rolled holds up for v1; revisit if lighting or pathfinding get expensive.
- **Motion accessibility.** A reduced-motion mode honoring the OS preference; scope unknown until the animation set exists.

## Non-negotiables (survive any redesign)

- Meaning never rides on color alone.
- The office must be readable as a status display at a glance, from across a demo room: who is here, who is stuck, what needs the boss.
- Everything renders from the same SSE stream a curl script can feed. No design decision may require a richer event source than the protocol provides.

## Next steps

1. Wire office v1 to the live stream (roadmap phase 1.5).
2. Design the real palette and lighting pass under the Sea of Stars bar.
3. Extract `tokens.css` from what survives.
4. Promote this scaffold to a real design doc: palette values, sprite specs, animation timings, asset manifest.
