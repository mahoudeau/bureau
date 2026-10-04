#!/bin/sh
# test/storage.sh: storage fails loud. Corrupt state refuses to boot, backups
# rotate, the lock keeps a second hub off the data dir, migrations keep a copy.
# Self-contained: starts its own scratch hubs, tears them down.
# Usage: ./test/storage.sh    (needs node + curl; uses ports 4711/4712)
#   STORAGE_TEST_DIR=/some/dir to keep the scratch files for a look afterwards.
set -u

PORT_A="${PORT_A:-4711}"
PORT_B="${PORT_B:-4712}"
TOKEN=storagetest
if [ -n "${STORAGE_TEST_DIR:-}" ]; then DIR="$STORAGE_TEST_DIR"; rm -rf "$DIR"; mkdir -p "$DIR"; KEEP=1
else DIR="$(mktemp -d)"; KEEP=0; fi
PASS=0; FAIL=0
# The hubs below skip a local hub/.env (its token, its webhook): a missing file instead
export BUREAU_ENV_FILE="$DIR/no.env"

check() { # label haystack needle
  if printf '%s' "$2" | grep -q -- "$3"; then PASS=$((PASS+1)); echo "  ok: $1";
  else FAIL=$((FAIL+1)); echo "  FAIL: $1 (wanted '$3' in: $(printf '%s' "$2" | head -c 300))"; fi
}
yes_if() { if [ "$1" ]; then echo yes; else echo no; fi; }

cd "$(dirname "$0")/.."

for port in "$PORT_A" "$PORT_B"; do
  pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  [ -n "$pid" ] && { echo "  (killing orphan pid $pid on :$port)"; kill $pid 2>/dev/null; }
done
cleanup() { kill ${HUB_A:-} ${HUB_B:-} ${HUB_C:-} 2>/dev/null; [ "$KEEP" = 1 ] || rm -rf "$DIR"; }
trap cleanup EXIT INT TERM

