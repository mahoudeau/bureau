# Office stage 1: the rectified sprite set (t-141, goal t-54)

Boss re-scope 2026-08-17: extraction, composition and animation are now
separate stages with frozen outputs. This directory is stage 1's complete
deliverable — sprites only. **No scene, no animation, no page.** Every file
here is a true native-resolution transparent PNG produced by
`hub/tools/rectify.py` (the shared rectifier, a t-54 engine outcome) from
the boss-generated reference sheets under
`projects/bureau/references/office/` in the brain. Nothing here was
hand-drawn, hand-despeckled, or hand-quantized — re-run any manifest in
`rectify-manifests/` against its cited sheet region and the output is
byte-identical to what shipped (verified below).

## THE RESOLUTION LAW — 1:1 native extraction (round 5)

The binding law (boss send-back 2026-08-17): rectified sprites keep the
source's native pixel resolution; the output is never coarser than its cited
source region. Round 3 crushed the agent head to ~8×11px; round 4 raised it
but still delivered 66–90% of source (a shared `anchor_logical_height`
normalization downscaled every sheet below native, failing the ≥90% floor).

Round 5 goes **true 1:1**: `hub/tools/rectify.py` now honours a direct
`"pitch": 1.0` manifest field — one output pixel per source pixel, bypassing
the anchor→logical-height normalization entirely (that normalization, the old
"48px system", *was* the resolution defect). Every sprite's output pixel
dimensions now **equal** its cited source region exactly (100% on each axis,
clearing the ≥90% floor with full margin). `anchor_region` /
`anchor_logical_height` remain in each manifest as scale documentation but no
longer drive output size. Scale consistency is satisfied by construction: at a
shared pitch of 1.0, every sprite's output equals its cited source region, so
the relative proportions between sprites match the relative proportions
between their cited regions exactly (the mission's scale-consistency
criterion; the old 48px-anchor criterion is void). Grid phase is pinned
`[0,0]` on every region — immaterial at 1px cells, and it keeps re-runs
byte-deterministic with no `best_phase` surface.

## One subject per sprite (Lead ruling — round 5)

The agent **typing** frames previously shipped the full workstation (agent +
desk + CRT monitor + keyboard + desk lamp baked into one sprite), failing the
Lead ruling "one subject per sprite; a typing frame shipping a full
workstation fails." Round 5 re-crops `agent-typing-0..3` to the **seated agent
+ office chair alone**: the x-extent is cut at the desk's front edge / the
agent's keyboard-resting wrist, excluding the desk, monitor, keyboard body,
lamp and supplies (those are separate sprites stage 2 composes into a
workstation). All five agent frames keep `y=22, h=362` so they share one
vertical origin and scale and align as an animation. The hands read as
reaching toward an absent surface — correct for a seated typing pose.

## THE PALETTE LAW, applied

Every sprite's palette is built ONLY from that sprite's own subject-group
pixels — never mixed across subjects, never shared with a scene. Four
manifests, one per source sheet, seven independent palette groups:

| Group | Sprites | Own palette derived from |
|---|---|---|
| `agent` | agent-idle-0, agent-typing-0..3 | all 5 agent frames, together (never per-frame) |
| `desk` | desk | desk-tidy region alone |
| `chair` | chair | chair region alone |
| `monitor` | monitor | the isolated CRT-monitor region alone |
| `wallmon` | wall-monitor | the wall CRT-TV region alone |
| `floor` | floor-tile | floor region alone |
| `wall` | wall-tile | wall region alone |

