# Sprite set (t-141, goal: t-54) — stage 1 output

Individual, transparent, native-resolution PNGs produced by `hub/tools/rectify.py`
against the manifests in `../rectify-manifests/`. No composed atlas, no scene,
no page — each subject's frames were rectified as their own group, so each
group's palette is derived from that subject's own source pixels only (THE
PALETTE LAW this mission's own body names as binding).

Each subdirectory holds its sprite PNGs plus the `rectify-report.json` the
tool itself writes — that report **is** the manifest citing each sprite's
exact source sheet, source region (`source_box`), phase, pitch, and content
sha256; nothing here is hand-transcribed.

| Group | File | Source sheet | Region |
|---|---|---|---|
| agent | idle-anchor.png | references/office/cast/sheet-agent-undercut-typing.jpg | idle-anchor |
| agent | typing-0.png .. typing-3.png | same sheet | typing-0..3 |
| desk | desk-tidy.png | references/office/props/sheet-desks-workstations-v2.jpg | desk-tidy |
| desk | chair.png | same sheet | chair |
| tiles | floor-wood.png | references/office/props/sheet-tiles-surfaces-v2.jpg | floor-wood |
| tiles | wall-cracked.png | same sheet | wall-cracked |
| window | window-blue-night.png | references/office/scenes/scene-window-states.jpg | window |

Source JPEGs are never committed to the repo (convention predating this
mission) — the manifests' `sheet` paths resolve relative to
`rectify-manifests/`, fetched from `projects/bureau/references/office/` in
the brain at build time.

## Verified

- Determinism: re-ran `manifest-typing4.json` twice, all 5 output PNGs
  byte-identical (sha256-matched) both runs.
- Zero key-adjacent opaque pixels: scanned every PNG above, full pixel sweep
  (not sampled), same distance+hue test `rectify.py`'s own palette builder
  uses (`color_dist` < 60 or `magenta_hue_score` > 40 on any fully-opaque
  pixel) — 0 hits across all 10 files.
- Scale: every group's `anchor_logical_height` is 48, so pitch is derived
  per-group from each sheet's own measured anchor — consistent with the
  48px system across the whole set.
- Palette law: each group (`undercut-agent`, desk's own group, tiles' own
  group, window's own group) builds its palette from only its own region
  votes — confirmed by reading `rectify.py`'s `main()`, which groups
  `m['regions']` by `r.get('group', ...)` before calling
  `build_shared_palette` once per group, never across groups.
- Carries round 27/28's tool-level palette-starvation fix (this branch,
  commits 3071ab5/0298b16): `build_shared_palette`'s frequency-cut
  `palette_size` and the `edge_hue_tol` second gate, both already present
  in `rectify.py` at the commit these sprites were rectified from.

## NOT yet covered (disclosed gap, not silently dropped)

The mission body's full prop list also names a **CRT monitor** and a **wall
monitor** — no manifest exists yet for either (the 4 manifests here predate
this mission and were written for the old composed-scene demo, which didn't
need those two as separate sprites). Two more manifests + regions, same
process, is the natural next round.

The agent's face/hair still reads softer than the reference sheets at this
native pixel count (round 28's own disclosed gap, `frames.json`'s
`round28Fixes.stillOpen` on the office-sample-scene branch) — a precision
gap, not a palette-law violation; the critic's own call per this mission's
Acceptance.
