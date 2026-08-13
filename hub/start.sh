#!/bin/sh
# Start wrapper for hosts that inject the listen address as IP/PORT env vars
# (common on shared Node hosting). Point the host's site command at this file:
#   sh /path/to/bureau/hub/start.sh
# Secrets (BUREAU_TOKEN, BUREAU_PUBLIC_URL, DISCORD_WEBHOOK_URL) belong in the
# host's environment configuration, never in the repo.
cd "$(dirname "$0")"
export HOST="${IP:-::}"
exec node server.js
