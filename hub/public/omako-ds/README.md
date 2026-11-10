# omako-ds

OMAKO's design system. Plain CSS, no build, no dependency. Ink, paper and dither. The specimen is at `/ds` on any Bureau hub.

## The rules

- Inversion is the only colour. No hue anywhere.
- Hover is inversion, and it's instant. Nothing floats, nothing is rounded. A shadow is hard ink or dither.
- Text never sits on a pattern. Knock it out on paper, or write it beside.
- A pattern never means something alone. Label it, or give it a title.
- The ramp (12, 25, 50, 75, 100) is for a quantity or an order of steps. Hatch, cross and bars break the ramp on purpose, for exceptions.
- Five steps is the limit of what the eye separates at a glance.
- Every class is prefixed `om-`, so nothing clashes with a host's classes.

## Two registers

**Poster** is the default: 4px rules and big Archivo, for pages people read once.

**Desk** is `data-density="compact"` on the page or on one part of it: 1px rules, mono, hierarchy by weight, for screens that hold a lot. Inside a compact page, `data-density="poster"` brings the loud controls back for one part.

## Taking it

**omako.fr** already uses `--ink`, `--paper`, `--rule` and `--pad`, so it can take `tokens.css` and `fonts.css` without changing a rule.

**A new app** loads `all.css`, puts `class="om-page"` on the body, and sets `data-theme="light"` or `"dark"` on html if it doesn't want to follow the system. Everything is relative, so copy the folder as it is. The app keeps its own mapping from meaning to pattern. A status is the app's idea, not the system's.

## What's in it

| File | What |
|---|---|
| `all.css` | Imports the rest |
| `fonts.css`, `fonts/` | Archivo and JetBrains Mono, both OFL |
| `tokens.css` | Colours, type, space, controls, density |
| `dither.css` | The ramp, hatch, cross, bars, swatch, band, meter, wait, lift |
| `components.css` | Type, layout, top bar, buttons, fields, chips, rows, cards, tags, tables, tabs, banners, dialog, palette, toast, footer |
| `prose.css` | Long-form text and rendered markdown |
