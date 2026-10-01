#!/bin/sh
# Start wrapper for hosts that inject the listen address as IP/PORT env vars
# (common on shared Node hosting). Point the host's site command at this file:
#   sh /path/to/bureau/hub/start.sh
# Secrets (BUREAU_TOKEN, BUREAU_PUBLIC_URL, DISCORD_WEBHOOK_URL) belong in the
# host's environment configuration, never in the repo.
cd "$(dirname "$0")" || exit 1

# The host's IP, if it injects one, before .env can touch it.
host_ip=${IP-}

# Load ./.env if present (KEY=value lines). It only fills variables the host
# left unset: any key the host already set keeps the host's value.
if [ -f .env ]; then
  keep=
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line#"${line%%[![:space:]]*}"}
    line=${line#export }
    key=${line%%=*}
    [ "$key" = "$line" ] && continue
    case $key in ''|[0-9]*|*[!A-Za-z0-9_]*) continue ;; esac
    eval "isset=\${$key+1}"
    if [ -n "$isset" ]; then
      eval "bureau_keep_$key=\$$key"
      keep="$keep $key"
    fi
  done < .env
  set -a; . ./.env; set +a
  for key in $keep; do
    eval "$key=\$bureau_keep_$key"
    unset "bureau_keep_$key"
  done
fi

# Listen address: the host's IP wins, then HOST (host or .env), then IP from
# .env, then :: (all interfaces, IPv6 and IPv4).
if [ -n "$host_ip" ]; then
  HOST=$host_ip
elif [ -z "${HOST-}" ]; then
  HOST=${IP:-::}
fi
export HOST
exec node server.js
