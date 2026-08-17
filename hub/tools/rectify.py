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
#                     etc.) are exempted from reduction and kept exact. A
#                     second, lower-saturation minority-hue pass (t-141) also
#                     preserves any hue that keeps a small but real presence
#                     across the group even when no single shade of it is
#                     frequent enough alone — the fix for the blue-face
#                     defect, where a skin ramp's several true shades each
#                     lost to the flat top-N frequency cutoff individually.
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
#   "edge_hue_tolerance": 40,                // (round 27) an edge cell's DECONTAMINATED color is still checked for the key's own hue signature (min(R,B)-G, see magenta_hue_score) — decontamination is a linear approximation and can leave a residual tint on isolated cells; one that scores above this is dropped to fully transparent rather than shipped tinted. Default 40 is calibrated against this atlas's committed sprites (real content <=28, prior defects 62-92); tune per-sheet only with evidence, same as the other tolerances.
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
import colorsys
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


def magenta_hue_score(rgb, bg_color):
    # How strongly a color still carries the KEY's own hue (not just its
    # brightness/distance) — the key is near-pure magenta (R and B both far
    # above G), so this is min(R,B) - G. Distance-to-background (color_dist)
    # and hue score measure different things: a dark, near-black pixel can
    # sit far from the key in Euclidean distance (safe by that test) while a
    # bright, desaturated one can be hue-clean but numerically close. Round
    # 26's critic pass found isolated edge-band pixels that clear outer_tol
    # (so cell_vote_grid's linear decontamination fires and ships them) but
    # still read as visibly magenta-tinted after decontamination — the
    # per-cell alpha_frac (itself only an approximation of true alpha, since
    # it comes from a single scalar distance) understates the real blend
    # fraction, so solving for fg leaves a residual tint. This score is a
    # bg-agnostic gate for that residue, independent of build_shared_palette's
    # existing Euclidean-distance safety net (which catches a different
    # failure mode: opaque interior votes that drifted back toward the key
    # through bucket-averaging, see its own comment).
    r, g, b = rgb
    bg_r, bg_g, bg_b = bg_color
    if min(bg_r, bg_b) - bg_g <= 0:
        return 0  # background isn't magenta-hued (custom key); this net doesn't apply
    return min(r, b) - g


def cell_vote_grid(img, region, pitch, dx, dy, bg_color, inner_tol, outer_tol, edge_hue_tol=40):
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
    #     Hue safety net (round 27): even after decontamination, a handful of
    #     isolated edge cells can still carry the key's own magenta hue
    #     signature (see magenta_hue_score) — the round-26 critic pass found
    #     4 such pixels atlas-wide (all in the edge band, all isolated single
    #     cells at a hard alpha-0/alpha-255 boundary), none caught by the
    #     existing Euclidean-distance checks. A cell whose decontaminated
    #     color still scores above edge_hue_tol is dropped to fully
    #     transparent instead: the linear unmix has already shown itself
    #     unreliable for this cell (that's exactly what the residual hue
    #     means), and the sprite's real edge is carried by the next cell in,
    #     which is untouched — so there is nothing to reconstruct, only a
    #     wrong-colored pixel to not ship. 40 is calibrated against this
    #     atlas's own committed sprites: every legitimate opaque or edge
    #     pixel scores <=28 (measured atlas-wide, see t-59 round-27 log),
    #     the 4 defects score 62-92 — a wide, clean margin either side.
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
                fg = (np.array(col, dtype=np.float64) - (1 - frac) * bg_arr) / max(frac, 1e-6)
                fg = np.clip(fg, 0, 255)
                fg_tuple = tuple(int(round(v)) for v in fg)
                if magenta_hue_score(fg_tuple, bg_color) > edge_hue_tol:
                    alphas[r][c] = 0
                    colors[r][c] = col
                else:
                    alphas[r][c] = int(round(255 * frac))
                    colors[r][c] = fg_tuple
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


def hsv_value(rgb):
    return max(rgb) / 255.0


