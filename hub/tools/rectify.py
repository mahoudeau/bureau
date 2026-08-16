#!/usr/bin/env python3
# rectify.py — Bureau office-art rectifier (t-54 engine outcome, boss ruling 2026-08-16).
#
# No generator output ships raw. Every office sprite passes through this tool:
# the generated sheet is a photo OF pixel art, and this script re-derives the
# true pixels on our own grid instead of shipping the photo's noise. Builders
# extract with it, the critic verifies with it, by running it again on the
# same cited region and diffing the output byte-for-byte. No private pipelines.
#
# Licensed Apache-2.0 (LICENSE-APACHE at the repo root), unlike the AGPL hub:
# this is a build-time art tool, meant to run anywhere the brain's reference
# sheets live, not part of the deployed hub server.
#
# Pipeline (docs cross-ref: projects/bureau/references/office/PROMPTS.md,
# "Rectification: from generator output to shipped sprite"):
#   1. Grid fit    — per-sheet pixel pitch, derived from a measured anchor
#                     figure's height (never autocorrelation guesswork: the
#                     anchor is exact and every sheet carries one), plus a
#                     deterministic phase search so cell boundaries land on
#                     the source art's own edges instead of straddling them.
#   2. Cell vote   — each output pixel is the dominant (mode) color among the
#                     source pixels its grid cell covers. Whole-cell decision,
#                     never a resample: this is what erases JPEG ringing and
#                     anti-aliasing by construction.
#   3. Shared palette — every region in a "group" (e.g. one character's whole
#                     frame set) is cell-voted first, THEN all of their votes
#                     are palette-reduced TOGETHER, so the same true color
#                     always snaps to the same output value in every frame
#                     (the t-59 round-21 lesson: never quantize per-frame).
#                     Small, rare, highly-saturated colors (status lights,
#                     etc.) are exempted from reduction and kept exact.
#   4. Key to alpha — pixels near the sheet's magenta background become
#                     transparent.
#   5. The scaler  — pitch IS the scaling knob. Because pitch is derived from
#                     the sheet's own 48px-tall anchor figure, cell-voting at
#                     that pitch produces correctly-scaled output directly;
#                     there is no separate resize step, so pixel art is never
#                     post-scaled (which would blur or reintroduce aliasing).
#   6. Output      — true native-resolution transparent PNG, 1 logical pixel
#                     = 1 file pixel. Upscaling (nearest-neighbor only) is a
#                     render-time concern, not baked into the asset.
#
# Determinism: no randomness anywhere (palette reduction is frequency-sorted
# greedy bucketing, not k-means; phase search is an exhaustive deterministic
# scan). Same manifest + same source bytes -> byte-identical PNG output,
# every time — this is what makes "the critic re-runs the rectifier on the
# cited region and checks for a byte-identical sprite" a mechanical check
# instead of a matter of taste.
#
# Usage:
#   python3 rectify.py MANIFEST.json --out-dir OUT/
#
# Requires: pillow, numpy (pip install pillow numpy). Not zero-dependency —
# deliberate: this is an offline build tool an agent session runs locally
# against checked-out reference sheets, not code the hub server ships or
# executes at request time. See docs/protocol.md's zero-dependency clause,
# which scopes to the hub core.
#
# MANIFEST.json shape:
# {
#   "sheet": "relative/path/to/sheet.jpg",
#   "background_key": [255, 0, 255],       // magenta, the sheets' own key
#   "key_tolerance": 60,                    // OUTER band edge: channel-distance beyond which a cell is fully opaque
#   "key_inner_tolerance": 21,               // INNER band edge (default: 0.35 * key_tolerance): fully background within this distance. Between the two, alpha ramps and color is decontaminated — this is what kills fringe halos that a single hard threshold can't.
#   "anchor_region": [x, y, w, h],          // rough box containing the sheet's
#                                            // own 48px-tall anchor figure —
#                                            // padding is fine, tight-cropped
#                                            // automatically from non-background pixels
#   "anchor_logical_height": 48,
#   "palette_size": 28,
#   "accent_saturation_min": 0.5,
#   "accent_max_area_frac": 0.01,
#   "regions": [
#     {"name": "typing-0", "x": .., "y": .., "w": .., "h": .., "group": "undercut-agent"},
#     ...
#   ]
# }
#
# One manifest = one sheet = one pitch (one generation scale). A region's
# output size is never specified directly — it falls out of dividing its
# source pixel box by the sheet's own pitch, which is exactly "every prop's
# target = its ratio to the anchor figure standing in its sheet."

