#!/bin/sh
# Start wrapper for hosts whose site command is a shell line (common on shared
# Node hosting). Point the host's site command at this file:
#   sh /path/to/bureau/hub/start.sh
# The hub itself loads ./.env and maps a host-injected IP to its listen
# address (lib/env.js), so this only moves into the hub folder and starts it.
# `node server.js` does the same on any OS.
# Secrets (BUREAU_TOKEN, BUREAU_PUBLIC_URL, DISCORD_WEBHOOK_URL) belong in the
# host's environment configuration, never in the repo.
cd "$(dirname "$0")" || exit 1
exec node server.js
