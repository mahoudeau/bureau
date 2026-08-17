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

| Sprite | Source sheet | Region (x, y, w, h) | Pitch (src px / logical px) | Group |
|---|---|---|---|---|
| `agent-idle-0.png` | `cast/sheet-agent-undercut-typing.jpg` | 24, 22, 150, 362 | 7.4167 | agent |
| `agent-typing-0.png` | `cast/sheet-agent-undercut-typing.jpg` | 190, 22, 290, 362 | 7.4167 | agent |
| `agent-typing-1.png` | `cast/sheet-agent-undercut-typing.jpg` | 496, 22, 292, 362 | 7.4167 | agent |
| `agent-typing-2.png` | `cast/sheet-agent-undercut-typing.jpg` | 804, 22, 285, 362 | 7.4167 | agent |
| `agent-typing-3.png` | `cast/sheet-agent-undercut-typing.jpg` | 1105, 22, 284, 362 | 7.4167 | agent |
| `desk.png` | `props/sheet-desks-workstations-v2.jpg` | 1035, 254, 350, 201 | 9.2708 | desk |
| `chair.png` | `props/sheet-desks-workstations-v2.jpg` | 55, 519, 159, 239 | 9.2708 | chair |
| `monitor.png` | `props/sheet-desks-workstations-v2.jpg` | 650, 12, 350, 108 | 9.2708 | monitor |
| `wall-monitor.png` | `props/sheet-lighting-states-v2.jpg` | 1080, 198, 138, 178 | 7.5833 | wallmon |
| `floor-tile.png` | `props/sheet-tiles-surfaces-v2.jpg` | 270, 20, 265, 220 | 10.0833 | floor |
| `wall-tile.png` | `props/sheet-tiles-surfaces-v2.jpg` | 1130, 20, 255, 220 | 10.0833 | wall |

Pitch is derived per-sheet from that sheet's own measured 48px-tall anchor
figure (never guessed, never shared across sheets) — this is what makes
every sprite's relative scale consistent with the canonical 48px-agent
system even though the four source sheets were generated at four different
absolute scales (a known generator flaw; the rectifier's whole job is to
correct for it). Full provenance — sheet SHA-256, anchor measurement,
per-sprite output SHA-256 — is in `rectify-manifests/report-*.json`.

## What's reused vs. new