import sys
import json
import hashlib
from pathlib import Path

from PIL import Image
import numpy as np
from scipy import ndimage


def load_rgb(path):
    im = Image.open(path).convert('RGB')
    return np.asarray(im, dtype=np.int16)  # signed so distance math doesn't wrap


def color_dist(arr, color):
    # Chebyshev-ish combined channel distance, cheap and stable.
    d = arr - np.array(color, dtype=np.int16)
    return np.sqrt((d.astype(np.int32) ** 2).sum(axis=-1))


def measure_anchor_height(img, box, bg_color, bg_tol):
    # Deliberately robust to a loose/generous anchor_region box (a neighbor
    # row's stray feet or a divider sliver touching the box edge should not
    # skew the measurement): label connected components of non-background
    # pixels and measure the LARGEST one's bounding box, rather than the
    # naive bbox of every non-background pixel in the box (which merges in
    # anything that happens to touch the same box, even barely).
    x, y, w, h = box
    crop = img[y:y + h, x:x + w]
    dist = color_dist(crop, bg_color)
    mask = dist > bg_tol
    labeled, n = ndimage.label(mask)
    if n == 0:
        raise SystemExit(f'anchor_region {box}: no non-background pixels found')
    sizes = ndimage.sum(mask, labeled, range(1, n + 1))
    biggest = int(np.argmax(sizes)) + 1
    rows = np.where((labeled == biggest).any(axis=1))[0]
    return int(rows.max() - rows.min() + 1), int(y + rows.min())