Skin stays skin-colored via `palette_size=80` on the agent group (fixes the
frequency-budget truncation that once ranked the best skin bucket #58 of 357)
and the `palette_hue_tolerance=25` magenta-hue palette gate. At 1:1 skin also
occupies many cells and survives ranking comfortably; both guards are kept as
no-cost regression protection.

## Sprite citations

| Sprite | Source sheet | Region (x, y, w, h) | Output px | Pitch | Group |
|---|---|---|---|---|---|
| `agent-idle-0.png` | `cast/sheet-agent-undercut-typing.jpg` | 24, 22, 150, 362 | 150×362 | 1.0 | agent |
| `agent-typing-0.png` | `cast/sheet-agent-undercut-typing.jpg` | 190, 22, 142, 362 | 142×362 | 1.0 | agent |
| `agent-typing-1.png` | `cast/sheet-agent-undercut-typing.jpg` | 496, 22, 155, 362 | 155×362 | 1.0 | agent |
| `agent-typing-2.png` | `cast/sheet-agent-undercut-typing.jpg` | 804, 22, 142, 362 | 142×362 | 1.0 | agent |
| `agent-typing-3.png` | `cast/sheet-agent-undercut-typing.jpg` | 1105, 22, 149, 362 | 149×362 | 1.0 | agent |
| `desk.png` | `props/sheet-desks-workstations-v2.jpg` | 1035, 254, 350, 201 | 350×201 | 1.0 | desk |
| `chair.png` | `props/sheet-desks-workstations-v2.jpg` | 55, 519, 159, 239 | 159×239 | 1.0 | chair |
| `monitor.png` | `props/sheet-desks-workstations-v2.jpg` | 650, 12, 350, 108 | 350×108 | 1.0 | monitor |
| `wall-monitor.png` | `props/sheet-lighting-states-v2.jpg` | 1080, 198, 138, 178 | 138×178 | 1.0 | wallmon |
| `floor-tile.png` | `props/sheet-tiles-surfaces-v2.jpg` | 855, 25, 228, 218 | 228×218 | 1.0 | floor |
| `wall-tile.png` | `props/sheet-tiles-surfaces-v2.jpg` | 1130, 20, 255, 220 | 255×220 | 1.0 | wall |

Full provenance — sheet SHA-256, anchor measurement, per-sprite output
SHA-256 — is in `rectify-manifests/report-*.json`.

## Floor / wall register (Lead ruling — round 5)

The Lead ruling binds the floor/wall tiles to the reference scene
(`projects/bureau/references/office/scenes/scene-open-office-night.jpg`):
cool-night register, no regrading, usable in the scene's receding floor plane.

- **`floor-tile`** was re-cited from the round-4 **warm-brown planks**
  (270,20,265,220), which failed the register ruling ("a tile reading warm
  daylight fails register match"), to the **cool blue-grey floor texture**
  (row 1 col 3, 855,25,228,218) that matches the scene's cool floor register.
  **Source limitation, flagged for the critic/lead:** the reference floor
  reads as cool-blue *planks*, but this sheet carries only *warm* plank tiles
  or *cool non-plank* textures — no cool plank exists. Since the register
  ruling is binding and regrading is forbidden, the register-correct cool
  texture is cited over the texture-correct warm planks. A flat texture is the
  correct stage-1 form; stage 2 projects it into the receding floor plane.
- **`wall-tile`** stays the cool cracked-plaster region (1130,20,255,220),
  already cool-night register, matching the scene walls.

## Mechanical floor — verified against the shipped PNGs (round 5)

- **Resolution floor**: every sprite's output dimensions equal its cited
  source region (100% each axis — clears the ≥90% floor).
- **Zero key-adjacent pixels**: full scan of all 11 sprites (362,074 opaque
  px) — zero near-magenta, zero magenta-hue-drift (>25), zero green-fabrication
  (>12) pixels.
- **Determinism**: every manifest re-run into a second output dir,
  byte-identical to the committed set. Phases pinned → no `best_phase`
  nondeterminism surface.
- **Report ↔ PNG chain**: every `report-*.json` `sha256` equals its committed
  PNG's.
- **Skin**: every agent face carries warm skin (`(221,148,126)` class) — no
  blue-face.

## How to reproduce

Place the four sheets from the brain
(`GET /api/knowledge?file=projects/bureau/references/office/<sheet>&raw=1`) at
their manifest-relative paths (`cast/…`, `props/…`) beside
`rectify-manifests/`, then for each manifest:

```
python3 hub/tools/rectify.py rectify-manifests/<manifest>.json --out-dir OUT/
```

Agent region outputs (`idle-0.png`, `typing-*.png`) are committed with an
`agent-` filename prefix; every other region's output filename matches its
committed name. Compare `OUT/*.png` SHA-256 to the committed sprites and to
each `report-*.json` — all three agree.
