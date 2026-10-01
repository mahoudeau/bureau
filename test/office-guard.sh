#!/usr/bin/env bash
# Office regression guard: the office-shots run without screenshots. At
# every phase, in every view (mini included), the office's test mode
# reports anything drawn outside the 384x216 canvas and any pixel that is
# not one of the palette's 4 shades. Exits 1 on a violation.
# Needs a scratch hub (never the live one), from the repo root:
#   PORT=4714 BUREAU_TOKEN=demo BUREAU_DATA_DIR=/tmp/office-guard/data BUREAU_BRAIN_DIR=/tmp/office-guard/brain node hub/server.js
# Then: ./test/office-guard.sh   (BASE, TOKEN, PLAYWRIGHT, CHROMIUM override)
set -eu
export BASE="${BASE:-http://localhost:4714}"
export TOKEN="${TOKEN:-demo}"
export SHOTS=0
exec node "$(dirname "$0")/office-shots.js"
