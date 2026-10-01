#!/usr/bin/env bash
# Office screenshots against a scratch hub (never the live one).
# Start one first, from the repo root:
#   PORT=4714 BUREAU_TOKEN=demo BUREAU_DATA_DIR=/tmp/office-shots/data BUREAU_BRAIN_DIR=/tmp/office-shots/brain node hub/server.js
# Then: ./test/office-shots.sh   (BASE, TOKEN, OUT, PLAYWRIGHT, CHROMIUM, DPR override)
set -eu
export BASE="${BASE:-http://localhost:4714}"
export TOKEN="${TOKEN:-demo}"
export OUT="${OUT:-/tmp/office-shots/$(date +%Y%m%d-%H%M%S)}"
exec node "$(dirname "$0")/office-shots.js"
