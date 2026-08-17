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
| `monitor` | monitor | the monitor-equipped desk region alone |
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
| `monitor.png` | `props/sheet-desks-workstations-v2.jpg` | 660, 16, 353, 233 | 9.2708 | monitor |
| `wall-monitor.png` | `props/sheet-lighting-states-v2.jpg` | 1080, 198, 138, 178 | 7.5833 | wallmon |
| `floor-tile.png` | `props/sheet-tiles-surfaces-v2.jpg` | 270, 20, 265, 220 | 4.7917 | floor |
| `wall-tile.png` | `props/sheet-tiles-surfaces-v2.jpg` | 1130, 20, 255, 220 | 4.7917 | wall |

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
- `floor-tile`, `wall-tile`: same source regions as t-59's committed
  `manifest-tiles.json`, byte-identical re-run confirmed.
- `monitor`, `wall-monitor`: new regions, not previously rectified. Two
  distinct CRT-screen deliverables sourced from two different sheets —
  see the per-region `_note` in each manifest for why they're not the same
  object and not duplicates of `desk`.

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
actual pixel area. Re-verified after the fix: side-by-side against source
at matched zoom, every agent frame now carries visibly warm, skin-toned
face and hand pixels (see the review note / mission log for the comparison
images).

## Mechanical floor: verified, not assumed

- **Zero key-adjacent pixels**: full scan of all 11 shipped sprites
  (11,947 fully-opaque pixels + 223 edge-band pixels) — zero fully-opaque
  pixels within `key_tolerance` of the magenta background, zero edge-band
  pixels scoring above `edge_hue_tolerance` on the magenta-hue test. Script
  logic mirrors `rectify.py`'s own two safety nets (Euclidean distance for
  opaque votes, hue score for decontaminated edge pixels), run independently
  against the shipped PNGs rather than trusted from the tool's own report.
- **Determinism**: every manifest re-run twice from a fresh download of its
  cited sheet; both runs and the originally-shipped set are byte-identical
  (`diff -rq`, zero differences) at every sprite.
- **Scale consistency**: each of the four manifests derives its own pitch
  from its own sheet's own measured 48px anchor figure — the canonical
  48px-agent system is what every sprite is expressed in regardless of
  each source sheet's own (inconsistent) generation scale.