def build_shared_palette(all_votes, palette_size, accent_sat_min, accent_area_frac, bg_color, outer_tol,
                          minority_hue_min_saturation=0.28, minority_hue_cap=8,
                          minority_hue_min_count_frac=0.0015, minority_hue_min_value=0.25):
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
    base_all = base
    base = base_all[:palette_size]
    kept_colors = [c for c, _ in base] + accents

    # Minority-hue preservation (t-141, the blue-face root cause): a small,
    # real material — a face's skin, say — isn't ONE color, it has its own
    # shading ramp (highlight/mid/shadow), so its votes land in several
    # buckets, each individually too rare to survive the flat top-N cutoff
    # above even though the material as a whole is a reliable, repeated
    # presence across the group's frames. That is exactly THE PALETTE LAW's
    # "collapses minority hues into the ambient color" failure mode, and it
    # is distinct from the accent mechanism above (which is gated on HIGH
    # saturation + a tiny area cap, meant for status-light-style highlights,
    # not a whole shaded material). Fix: cluster the leftover buckets by hue
    # (skip near-achromatic ones — that's the large flat fabric/material
    # fields the frequency cutoff already handles correctly), and where a
    # hue cluster's cumulative presence clears a small floor and no already-
    # kept color sits near its hue, keep that cluster's single highest-count
    # bucket verbatim (never a synthesized average, so the shipped color is
    # always one truly observed on the sheet). Capped and floored so this
    # stays a small, deliberate top-up, not a second uncapped palette.
    def hue_of(c):
        r, g, b = (v / 255.0 for v in c)
        return colorsys.rgb_to_hsv(r, g, b)[0]

    def hue_dist(h1, h2):
        d = abs(h1 - h2) % 1.0
        return min(d, 1.0 - d)

    # A value (brightness) floor matters as much as the saturation one: HSV
    # hue is numerically unstable near-black (a couple JPEG-noise units of
    # channel difference on a near-zero pixel swings "hue" wildly even
    # though the pixel reads as neutral shadow/outline, not a color), so
    # without it a dark, hue-coincidental outline bucket can silently absorb
    # a real minority material into its own (wrong, dark) cluster rather
    # than the material getting its own — exactly what happened to skin
    # tones before this floor was added (t-141 round 1: a near-black bucket
    # at hue~0.03 swallowed the actual skin-hue cluster).
    # Hue alone is not enough to tell materials apart: a dark wood/desk
    # shadow and a bright skin highlight can share near-identical hue while
    # obviously being different materials at a glance — value (brightness)
    # is what actually separates them, so both dimensions must be close
    # for two buckets to join the same cluster. Without this, a higher-
    # count but WRONG-material bucket earns the cluster's "best" slot and
    # a minority material several distinct-but-hue-adjacent shades of it,
    # like a shaded skin ramp, is spoken for by a color that was never
    # actually skin (t-141 round 2: a desk-brown bucket outranked and
    # absorbed every skin bucket sharing its hue).
    HUE_BIN = 1 / 24  # 15 degrees
    VALUE_BIN = 0.22
    kept_hues = [(hue_of(c), hsv_value(c)) for c in kept_colors if hsv_saturation(c) >= 0.15]
    leftover = [(c, cnt, hue_of(c), hsv_value(c)) for c, cnt in base_all[palette_size:]
                if hsv_saturation(c) >= minority_hue_min_saturation and hsv_value(c) >= minority_hue_min_value]
    clusters = []  # frequency-ordered already (leftover inherits base_all's order) -> deterministic
    for c, cnt, h, v in leftover:
        target = next((cl for cl in clusters
                        if hue_dist(cl['hue'], h) <= HUE_BIN and abs(cl['value'] - v) <= VALUE_BIN), None)
        if target is None:
            clusters.append({'hue': h, 'value': v, 'count': cnt, 'best': (c, cnt)})
        else:
            target['count'] += cnt
            if cnt > target['best'][1]:
                target['best'] = (c, cnt)

    minority_additions = []
    for cl in clusters:
        if len(minority_additions) >= minority_hue_cap:
            break
        if cl['count'] / total < minority_hue_min_count_frac:
            continue
        if any(hue_dist(cl['hue'], kh) <= HUE_BIN and abs(kv - cl['value']) <= VALUE_BIN for kh, kv in kept_hues):
            continue  # a nearby hue+value is already represented in base/accents
        minority_additions.append(cl['best'][0])
        kept_hues.append((cl['hue'], cl['value']))

    palette = kept_colors + minority_additions
    return palette, rejected, minority_additions


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
    edge_hue_tol = m.get('edge_hue_tolerance', 40)
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
            colors, alphas, score, n_cols, n_rows = cell_vote_grid(img, box, pitch, dx, dy, bg, inner_tol, outer_tol, edge_hue_tol)
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

        palette, rejected, minority_additions = build_shared_palette(
            list(vote_counts.items()),
            m.get('palette_size', 28),
            m.get('accent_saturation_min', 0.5),
            m.get('accent_max_area_frac', 0.01),
            bg, outer_tol,
            m.get('minority_hue_min_saturation', 0.28),
            m.get('minority_hue_cap', 8),
            m.get('minority_hue_min_count_frac', 0.0015),
            m.get('minority_hue_min_value', 0.25),
        )
        if rejected:
            print(f'  [{group_name}] rejected {len(rejected)} key-adjacent palette candidate(s): {rejected}')
        if minority_additions:
            print(f'  [{group_name}] preserved {len(minority_additions)} minority-hue color(s): {minority_additions}')

        report['groups'][group_name] = {
            'palette': [list(p) for p in palette],
            'rejected_key_adjacent_candidates': [list(p) for p in rejected],
            'minority_hue_preserved': [list(p) for p in minority_additions],
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
