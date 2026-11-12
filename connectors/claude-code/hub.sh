#!/bin/sh
# hub.sh: one authenticated call to the Bureau hub. Apache-2.0.
# The consul convention's door: allowlisting this script keeps local agent
# sessions promptless without opening generic curl.
#
# Usage: hub.sh METHOD PATH [JSON_BODY]
#   hub.sh GET  /api/state
#   hub.sh POST /api/tasks '{"title":"...","project":"bureau"}'
# Env: BUREAU_URL, or the first line of BUREAU_URL_FILE (default ~/.bureau-url).
# The token, first found wins:
# 1. the sign-in from `bureau login` (../cli/bureau.js, or BUREAU_CLI), for this
#    hub and BUREAU_AGENT (default consul), refreshed when it is near expiry;
# 2. BUREAU_TOKEN_FILE, when you set it: naming a file is a choice, so it beats
#    the older Keychain item;
# 3. on a Mac, the Keychain item with service BUREAU_KEYCHAIN_SERVICE (default
#    bureau-hub) and account BUREAU_AGENT (default consul);
# 4. ~/.bureau-token.
# The same order as context-hook.js. Store a token for 3 once with: security add-generic-password -s bureau-hub -a consul -w
# (it asks for the token, so it never lands in your shell history).
# No default hub: a token sent to someone else's hub by mistake is a leak.
set -e
B="${BUREAU_URL:-}"
U="${BUREAU_URL_FILE:-$HOME/.bureau-url}"
# tr -d '\r': a file saved by Notepad ends its lines with \r\n
[ -z "$B" ] && [ -f "$U" ] && B=$(head -n 1 "$U" | tr -d '\r')
if [ -z "$B" ]; then
  echo "hub.sh: no hub address. Set BUREAU_URL, or put it in $U (e.g. http://localhost:8100)." >&2
  exit 1
fi
T=""
# Captured, so stdout is a pipe and `bureau token` agrees to write; never echoed.
C="${BUREAU_CLI:-$(dirname "$0")/../cli/bureau.js}"
if [ -f "$C" ] && command -v node >/dev/null 2>&1; then
  T=$(node "$C" token --hub "$B" 2>/dev/null || true)
fi
if [ -z "$T" ] && [ -n "${BUREAU_TOKEN_FILE:-}" ]; then
  if [ ! -f "$BUREAU_TOKEN_FILE" ]; then
    echo "hub.sh: BUREAU_TOKEN_FILE is set but $BUREAU_TOKEN_FILE does not exist." >&2
    exit 1
  fi
  T=$(tr -d '\r' < "$BUREAU_TOKEN_FILE")
fi
if [ -z "$T" ] && command -v security >/dev/null 2>&1; then
  T=$(security find-generic-password -s "${BUREAU_KEYCHAIN_SERVICE:-bureau-hub}" -a "${BUREAU_AGENT:-consul}" -w 2>/dev/null || true)
fi
if [ -z "$T" ] && [ -f "$HOME/.bureau-token" ]; then
  T=$(tr -d '\r' < "$HOME/.bureau-token")
fi
if [ -z "$T" ]; then
  echo "hub.sh: no token. Run: node $(dirname "$0")/../cli/bureau.js login --hub $B" >&2
  exit 1
fi
M="$1"; P="$2"; D="${3:-}"
if [ -n "$D" ]; then
  curl -s -m 15 -X "$M" "$B$P" -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "$D"
else
  curl -s -m 15 -X "$M" "$B$P" -H "Authorization: Bearer $T"
fi