def mode_color(pixels):
    # pixels: (N,3) int array for one cell. Deterministic dominant-color vote:
    # coarse-quantize to merge JPEG-noise near-duplicates, count buckets, take
    # the most frequent (ties broken by lowest bucket tuple — deterministic),
    # then report the TRUE average color of the pixels that fell in that
    # bucket (not the bucket's own quantized center) so the vote stays close
    # to the source, not to an arbitrary grid.
    if pixels.shape[0] == 0:
        return None
    q = (pixels // 16) * 16
    keys = q[:, 0].astype(np.int64) * 65536 + q[:, 1].astype(np.int64) * 256 + q[:, 2].astype(np.int64)
    uniq, inverse, counts = np.unique(keys, return_inverse=True, return_counts=True)
    best_count = counts.max()
    # deterministic tie-break: smallest bucket key among those at max count
    winners = uniq[counts == best_count]
    winner_key = winners.min()
    sel = pixels[keys == winner_key]
    avg = sel.mean(axis=0)
    return tuple(int(round(c)) for c in avg)


def cell_vote_grid(img, region, pitch, dx, dy, bg_color, inner_tol, outer_tol):
    # Soft chroma-key with decontamination, not a hard threshold. A cell
    # voted color's distance to the background color puts it in one of
    # three bands:
    #   dist <= inner_tol            -> fully background (alpha 0)
    #   dist >= outer_tol            -> fully foreground (alpha 255)
    #   inner_tol < dist < outer_tol -> an EDGE cell: the source pixel is a
    #     genuine anti-aliased blend of foreground and background (this is
    #     exactly what a hard single threshold gets wrong — it either kept
    #     these as opaque near-magenta ["fringe halo"] or discarded them as
    #     background [a hard, aliased edge]). Alpha ramps linearly across
    #     the band, and the color is DECONTAMINATED: solve
    #     observed = alpha_frac*fg + (1-alpha_frac)*bg for fg, so the
    #     magenta tint mixed into the edge blend is removed rather than
    #     shipped as part of the sprite's own color.
    x, y, w, h = region
    n_cols = int((w - dx) // pitch)
    n_rows = int((h - dy) // pitch)
    colors = [[None] * n_cols for _ in range(n_rows)]
    alphas = [[0] * n_cols for _ in range(n_rows)]
    agree_sum = 0.0
    agree_n = 0
    bg_arr = np.array(bg_color, dtype=np.float64)
    for r in range(n_rows):
        cy0 = y + dy + int(round(r * pitch))
        cy1 = y + dy + int(round((r + 1) * pitch))
        for c in range(n_cols):
            cx0 = x + dx + int(round(c * pitch))
            cx1 = x + dx + int(round((c + 1) * pitch))
            cell = img[cy0:cy1, cx0:cx1].reshape(-1, 3)
            if cell.shape[0] == 0:
                continue
            col = mode_color(cell)
            d = float(color_dist(np.array([col]), bg_color)[0])
            if d <= inner_tol:
                alphas[r][c] = 0
                colors[r][c] = col
            elif d >= outer_tol:
                alphas[r][c] = 255
                colors[r][c] = col
            else:
                frac = (d - inner_tol) / (outer_tol - inner_tol)
                alphas[r][c] = int(round(255 * frac))
                fg = (np.array(col, dtype=np.float64) - (1 - frac) * bg_arr) / max(frac, 1e-6)
                fg = np.clip(fg, 0, 255)
                colors[r][c] = tuple(int(round(v)) for v in fg)
            # agreement score for phase search: fraction of the cell matching
            # the coarse bucket that won the vote (crisp cells -> high score)
            q = (cell // 16) * 16
            keys = q[:, 0].astype(np.int64) * 65536 + q[:, 1].astype(np.int64) * 256 + q[:, 2].astype(np.int64)
            _, counts = np.unique(keys, return_counts=True)
            agree_sum += counts.max() / cell.shape[0]
            agree_n += 1
    score = agree_sum / agree_n if agree_n else 0.0
    return colors, alphas, score, n_cols, n_rows


def best_phase(img, region, pitch, bg_color, inner_tol, outer_tol, steps=6):
    # Exhaustive, deterministic search over a small grid of candidate phase
    # offsets (fractions of one pitch). Picks the offset whose cell-voted
    # grid has the highest average per-cell color agreement — the proxy for
    # "cell boundaries land on the art's real edges" per the doc's grid-fit
    # step. steps=6 keeps this fast; determinism doesn't need finer.
    best = None
    for i in range(steps):
        dx = int(round(i * pitch / steps))
        for j in range(steps):
            dy = int(round(j * pitch / steps))
            _, _, score, n_cols, n_rows = cell_vote_grid(img, region, pitch, dx, dy, bg_color, inner_tol, outer_tol)
            if n_cols < 1 or n_rows < 1:
                continue
            key = (score, -dx, -dy)  # deterministic tie-break: prefer smaller offsets
            if best is None or key > best[0]:
                best = (key, dx, dy)
    if best is None:
        return 0, 0
    return best[1], best[2]


def hsv_saturation(rgb):
    r, g, b = [c / 255.0 for c in rgb]
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == 0:
        return 0.0
    return (mx - mn) / mx


def build_shared_palette(all_votes, palette_size, accent_sat_min, accent_area_frac, bg_color, outer_tol):
    # all_votes: list of (color, count) already-collected non-background cell
    # colors across every region in a group, count = how many cells voted it.
    total = sum(c for _, c in all_votes)
    # Coarse-bucket to merge near-duplicate votes (anti-aliasing / residual
    # noise the per-cell vote didn't already erase), frequency-sorted,
    # deterministic (Python sort is stable; ties broken by bucket key below).
    buckets = {}
    for color, count in all_votes:
        q = tuple((c // 12) * 12 for c in color)
        b = buckets.setdefault(q, {'count': 0, 'sum': [0, 0, 0]})
        b['count'] += count
        b['sum'][0] += color[0] * count
        b['sum'][1] += color[1] * count
        b['sum'][2] += color[2] * count
    ranked = sorted(buckets.items(), key=lambda kv: (-kv[1]['count'], kv[0]))

    accents = []
    base = []
    rejected = []
    for q, b in ranked:
        avg = tuple(round(b['sum'][i] / b['count']) for i in range(3))
        # Safety net, independent of how a bucket got here: every vote that
        # fed this bucket individually cleared outer_tol (only alpha==255
        # cells are ever counted, see main()), but bucket AVERAGING is a
        # convex combination — it can land closer to the background color
        # than any single vote that produced it (e.g. two genuine but
        # differently-shifted skin-highlight votes straddling the magenta
        # axis and averaging toward it). A palette entry that's drifted
        # back into key-adjacent territory is exactly what caused fringe-
        # colored blotches in round 23: reject it outright rather than let
        # snap_to_palette ever hand it out as a "safe" target.
        if color_dist(np.array([avg]), bg_color)[0] < outer_tol:
            rejected.append(avg)
            continue
        frac = b['count'] / total if total else 0
        sat = hsv_saturation(avg)
        if sat >= accent_sat_min and frac <= accent_area_frac:
            accents.append(avg)
        else:
            base.append((avg, b['count']))
    base = base[:palette_size]
    palette = [c for c, _ in base] + accents
    return palette, rejected


def snap_to_palette(color, palette):
    best_i, best_d = 0, None
    for i, p in enumerate(palette):
        d = sum((a - b) ** 2 for a, b in zip(color, p))
        if best_d is None or d < best_d or (d == best_d and i < best_i):
            best_d, best_i = d, i
    return palette[best_i]


def main():
    if len(sys.argv) < 2:
        print('usage: rectify.py MANIFEST.json --out-dir OUT/', file=sys.stderr)
        sys.exit(2)
    manifest_path = Path(sys.argv[1])
    out_dir = Path('rectified-out')
    if '--out-dir' in sys.argv:
        out_dir = Path(sys.argv[sys.argv.index('--out-dir') + 1])
    out_dir.mkdir(parents=True, exist_ok=True)

    m = json.loads(manifest_path.read_text())
    sheet_path = (manifest_path.parent / m['sheet']) if not Path(m['sheet']).is_absolute() else Path(m['sheet'])
    img = load_rgb(sheet_path)
    bg = tuple(m.get('background_key', [255, 0, 255]))
    # Two-band soft key (see cell_vote_grid's own comment): outer_tol is the
    # existing "key_tolerance" (fully foreground beyond this distance from
    # the background color); inner_tol defaults to a fraction of it (fully
    # background within this distance). The band between the two is where
    # real anti-aliased edge pixels live — ramped alpha + decontamination,
    # not a hard cutoff, is what actually kills fringe halos.
    outer_tol = m.get('key_tolerance', 60)
    inner_tol = m.get('key_inner_tolerance', outer_tol * 0.35)
    if 'anchor_source_px_height' in m:
        # Manual override (spec's "or manual parameter" alternative to
        # auto grid-fit) — for sheets where connected-component detection
        # bridges across a thin dark divider line into a neighboring
        # figure (e.g. two stacked anchor repeats with no true background
        # gap between them). Measured by eye against a ruler overlay.
        anchor_h_px = m['anchor_source_px_height']
    else:
        anchor_h_px, _ = measure_anchor_height(img, m['anchor_region'], bg, outer_tol)
    anchor_logical_h = m.get('anchor_logical_height', 48)
    pitch = anchor_h_px / anchor_logical_h

    groups = {}
    for r in m['regions']:
        groups.setdefault(r.get('group', 'default'), []).append(r)

    report = {
        'sheet': str(m['sheet']),
        'sheet_sha256': hashlib.sha256(sheet_path.read_bytes()).hexdigest(),
        'anchor_source_px_height': anchor_h_px,
        'anchor_logical_height': anchor_logical_h,
        'pitch': pitch,
        'groups': {},
    }

    for group_name, regions in groups.items():
        region_grids = {}
        vote_counts = {}
        for r in regions:
            box = (r['x'], r['y'], r['w'], r['h'])
            dx, dy = best_phase(img, box, pitch, bg, inner_tol, outer_tol)
            colors, alphas, score, n_cols, n_rows = cell_vote_grid(img, box, pitch, dx, dy, bg, inner_tol, outer_tol)
            region_grids[r['name']] = {
                'colors': colors, 'alphas': alphas, 'n_cols': n_cols, 'n_rows': n_rows,
                'dx': dx, 'dy': dy, 'score': score, 'box': box,
            }
            for row in range(n_rows):
                for col in range(n_cols):
                    # Only fully-opaque cells vote on the shared palette —
                    # partial-alpha edge cells are decontaminated estimates,
                    # noisier than an interior vote, and shouldn't skew what
                    # the palette snaps everything else to.
                    if alphas[row][col] != 255:
                        continue
                    c = colors[row][col]
                    vote_counts[c] = vote_counts.get(c, 0) + 1

        palette, rejected = build_shared_palette(
            list(vote_counts.items()),
            m.get('palette_size', 28),
            m.get('accent_saturation_min', 0.5),
            m.get('accent_max_area_frac', 0.01),
            bg, outer_tol,
        )
        if rejected:
            print(f'  [{group_name}] rejected {len(rejected)} key-adjacent palette candidate(s): {rejected}')

        report['groups'][group_name] = {
            'palette': [list(p) for p in palette],
            'rejected_key_adjacent_candidates': [list(p) for p in rejected],
            'regions': {},
        }

        for r in regions:
            g = region_grids[r['name']]
            n_cols, n_rows = g['n_cols'], g['n_rows']
            out = np.zeros((n_rows, n_cols, 4), dtype=np.uint8)
            for row in range(n_rows):
                for col in range(n_cols):
                    a = g['alphas'][row][col]
                    if a == 0:
                        continue
                    if a == 255:
                        # Fully opaque: snap to the shared palette as before.
                        out[row, col, 0:3] = snap_to_palette(g['colors'][row][col], palette)
                    else:
                        # Partial-alpha edge cell: ship the decontaminated
                        # color as-is, not palette-snapped — it's meant to
                        # blend toward transparency, and force-snapping it
                        # to a palette entry derived from opaque interior
                        # votes would just reintroduce a hard, wrong-colored
                        # edge under a different name.
                        out[row, col, 0:3] = g['colors'][row][col]
                    out[row, col, 3] = a
            im = Image.fromarray(out, mode='RGBA')
            out_path = out_dir / f'{r["name"]}.png'
            im.save(out_path, optimize=False)
            report['groups'][group_name]['regions'][r['name']] = {
                'w': n_cols, 'h': n_rows,
                'source_box': list(g['box']),
                'phase': [g['dx'], g['dy']],
                'grid_agreement': round(g['score'], 4),
                'file': out_path.name,
                'sha256': hashlib.sha256(out_path.read_bytes()).hexdigest(),
            }

    report_path = out_dir / 'rectify-report.json'
    report_path.write_text(json.dumps(report, indent=1))
    print(f'wrote {len(m["regions"])} sprites + report to {out_dir}')
    print(f'pitch = {pitch:.4f} (anchor {anchor_h_px}px -> {anchor_logical_h}px)')


if __name__ == '__main__':
    main()
