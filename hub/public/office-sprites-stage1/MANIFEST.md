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

## The native-resolution rescale (this round — the boss's send-back)

The boss sent the previous round back for a **resolution mismatch**: the
character's head is ~100×145px in the source illustration but rectified to
~8–11px here — "less than 10× the source." That was the single shared root
cause under every prior per-sprite send-back: with `anchor_logical_height`
pinned to **48**, the whole set was crushed to a 48px-tall system, so the
head fell to ~8px, the CRT monitor to a 37×11 blob, the desk to a dark slab,
and the wall tile to one flat colour — no facial feature, screen glyph,
plank seam or crack could survive a ~7–10px cell pitch. Every earlier fix
(a manual face phase, a crack-rescue detail gate) was fighting that pitch
one sprite at a time.

The fix is one knob, applied uniformly. `anchor_logical_height` is raised to
**320** across **all four** manifests, so the shared scale-anchor character
is 320px on every sheet — cross-sheet scale consistency is preserved (the
mission's "scale consistent across the set" bar, now anchored 6.67× larger,
which the boss's resolution ruling supersedes over the literal 48). Pitch is
now ~1.1–1.5 (near source-native): the head lands ~100px, matching its cited
source region, and every prop's structure survives on its own. Because the
pitch is near-native, two pitch-7.4-era hacks are removed as obsolete — the
`idle-0` manual `phase [5,3]` (a smear-avoidance offset that only mattered
when features were thinner than a cell) and the `wall-tile`
`detail_dark_min_frac` crack-rescue (the cracks now survive the fine pitch
directly). Every region's grid phase is instead pinned `[0,0]`: at near-native
pitch a sub-pixel phase offset is immaterial, and pinning removes
`best_phase`'s O(36 × grid) cost, so a critic's determinism re-run is seconds
rather than minutes and byte-identical.

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

## Sprite citations

| Sprite | Source sheet | Region (x, y, w, h) | Output px | Pitch (src/logical) | Group |
|---|---|---|---|---|---|
| `agent-idle-0.png` | `cast/sheet-agent-undercut-typing.jpg` | 24, 22, 150, 362 | 134×325 | 1.1125 | agent |
| `agent-typing-0.png` | `cast/sheet-agent-undercut-typing.jpg` | 190, 22, 290, 362 | 260×325 | 1.1125 | agent |
| `agent-typing-1.png` | `cast/sheet-agent-undercut-typing.jpg` | 496, 22, 292, 362 | 262×325 | 1.1125 | agent |
| `agent-typing-2.png` | `cast/sheet-agent-undercut-typing.jpg` | 804, 22, 285, 362 | 256×325 | 1.1125 | agent |
| `agent-typing-3.png` | `cast/sheet-agent-undercut-typing.jpg` | 1105, 22, 284, 362 | 255×325 | 1.1125 | agent |
| `desk.png` | `props/sheet-desks-workstations-v2.jpg` | 1035, 254, 350, 201 | 251×144 | 1.3906 | desk |
| `chair.png` | `props/sheet-desks-workstations-v2.jpg` | 55, 519, 159, 239 | 114×171 | 1.3906 | chair |
| `monitor.png` | `props/sheet-desks-workstations-v2.jpg` | 650, 12, 350, 108 | 251×77 | 1.3906 | monitor |
| `wall-monitor.png` | `props/sheet-lighting-states-v2.jpg` | 1080, 198, 138, 178 | 121×156 | 1.1375 | wallmon |
| `floor-tile.png` | `props/sheet-tiles-surfaces-v2.jpg` | 270, 20, 265, 220 | 175×145 | 1.5125 | floor |
| `wall-tile.png` | `props/sheet-tiles-surfaces-v2.jpg` | 1130, 20, 255, 220 | 168×145 | 1.5125 | wall |

Pitch is derived per-sheet from that sheet's own measured anchor figure
(never guessed, never shared across sheets) at a shared logical height of
320 — this is what makes every sprite's relative scale consistent across the
set even though the four source sheets were generated at four different
absolute scales (a known generator flaw; the rectifier's whole job is to
correct for it). Full provenance — sheet SHA-256, anchor measurement,
per-sprite output SHA-256 — is in `rectify-manifests/report-*.json`.

## THE PALETTE LAW, root-caused (the blue-face defect)

t-141's own body names THE PALETTE LAW as "the root cause of the blue-face
defect" and makes a non-skin-colored face an automatic send-back. Beyond
per-subject grouping (already inherited from t-59), two protections in the
tool keep skin skin-colored, both still active this round:

- **`palette_size` budget (agent = 80).** With `palette_size: 28`,
  `build_shared_palette`'s frequency-sorted greedy bucketing filled its
  entire budget with dark navy jacket/hair/background shades before ever
  reaching a skin-toned bucket — the largest genuine skin cluster,
  `(218,137,118)`, doesn't rank until position 58, so `snap_to_palette`
  forced every skin pixel onto the nearest dark-blue entry. That is budget
  truncation inside an already-correct single-subject palette, not
  cross-subject contamination. Raising `palette_size` to 80 restores a real
  skin gradient (shadow→highlight) while leaving the great majority of the
  budget for the material ramps that dominate the sprite's pixel area.
- **The magenta-hue palette gate (`palette_hue_tolerance = 25`).** A second
  gate in `build_shared_palette`'s opaque-candidate path (reusing
  `magenta_hue_score()`) rejects palette candidates that clear the Euclidean
  distance-to-background check but still carry the key's own hue — the
  convex-combination-drift class that would otherwise scatter dark
  purple/violet flecks across the sprites.