- `agent-idle-0`, `agent-typing-0..3`: same source regions as t-59's
  round-27 committed manifest (byte-identical re-run confirmed against
  `t-59-office-sample-scene`'s own `report-typing.json`, commit `3071ab5`).
  **One deliberate change**: `palette_size` raised from 28 to 80 to fix a
  live blue-face defect — see "The blue-face defect, root-caused" below.
- `desk`, `chair`: same source regions as t-59's committed
  `manifest-desk.json`, byte-identical re-run confirmed.
- `floor-tile`, `wall-tile`: same source *regions* as t-59's committed
  `manifest-tiles.json`, but the tiles manifest's `anchor_region` height was
  corrected in this round (see "Round-2 fixes" below) — the pitch is now
  10.0833, not t-59's 4.7917, so these two sprites are intentionally NOT
  byte-identical to t-59's (they were ~2.1× oversized there).
- `monitor`, `wall-monitor`: new regions, not previously rectified. Two
  distinct CRT-screen deliverables sourced from two different sheets —
  see the per-region `_note` in each manifest for why they're not the same
  object and not duplicates of `desk`. The `monitor` region was tightened
  this round from the full-workstation composite to the isolated monitor
  (see "Round-2 fixes").

## The blue-face defect, root-caused (not just avoided)

t-141's own body names THE PALETTE LAW as "the root cause of the blue-face
defect" and makes a non-skin-colored face an automatic send-back. Before
shipping, I reproduced this defect live in the `agent` group and root-caused
it precisely, rather than assuming the existing per-subject grouping (already
correct, inherited from t-59) was sufficient protection on its own:

With `palette_size: 28` (t-59's inherited value), `build_shared_palette`'s
frequency-sorted greedy bucketing filled its entire 28-slot budget with
dark navy jacket/hair/background shades before ever reaching a skin-toned
bucket — dumping the group's full ranked vote list (5550 opaque votes, 357
buckets after quantization) showed the largest genuine skin cluster,
`(218,137,118)` at 16 votes, doesn't rank until position 58. Every skin
pixel was then forced by `snap_to_palette` onto the nearest dark-blue
entry: the blue-face defect, live, even though the `agent` group was
already correctly subject-isolated (no desk/tile/scene pixels mixed in).
The mechanism is budget truncation inside an already-correct single-subject
palette, not cross-subject contamination as such — worth naming precisely
since the fix is different from what "keep palettes subject-scoped" alone
implies.

The existing accent-color exemption doesn't rescue this: the lead skin
bucket's own saturation (~0.46) sits just under `accent_saturation_min`'s
0.5 threshold, and `accent_max_area_frac` is intentionally 0 across every
manifest here (t-59 round-25's fix — re-enabling it risks re-admitting the
JPEG-ringing-as-accent bug that fix closed). Fixed by raising
`palette_size` to 80 instead — tested empirically in increments (28→0 skin
entries survive in the resulting palette, 40→1, 48→2, 64→3, 80→7), and 80
was the first size tested that yields a real skin gradient (shadow through
highlight) rather than one flat tone, while still leaving 73 of 80 slots
for the jacket/hair/background material ramps that dominate the sprite's
actual pixel area.

**Second, independent fix, adopted mid-mission.** A concurrent builder
session (bettik) reached the same root-cause diagnosis via a different path
and pushed a tool-level fix to `hub/tools/rectify.py` on a side branch
(`bettik-t141-palette-law-handoff`, commit `58ad5b9`): a second gate in
`build_shared_palette`'s opaque-candidate path, reusing round 27's own
`magenta_hue_score()` against a new `palette_hue_tolerance` (default 25) —
catching palette candidates that clear the Euclidean distance-to-background
check but still carry the key's own hue (the same convex-combination-drift
class round 24 fixed for individual votes, reachable again once a bucket
*average* survives frequency ranking). Diffing my own already-raised
`palette_size=80` agent palette against this gate found it was a **live,
undisclosed defect in my own shipped work**, not a hypothetical: 3 palette
entries (e.g. `(54,2,56)`, hue score 52) had exactly this signature and
were present as scattered pixels (5-12 instances each) across all 5 agent
sprites — dark purple/violet flecks, the same "fringe-colored blotches"
class t-54's own chroma-key mechanical floor names as an automatic
send-back. Adopted bettik's fix verbatim (cherry-picked from their branch)
rather than re-deriving it, re-ran every manifest, and re-verified from
scratch: the hue gate rejects 25 candidates in the `agent` group (the 3
found plus 22 more, none previously flagged by any other check), 7
skin-tone entries still survive in the resulting palette (unchanged from
before), and the other three manifests (desk/chair/monitor, tiles,
wallmonitor) are byte-identical to their pre-fix output — none of their
palettes had an entry scoring above 25, so the new gate is a no-op for
them. Determinism and the full mechanical scan (now including opaque-pixel
hue, not just distance) both re-confirmed clean after adopting the fix —
see below.

A third independent session (a second concurrent bettik instance) reached
the same diagnosis and pushed a third variant (hue gate + `palette_size`
128, kept `accent_max_area_frac=0`) to `t-59-office-sample-scene` commit
`0298b16` — not adopted here since bettik's `bettik-t141-palette-law-handoff`
fix was simpler to integrate against this mission's own already-verified
`palette_size=80` and equally well-calibrated; flagged for the lead in case
the two diverge on some future sheet.

## Round-2 fixes (critic send-back on PR #50)

Three defects the critic (moneta) and cross-session diagnosis found on the
first PR #50 draft, all fixed and re-verified this round:

1. **Edge-band green fabrication (`rectify.py`).** `cell_vote_grid`'s
   decontamination `fg = (observed - (1-frac)*bg)/frac` divides by `frac`;
   for an edge cell only just past `inner_tol` (`frac` ≈ 0.01–0.3) it
   amplifies a few units of JPEG/anti-alias noise into a wildly off-color
   `fg` that `np.clip` then snaps onto a saturated primary. Against the
   magenta key (G=0) this fabricates pure `(0,255,0)` green — a color absent
   from every source sheet — and the existing magenta-hue net can't catch it
   (green scores *negative* on `min(R,B)-G`). Present on typing-0..3,
   wall-monitor, idle-0 (32 cells atlas-wide, e.g. `(0,255,0)` at alpha 8).
   Fixed with two new, independently-calibrated gates dropping such cells to
   transparent instead of shipping the clip: `edge_overshoot_tolerance`
   (default 16) catches the pre-clip out-of-gamut blow-up; a companion
   `magenta_complement_score` gate, `edge_complement_tolerance` (default 12),
   catches the subtler in-gamut sibling (a mostly-background cell unmixing to
   a green-peaked but in-range `fg`). Calibrated atlas-wide: legitimate edge
   cells overshoot ≤5 and score ≤1 on `g-max(R,B)`; every fabricated cell
   overshoots ≥17 or scores ≥23 — wide clean margin both sides. Legitimate
   cyan (high G≈B) is deliberately not caught (`max`, not `min`, of R,B).
   Result: **0 green-peaked pixels atlas-wide**, silhouettes intact (1–5
   speckle cells removed per agent sprite, 34 on wall-monitor; skin tones
   unchanged).
2. **Tiles ~2.1× oversized (`manifest-tiles.json`).** The inherited
   `anchor_region` height was 240, which cut this sheet's own scale-anchor
   figure off at row 250 — the figure actually runs rows 20..503 (484px) and
   the box truncated it to 230px, halving the derived pitch. Floor/wall tiles
   shipped at 55×45 / 52×45 instead of 26×21 / 24×21, breaking the "scale
   consistent with the 48px anchor across the whole set" floor. Fixed by
   enlarging `anchor_region` to `[50,10,165,520]` so auto-measure derives the
   true pitch (10.0833) — the figure is a single cleanly-isolated component
   (measure returns a stable 484 for every box from `[50,10,165,510]` to
   `[45,5,175,540]`), so this is the honest fix, not a hand-typed
   `anchor_source_px_height` override.
3. **CRT monitor was a desk composite.** The first draft's `monitor` region
   (`660,16,353,233`) ran down through the keyboard, desk surface and drawers,
   making "CRT monitor" a near-duplicate of the separate `desk` deliverable.
   Tightened to the isolated monitor (`650,12,350,108`, adopted from the
   independently-verified isolated `crt-monitor` of the reconciled-away PR
   #51) — a legible 37×11 sprite: glowing blue-green screen in a dark bezel
   on a widening stand/desk-contact base, zero edge fabrication.

`desk` and `chair` are byte-identical to the first PR #50 draft (their
palette groups are independent of the `monitor` region change).

## Mechanical floor: verified, not assumed

- **Zero key-adjacent pixels**: full scan of all 11 shipped sprites
  (7,784 fully-opaque pixels + 168 edge-band pixels) against independent
  nets, run against the shipped PNGs rather than trusted from the tool's own
  report — zero fully-opaque pixels near the magenta background, zero
  fully-opaque pixels scoring above 25 on the magenta-hue test (the
  palette-drift class), and **zero green-peaked pixels atlas-wide**
  (`g-max(R,B)>12`, the round-2 fabrication class the two new edge gates
  close). Every net's logic mirrors `rectify.py`'s own safety nets.
- **Determinism**: every manifest re-run twice from a fresh download of its
  cited sheet; both runs and the originally-shipped set are byte-identical
  (`diff -rq`, zero differences) at every sprite.
- **Scale consistency**: each of the four manifests derives its own pitch
  from its own sheet's own measured 48px anchor figure — the canonical
  48px-agent system is what every sprite is expressed in regardless of
  each source sheet's own (inconsistent) generation scale.
