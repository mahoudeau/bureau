# Office stage-1 sprite set (t-141)

Every PNG in `sprites/` was produced by the shared rectifier (`hub/tools/rectify.py`)
against a manifest in `manifests/`, one manifest per source sheet. Each manifest run
also writes a `rectify-report.json` (copied here as `reports/report-<sheet>.json`)
recording the exact source box, computed pitch, palette, and sha256 for every sprite —
that report is the mechanical proof: re-run the manifest against the same downloaded
sheet and the output PNG must hash identically (see each manifest's own `_comment` for
the re-run command).

All source sheets live in the brain under `projects/bureau/references/office/`, not in
this repo (`THE LAW`: boss-generated sheets are owned source material, extracted from,
never redrawn, never shipped raw).

## Sprite → source citation

| Sprite | Source sheet | Region (x,y,w,h) | Group (palette) | Pitch | Output size |
|---|---|---|---|---|---|
| `idle-anchor.png` | `cast/sheet-agent-undercut-typing.jpg` | 24,22,150,362 | agent | 7.4167 | 20×48 |
| `typing-0.png` | `cast/sheet-agent-undercut-typing.jpg` | 190,22,290,362 | agent | 7.4167 | 38×48 |
| `typing-1.png` | `cast/sheet-agent-undercut-typing.jpg` | 496,22,292,362 | agent | 7.4167 | 39×48 |
| `typing-2.png` | `cast/sheet-agent-undercut-typing.jpg` | 804,22,285,362 | agent | 7.4167 | 37×48 |
| `typing-3.png` | `cast/sheet-agent-undercut-typing.jpg` | 1105,22,284,362 | agent | 7.4167 | 38×48 |
| `desk-tidy.png` | `props/sheet-desks-workstations-v2.jpg` | 1035,254,350,201 | desk | 9.2708 | 37×20 |
| `chair.png` | `props/sheet-desks-workstations-v2.jpg` | 55,519,159,239 | chair | 9.2708 | 17×25 |
| `crt-monitor.png` | `props/sheet-desks-workstations-v2.jpg` | 650,12,350,108 | crt-monitor | 9.2708 | 37×11 |
| `wall-monitor.png` | `props/sheet-lighting-states-v2.jpg` | 1078,205,147,170 | wall-monitor | 10.0833 | 13×16 |
| `floor-wood.png` | `props/sheet-tiles-surfaces-v2.jpg` | 270,20,265,220 | floor | 4.7917 | 55×45 |
| `wall-cracked.png` | `props/sheet-tiles-surfaces-v2.jpg` | 1130,20,255,220 | wall | 4.7917 | 52×45 |

Every pitch is independently derived from the *same* 48px-logical anchor figure
(present on every sheet, same generation batch), so relative scale between sprites
from different sheets is consistent by construction — that is what the pitch column
proves per-sheet, and what makes the whole set comparable at composition time.

## Notes for the critic / stage 2

- **`agent` group (idle + all 4 typing frames) shares one palette**, built from
  all five regions' votes together, per THE PALETTE LAW — this is what keeps the
  character's colors flicker-free frame to frame. `desk`, `chair`, and `crt-monitor`
  each get their own independent palette (three separate subjects, three source
  regions in the same sheet, still never merged).
- **`crt-monitor.png`** is cropped to the monitor+keyboard+mouse unit only, not the
  desk it's drawn sitting on in the source (the desk ships separately as
  `desk-tidy.png`, for stage 2 to compose). The unit touches the desk surface with no
  magenta gap in the source art, so a thin sliver of desk-colored pixels survives
  along the bottom edge — minimized by the crop box, not eliminated; flag if the
  critic reads it as silhouette contamination.
- **`typing-*.png`** ship the full seated-at-desk-with-monitor illustration as one
  sprite (character + this pose's own desk/monitor/lamp), not character-only. An
  earlier round tried cropping the character out from the furniture to fight a palette
  bug (see below) and made the frames compositionally useless (arms cut off mid-reach);
  reverted once the actual bug was fixed at the tool level. Stage 2 should treat
  `typing-*` as a self-contained "agent at a workstation" pose, not something to
  layer piecemeal onto the separately-shipped `desk-tidy`/`chair`/`crt-monitor`.
- **The blue-face defect, root-caused this round.** `idle-anchor.png`'s face
  rendered fully dark/navy on the first pass (THE LAW's named failure mode:
  "collapses minority hues into the ambient color") even though the group palette was
  already correctly scoped to the agent alone. Root cause was inside
  `build_shared_palette` itself, not this manifest: skin appears in several distinct
  true shades (a real shading ramp — highlight/mid/shadow), each individually too rare
  to survive the flat top-N frequency cutoff that selects the base palette, so every
  skin pixel snapped to the nearest *surviving* (non-skin) color instead. Fixed at the
  tool level in `hub/tools/rectify.py` (see its own changelog comment on
  `build_shared_palette`): a new minority-hue preservation pass clusters leftover
  buckets by hue **and value together** (value alone would let a low-value
  hue-coincidental bucket — e.g. a dark desk-wood shadow sharing skin's hue — win the
  cluster and mask the real minority material) and keeps one verbatim (never
  synthesized) representative per surviving cluster. Verified: skin now renders
  correctly on `idle-anchor` and all four `typing-*` frames: see
  `deliverables/t-141-current.png` for the current render. Re-verified no regression
  on `desk`/`chair`/`crt-monitor`/tiles/`wall-monitor` (same or +1 palette entries,
  zero key-adjacent pixels atlas-wide, byte-identical on repeat runs — determinism
  intact).
- **Mechanical floors checked**: zero key-adjacent pixels across the whole set
  (scanned every shipped PNG, Euclidean distance *and* the magenta-hue-score net, see
  `hub/tools/rectify.py`'s own comments); byte-identical output on a second run of
  every manifest (determinism); every sprite's scale traces to the same 48px agent
  anchor on its own sheet.
