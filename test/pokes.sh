#!/bin/sh
# test/pokes.sh — outbound wake-up pokes (the summoner), curl-only conformance.
# Self-contained: starts its own poke sink and its own scratch hub, tears both down.
# Usage: ./test/pokes.sh          (needs node + curl; uses ports 8199/8198)
set -u

HUB_PORT="${HUB_PORT:-8199}"
SINK_PORT="${SINK_PORT:-8198}"
TOKEN=poketest
DIR="$(mktemp -d)"
SINK_FILE="$DIR/sink.jsonl"
PASS=0; FAIL=0

check() { # label haystack needle
  if printf '%s' "$2" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ok: $1";
  else FAIL=$((FAIL+1)); echo "  FAIL: $1 (wanted '$3' in: $(printf '%s' "$2" | head -c 200))"; fi
}
check_absent() { # label haystack needle
  if printf '%s' "$2" | grep -q "$3"; then FAIL=$((FAIL+1)); echo "  FAIL: $1 ('$3' should be absent)";
  else PASS=$((PASS+1)); echo "  ok: $1"; fi
}

cd "$(dirname "$0")/.."

# Preflight: these ports must be free (a crashed earlier run may have left orphans).
for port in 8196 8197 "$HUB_PORT" "$SINK_PORT"; do
  pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  [ -n "$pid" ] && { echo "  (killing orphan pid $pid on :$port)"; kill $pid 2>/dev/null; }
done
sleep 0.3
cleanup() { kill ${HUB_PID:-} ${HUB2_PID:-} ${HUB3_PID:-} ${SINK_PID:-} 2>/dev/null; rm -rf "$DIR"; }
trap cleanup EXIT INT TERM

echo "1. start poke sink on :$SINK_PORT"
node -e "
const http = require('http'); const fs = require('fs');
http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => { fs.appendFileSync('$SINK_FILE', req.url + ' ' + b + '\n'); res.end('ok'); });
}).listen($SINK_PORT, '127.0.0.1');
" &
SINK_PID=$!

echo "2. start scratch hub on :$HUB_PORT (pokes: task.review+critic only)"
BUREAU_TOKEN=$TOKEN PORT=$HUB_PORT BUREAU_DATA_DIR="$DIR/data" BUREAU_BRAIN_DIR="$DIR/brain" \
BUREAU_POKES="[{\"url\":\"http://127.0.0.1:$SINK_PORT/wake\",\"headers\":{\"X-Poke-Test\":\"1\"},\"events\":[\"task.review\"],\"filter\":{\"gate\":\"critic\"}},{\"url\":\"http://127.0.0.1:$SINK_PORT/wake-text\",\"events\":[\"task.review\"],\"filter\":{\"gate\":\"critic\"},\"wrap\":\"text\"}]" \
node hub/server.js >"$DIR/hub.log" 2>&1 &
HUB_PID=$!
sleep 1

