#!/bin/sh
# hub.sh: one authenticated call to the Bureau hub. Apache-2.0.
# The consul convention's door: allowlisting this script keeps local agent
# sessions promptless without opening generic curl.
#
# Usage: hub.sh METHOD PATH [JSON_BODY]
#   hub.sh GET  /api/state
#   hub.sh POST /api/tasks '{"title":"...","project":"bureau"}'
# Env: BUREAU_URL (default https://bureau.mathieu.dev),
#      BUREAU_TOKEN_FILE (default ~/.bureau-token)
set -e
B="${BUREAU_URL:-https://bureau.mathieu.dev}"
T=$(cat "${BUREAU_TOKEN_FILE:-$HOME/.bureau-token}")
M="$1"; P="$2"; D="${3:-}"
if [ -n "$D" ]; then
  curl -s -m 15 -X "$M" "$B$P" -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "$D"
else
  curl -s -m 15 -X "$M" "$B$P" -H "Authorization: Bearer $T"
fi