# start_hub <name> <port>: background hub on $DIR/<name>, 400ms backups, keep 3
start_hub() {
  env BUREAU_TOKEN=$TOKEN PORT="$2" HOST=127.0.0.1 BUREAU_DATA_DIR="$DIR/$1/data" BUREAU_BRAIN_DIR="$DIR/$1/brain" BUREAU_WORK_DIR="$DIR/$1/work" \
    BUREAU_BACKUP_INTERVAL_MS=400 BUREAU_BACKUP_KEEP=3 BUREAU_DAILY_KEEP=7 \
    node hub/server.js >>"$DIR/$1.log" 2>&1 &
  LAST_PID=$!
}
wait_up() { # port
  i=0; while [ $i -lt 50 ]; do
    curl -s -o /dev/null "http://127.0.0.1:$1/health" && return 0
    sleep 0.1; i=$((i+1))
  done; return 1
}
# boot_refused <name>: foreground boot that must exit on its own; prints "exit:<code>"
boot_refused() {
  start_hub "$1" "$PORT_B"; P=$LAST_PID
  i=0; while [ $i -lt 30 ] && kill -0 $P 2>/dev/null; do sleep 0.1; i=$((i+1)); done
  if kill -0 $P 2>/dev/null; then kill $P; wait $P 2>/dev/null; echo "exit:still-running"
  else wait $P; echo "exit:$?"; fi
}
api() { # port method path [json]
  if [ $# -gt 3 ]; then curl -s -X "$2" "http://127.0.0.1:$1$3" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$4"
  else curl -s -X "$2" "http://127.0.0.1:$1$3" -H "Authorization: Bearer $TOKEN"; fi
}

echo "1. fresh boot: liveness public, version and schema behind the token"
start_hub a "$PORT_A"; HUB_A=$LAST_PID
wait_up "$PORT_A"
check "/health answers without a token" "$(curl -s "http://127.0.0.1:$PORT_A/health")" '"ok": true'
check "/health keeps the version to itself" "$(curl -s "http://127.0.0.1:$PORT_A/health" | grep -c '"version"')" '^0$'
check "/api/health refuses without a token" "$(curl -s "http://127.0.0.1:$PORT_A/api/health")" 'unauthorized'
check "/api/health carries version and schema with the token" "$(api "$PORT_A" GET /api/health)" '"schema_version": 1'
api "$PORT_A" POST /api/tasks '{"title":"Backup canary mission"}' >/dev/null
# Wait for the debounced write rather than a fixed sleep (a slow CI runner lost that race)
for i in $(seq 1 30); do grep -q 'Backup canary mission' "$DIR/a/data/state.json" 2>/dev/null && break; sleep 0.1; done
check "state.json carries schema_version" "$(cat "$DIR/a/data/state.json")" '"schema_version": 1'
check "daily snapshot taken at boot" "$(ls "$DIR/a/data")" 'state.json.daily-'

echo "2. rolling backups rotate and cap"
sleep 2
LS=$(ls "$DIR/a/data")
check "bak.1 exists" "$LS" 'state.json.bak.1'
check "bak.3 exists" "$LS" 'state.json.bak.3'
check "bak.4 never kept (keep 3)" "$(yes_if "$(printf '%s' "$LS" | grep 'bak.4')")" 'no'
check "newest backup holds current state" "$(cat "$DIR/a/data/state.json.bak.1")" 'Backup canary mission'
check "one daily per day" "$(ls "$DIR/a/data" | grep -c 'daily-')" '^1$'

echo "3. the lock keeps a second hub off the same data dir"
check "lock file names the live pid" "$(cat "$DIR/a/data/hub.lock")" "^$HUB_A\$"
env BUREAU_TOKEN=$TOKEN PORT="$PORT_B" HOST=127.0.0.1 BUREAU_DATA_DIR="$DIR/a/data" BUREAU_BRAIN_DIR="$DIR/a/brain" \
  node hub/server.js >"$DIR/a2.log" 2>&1 &
HUB_B=$!
sleep 1
if kill -0 $HUB_B 2>/dev/null; then B_EXIT=still-running; kill $HUB_B; else wait $HUB_B; B_EXIT=$?; fi
HUB_B=
check "second hub exits non-zero" "exit:$B_EXIT" 'exit:1'
check "second hub says why" "$(cat "$DIR/a2.log")" 'owned by a live hub process'
check "first hub still serves" "$(curl -s "http://127.0.0.1:$PORT_A/health")" '"ok": true'

echo "4. shutdown flushes the last write and releases the lock"
api "$PORT_A" POST /api/tasks '{"title":"Written just before SIGTERM"}' >/dev/null
kill $HUB_A; wait $HUB_A 2>/dev/null; HUB_A=
check "write inside the debounce window survived" "$(cat "$DIR/a/data/state.json")" 'Written just before SIGTERM'
check "lock released" "$(yes_if "$(ls "$DIR/a/data" | grep hub.lock)")" 'no'

echo "5. a stale lock from a dead pid is taken over"
sh -c 'exit 0' & DEAD=$!; wait $DEAD
printf '%s' "$DEAD" > "$DIR/a/data/hub.lock"
start_hub a "$PORT_A"; HUB_A=$LAST_PID
wait_up "$PORT_A"
check "hub boots over a stale lock" "$(curl -s "http://127.0.0.1:$PORT_A/health")" '"ok": true'
check "stale takeover logged" "$(cat "$DIR/a.log")" "stale lock from dead pid $DEAD"
check "state intact after restart" "$(api "$PORT_A" GET /api/tasks)" 'Backup canary mission'
kill $HUB_A; wait $HUB_A 2>/dev/null; HUB_A=

echo "6. a corrupt state file refuses to boot and is kept"
mkdir -p "$DIR/c/data"
printf '{"tasks": [ {"id": "t-1", "title": "half a wri' > "$DIR/c/data/state.json"
check "boot refused with non-zero exit" "$(boot_refused c)" 'exit:1'
check "refusal says so" "$(cat "$DIR/c.log")" 'does not parse'
check "corrupt copy kept" "$(ls "$DIR/c/data")" 'state.json.corrupt-'
check "bad file left in place, not replaced by empty state" "$(cat "$DIR/c/data/state.json")" 'half a wri'
check "lock released after refusal" "$(yes_if "$(ls "$DIR/c/data" | grep hub.lock)")" 'no'
check "second boot still refuses (no silent reset)" "$(boot_refused c)" 'exit:1'
check "a restart loop keeps one copy, not one per boot" "$(ls "$DIR/c/data" | grep -c 'corrupt-')" '^1$'

echo "7. an empty state file refuses too"
mkdir -p "$DIR/e/data"
: > "$DIR/e/data/state.json"
check "empty file refused" "$(boot_refused e)" 'exit:1'

echo "8. missing state.json next to backups refuses"
mkdir -p "$DIR/m/data"
echo '{"schema_version":1,"tasks":[]}' > "$DIR/m/data/state.json.bak.1"
check "missing state with backups refused" "$(boot_refused m)" 'exit:1'
check "refusal points at the backups" "$(cat "$DIR/m.log")" 'backups exist'

echo "9. a version 0 file migrates to 1 with a pre-migrate copy"
mkdir -p "$DIR/v/data"
echo '{"tasks":[{"id":"t-1","title":"Legacy mission","status":"queued","priority":3,"project":"old","created_at":"2026-01-01T00:00:00.000Z","log":[],"artifacts":[]}],"seq":1,"projects":["old"]}' > "$DIR/v/data/state.json"
start_hub v "$PORT_A"; HUB_A=$LAST_PID
wait_up "$PORT_A"
check "migration logged" "$(cat "$DIR/v.log")" 'from schema 0 to 1'
check "state.json now at schema 1" "$(cat "$DIR/v/data/state.json")" '"schema_version": 1'
PRE=$(ls "$DIR/v/data" | grep pre-migrate || true)
check "pre-migrate copy kept" "$PRE" 'state.json.pre-migrate-'
check "pre-migrate copy is the old file" "$(yes_if "$(grep schema_version "$DIR/v/data/$PRE" 2>/dev/null)")" 'no'
check "legacy mission survives" "$(api "$PORT_A" GET /api/tasks)" 'Legacy mission'
check "missing keys backfilled" "$(cat "$DIR/v/data/state.json")" '"messages": \['
kill $HUB_A; wait $HUB_A 2>/dev/null; HUB_A=
start_hub v "$PORT_A"; HUB_A=$LAST_PID
wait_up "$PORT_A"
check "second boot does not migrate again" "$(ls "$DIR/v/data" | grep -c pre-migrate)" '^1$'
kill $HUB_A; wait $HUB_A 2>/dev/null; HUB_A=

echo "10. a file from a newer Bureau refuses to boot"
mkdir -p "$DIR/n/data"
echo '{"schema_version":99,"tasks":[]}' > "$DIR/n/data/state.json"
check "newer schema refused" "$(boot_refused n)" 'exit:1'
check "refusal names both versions" "$(cat "$DIR/n.log")" 'schema_version 99'

echo "11. the example token from .env.example is called out at boot"
EXAMPLE_TOKEN=$(grep '^BUREAU_TOKEN=' hub/.env.example | cut -d= -f2)
check ".env.example still ships a placeholder token" "$EXAMPLE_TOKEN" '.'
TOKEN=$EXAMPLE_TOKEN
start_hub x "$PORT_A"; HUB_A=$LAST_PID
wait_up "$PORT_A"
check "the example token is warned about" "$(cat "$DIR/x.log")" 'still the example token'
check "the hub still boots with it" "$(curl -s "http://127.0.0.1:$PORT_A/health")" '"ok": true'
kill $HUB_A; wait $HUB_A 2>/dev/null; HUB_A=
TOKEN=storagetest
check "a real token gets no such warning" "$(yes_if "$(grep 'example token' "$DIR/a.log")")" 'no'

echo "passed $PASS, failed $FAIL"
exit $FAIL
