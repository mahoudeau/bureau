#!/bin/sh
# alwaysdata Node.js site command:  sh ~/www/getbureau.mathieu.dev/site/start.sh
#
# Secrets (WAITLIST_TOKEN, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET,
# GITHUB_TOKEN) go in the alwaysdata site Environment, never in these files.
# alwaysdata injects IP and PORT.
cd "$(dirname "$0")"

# Supervisor loop: alwaysdata does not relaunch a dead Node site on its own
# (the domain answers 502 until someone clicks Restart), so this does.
# Exit code 0 is a deliberate stop (panel restart, SIGTERM): respect it.
child=""
trap 'if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null; wait "$child" 2>/dev/null; fi; exit 0' TERM INT

# Node sizes its heap from the host's ram, not this account's quota, and
# gets killed at exit 137 when it grows past it. Cap it.
MAX_OLD_SPACE="${NODE_MAX_OLD_SPACE_MB:-256}"

# Crash-loop backoff: a run that stayed up a minute resets the delay;
# repeated fast deaths back off to a minute so the logs stay readable.
delay=3
while :; do
  started=$(date +%s)
  node --max-old-space-size="$MAX_OLD_SPACE" server.js &
  child=$!
  wait "$child"
  code=$?
  child=""
  [ "$code" -eq 0 ] && exit 0
  ran=$(( $(date +%s) - started ))
  if [ "$ran" -ge 60 ]; then
    delay=3
  else
    delay=$(( delay * 2 ))
    [ "$delay" -gt 60 ] && delay=60
  fi
  echo "start.sh: server.js exited with $code after ${ran}s, relaunching in ${delay}s" >&2
  sleep "$delay"
done