At the new near-native pitch, skin occupies many more cells and survives
frequency ranking comfortably, but both protections are kept: they cost
nothing when unneeded (the other three manifests' palettes have no candidate
scoring above 25, so the hue gate is a no-op for them) and guard against
regression.

## The rectifier's edge safety nets (unchanged, still verified)

`rectify.py` carries three edge-band nets that this set is re-verified
against, all from the t-59/t-141 lineage:

- **Two-band soft chroma-key with decontamination** — anti-aliased edge
  pixels get ramped alpha, not a hard cutoff, killing fringe halos.
- **`edge_overshoot_tolerance` (16)** — an edge cell whose pre-clip
  decontaminated colour blows more than this far outside `[0,255]` is dropped
  to transparent rather than clipped onto a fabricated saturated primary
  (the `(0,255,0)`-against-magenta class).
- **`edge_complement_tolerance` (12)** and **`edge_hue_tolerance` (40)** —
  catch the subtler in-gamut green-peaked sibling and any residual
  magenta-tinted edge cell.

## Mechanical floor: verified, not assumed (this round)

Run against the **shipped PNGs**, not trusted from the tool's own report:

- **Zero key-adjacent pixels**: full scan of all 11 sprites — zero opaque
  pixels near the magenta background, zero opaque pixels scoring above 25 on
  the magenta-hue test, zero green-peaked pixels atlas-wide.
- **Determinism**: every manifest re-run into a second output dir; sprites
  are byte-identical (SHA-256) across runs. Phases are pinned, so there is no
  `best_phase` nondeterminism surface at all.
- **Report ↔ PNG chain**: every `report-*.json` `sha256` equals the SHA-256
  of its committed PNG.
- **Skin**: every agent face carries warm skin (lead skin bucket
  `(221,148,126)`), ~1000 skin pixels in the idle-0 head band alone — no
  blue-face.
- **Scale consistency**: all four manifests share `anchor_logical_height =
  320`; each derives its own pitch from its own sheet's own measured anchor
  figure, so the shared 320px-anchor character is the common scale every
  sprite is expressed in.

## How to reproduce

The manifests cite each sheet relative to their own directory
(`cast/…`, `props/…`). Place the four sheets from the brain
(`GET /api/knowledge?file=projects/bureau/references/office/<sheet>&raw=1`)
at those relative paths beside `rectify-manifests/`, then for each manifest:

```
python3 hub/tools/rectify.py rectify-manifests/<manifest>.json --out-dir OUT/
```

Agent region outputs (`idle-0.png`, `typing-*.png`) are committed with an
`agent-` filename prefix; every other region's output filename matches its
committed name. Compare `OUT/*.png` SHA-256 to the committed sprites and to
each `report-*.json` — all three agree.
