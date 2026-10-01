#!/bin/sh
# hub.sh: one authenticated call to the Bureau hub. Apache-2.0.
# The consul convention's door: allowlisting this script keeps local agent
# sessions promptless without opening generic curl.
#
# Usage: hub.sh METHOD PATH [JSON_BODY]
#   hub.sh GET  /api/state
#   hub.sh POST /api/tasks '{"title":"...","project":"bureau"}'
# Env: BUREAU_URL, or the first line of BUREAU_URL_FILE (default ~/.bureau-url),
#      BUREAU_TOKEN_FILE (default ~/.bureau-token)
# No default hub: a token sent to someone else's hub by mistake is a leak.
set -e
B="${BUREAU_URL:-}"
U="${BUREAU_URL_FILE:-$HOME/.bureau-url}"
[ -z "$B" ] && [ -f "$U" ] && B=$(head -n 1 "$U")
if [ -z "$B" ]; then
  echo "hub.sh: no hub address. Set BUREAU_URL, or put it in $U (e.g. http://localhost:8100)." >&2
  exit 1
fi
T=$(cat "${BUREAU_TOKEN_FILE:-$HOME/.bureau-token}")
M="$1"; P="$2"; D="${3:-}"
if [ -n "$D" ]; then
  curl -s -m 15 -X "$M" "$B$P" -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "$D"
else
  curl -s -m 15 -X "$M" "$B$P" -H "Authorization: Bearer $T"
fi