api() {
  m=$1; pth=$2; shift 2
  if [ $# -gt 0 ]; then
    curl -s -X "$m" "http://127.0.0.1:$HUB_PORT$pth" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$1"
  else
    curl -s -X "$m" "http://127.0.0.1:$HUB_PORT$pth" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'
  fi
}

echo "3. seed: project + two missions"
api POST /api/projects '{"id":"pk","label":"poke test"}' >/dev/null
T1=$(api POST /api/tasks '{"title":"critic-gate mission","project":"pk","gate":"critic"}' | node -e "let b='';process.stdin.on('data',c=>b+=c).on('end',()=>console.log(JSON.parse(b).task.id))")
T2=$(api POST /api/tasks '{"title":"boss-gate mission","project":"pk","gate":"boss"}' | node -e "let b='';process.stdin.on('data',c=>b+=c).on('end',()=>console.log(JSON.parse(b).task.id))")

echo "4. subscribed transition pokes (review + gate critic)"
api POST /api/tasks/claim "{\"agent\":\"builder-a\",\"id\":\"$T1\"}" >/dev/null
api PATCH "/api/tasks/$T1" '{"agent":"builder-a","status":"review","note":"round 1 parked"}' >/dev/null
sleep 1
SINK=$(cat "$SINK_FILE" 2>/dev/null || true)
check "poke arrived" "$SINK" '"event":"task.review"'
check "payload has task id" "$SINK" "\"id\":\"$T1\""
check "payload has gate" "$SINK" '"gate":"critic"'
check "payload has by" "$SINK" '"by":"builder-a"'
check "payload has prev_status" "$SINK" '"prev_status":"claimed"'
check_absent "no capability links leak" "$SINK" 'view_token\|review_links\|answer_link'
check "wrap:text subscription got a text turn" "$SINK" '{"text":"poke: task.review'
check "text line carries the routing facts" "$SINK" 'gate=critic · by=builder-a · prev=claimed'

echo "5. filtered-out transition does not poke (review + gate boss)"
api POST /api/tasks/claim "{\"agent\":\"builder-b\",\"id\":\"$T2\"}" >/dev/null
api PATCH "/api/tasks/$T2" '{"agent":"builder-b","status":"review","note":"parked at boss gate"}' >/dev/null
sleep 1
SINK=$(cat "$SINK_FILE")
check_absent "boss-gate review filtered out" "$SINK" "\"id\":\"$T2\""

echo "6. unsubscribed event does not poke (requeue)"
api PATCH "/api/tasks/$T1" '{"agent":"critic-x","status":"queued","note":"send-back"}' >/dev/null
sleep 1
SINK=$(cat "$SINK_FILE")
check_absent "requeue not subscribed" "$SINK" '"event":"task.requeued"'

echo "7. malformed BUREAU_POKES never kills the hub"
BUREAU_TOKEN=$TOKEN PORT=8197 BUREAU_DATA_DIR="$DIR/data2" BUREAU_BRAIN_DIR="$DIR/brain2" \
BUREAU_POKES='{not json' node hub/server.js >"$DIR/hub2.log" 2>&1 &
HUB2_PID=$!
sleep 1
UP=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8197/api/state" -H "Authorization: Bearer $TOKEN")
check "hub serves with broken config" "$UP" '200'
check "disable logged" "$(cat "$DIR/hub2.log")" 'pokes disabled'
echo "8. standing work rings the second bell (sweep-driven)"
STANDING_POKES="[
 {\"url\":\"http://127.0.0.1:$SINK_PORT/standing\",\"events\":[\"work.waiting\"],\"filter\":{\"status\":\"queued\",\"gate\":\"critic\"},\"every_min\":0},
 {\"url\":\"http://127.0.0.1:$SINK_PORT/standing-guarded\",\"events\":[\"work.waiting\"],\"filter\":{\"status\":\"queued\",\"gate\":\"critic\"},\"every_min\":0,\"unless_seen\":{\"agents\":[\"sleeper\"],\"within_min\":10}},
 {\"url\":\"http://127.0.0.1:$SINK_PORT/standing-cooled\",\"events\":[\"work.waiting\"],\"filter\":{\"status\":\"queued\",\"gate\":\"critic\"},\"every_min\":60}
]"
BUREAU_TOKEN=$TOKEN PORT=8196 BUREAU_DATA_DIR="$DIR/data3" BUREAU_BRAIN_DIR="$DIR/brain3" \
BUREAU_SWEEP_MS=400 BUREAU_POKES="$STANDING_POKES" node hub/server.js >"$DIR/hub3.log" 2>&1 &
HUB3_PID=$!
sleep 1
api3() {
  m=$1; pth=$2; shift 2
  if [ $# -gt 0 ]; then curl -s -X "$m" "http://127.0.0.1:8196$pth" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$1";
  else curl -s -X "$m" "http://127.0.0.1:8196$pth" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'; fi
}
api3 POST /api/projects '{"id":"pk","label":"poke test"}' >/dev/null
api3 POST /api/tasks '{"title":"standing critic work","project":"pk","gate":"critic"}' >/dev/null
sleep 1.4
SINK=$(cat "$SINK_FILE")
check "standing ring arrived" "$SINK" '/standing {"event":"work.waiting"'
check "ring carries waiting count" "$SINK" '"waiting":1'
check "guard rings while nobody is awake" "$SINK" '/standing-guarded '
COOLED=$(grep -c '/standing-cooled ' "$SINK_FILE")
check "cooldown rings exactly once" "$COOLED" '^1$'
api3 POST /api/agents/register '{"name":"sleeper","kind":"cowork"}' >/dev/null
GUARDED_BEFORE=$(grep -c '/standing-guarded ' "$SINK_FILE")
UNGUARDED_BEFORE=$(grep -c '/standing {' "$SINK_FILE")
sleep 1.4
GUARDED_AFTER=$(grep -c '/standing-guarded ' "$SINK_FILE")
UNGUARDED_AFTER=$(grep -c '/standing {' "$SINK_FILE")
check "unguarded keeps ringing" "$([ "$UNGUARDED_AFTER" -gt "$UNGUARDED_BEFORE" ] && echo grew)" 'grew'
check "guarded goes silent once the agent is awake" "$([ "$GUARDED_AFTER" -eq "$GUARDED_BEFORE" ] && echo silent)" 'silent'
kill $HUB3_PID 2>/dev/null

echo "passed $PASS, failed $FAIL"
exit $FAIL
