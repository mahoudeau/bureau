#!/usr/bin/env bash
# Bureau conformance test: the dummy agent.
# A plain curl script that exercises the entire protocol (docs/protocol.md).
# If a hub feature cannot be reached from here, the feature is designed wrong.
# All fixture data is deliberately fake.
#
# Usage: BUREAU_URL=http://localhost:8100 BUREAU_TOKEN=devtoken ./test/dummy-agent.sh
set -u

BUREAU_URL="${BUREAU_URL:-http://localhost:8100}"
BUREAU_TOKEN="${BUREAU_TOKEN:-devtoken}"
AUTH="Authorization: Bearer $BUREAU_TOKEN"
JSON="Content-Type: application/json"
PASS=0; FAIL=0

check () { # check <label> <haystack> <needle>
  if echo "$2" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ok: $1"
  else FAIL=$((FAIL+1)); echo "  FAIL: $1"; echo "    wanted: $3"; echo "    got: $(echo "$2" | head -c 300)"; fi
}
api () { curl -s -X "$1" "$BUREAU_URL$2" -H "$AUTH" -H "$JSON" ${3:+-d "$3"}; }

echo "1. health and auth"
check "health" "$(curl -s "$BUREAU_URL/health")" '"ok": true'
check "rejects bad token" "$(curl -s "$BUREAU_URL/api/state" -H 'Authorization: Bearer wrong')" 'unauthorized'
check "no-store header" "$(curl -si "$BUREAU_URL/health" | tr -d '\r')" 'cache-control: no-store'

echo "2. register and heartbeat through every activity verb"
check "register" "$(api POST /api/agents/register '{"name":"menace","kind":"dummy","capabilities":["curl"]}')" '"name": "menace"'
for verb in editing reading executing thinking waiting_input waiting_permission blocked idle; do
  check "heartbeat $verb" "$(api POST /api/agents/heartbeat "{\"name\":\"menace\",\"activity\":\"$verb\"}")" "\"activity\": \"$verb\""
done
check "rejects unknown verb" "$(api POST /api/agents/heartbeat '{"name":"menace","activity":"vibing"}')" 'unknown activity'

echo "3. tasks: create, claim, progress, artifact"
T1=$(api POST /api/tasks '{"title":"Refill the coffee machine","body":"The beans are decorative pixels. Replace them.","priority":2,"project":"demo"}')
check "create" "$T1" '"status": "queued"'
TID=$(echo "$T1" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
CLAIM=$(api POST /api/tasks/claim '{"agent":"menace"}')
check "claim highest priority" "$CLAIM" "\"id\": \"$TID\""
check "claim carries a lease" "$CLAIM" '"lease_until"'
check "progress note" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","status":"in_progress","note":"located the machine"}')" '"in_progress"'
check "artifact" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","artifact":{"label":"bean report","url":"https://example.com/beans"},"note":"filed the bean report"}')" 'bean report'

echo "4. blocked pauses the lease, then work resumes"
check "blocked" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","status":"blocked","note":"waiting on: bean delivery"}')" '"blocked"'
check "blocked clears lease" "$(api GET "/api/tasks/$TID")" '"lease_until": null'
check "resume with fresh lease" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","status":"in_progress","lease_minutes":60,"note":"beans arrived"}')" '"in_progress"'

echo "5. messages: broadcast, directed, POST inbox"
api POST /api/messages '{"from":"menace","to":"*","body":"coffee situation under control"}' > /dev/null
api POST /api/messages '{"from":"menace","to":"boss","body":"need sign-off on bean budget"}' > /dev/null
check "GET inbox" "$(api GET '/api/messages?for=boss')" 'bean budget'
check "POST inbox variant" "$(api POST /api/messages/inbox '{"for":"boss"}')" 'bean budget'

echo "6. knowledge: write, append, read back, git history"
check "write profile" "$(api POST /api/knowledge '{"file":"agents/menace.md","content":"# menace\nRole: dummy conformance agent.","author":"menace","message":"menace: profile"}')" '"file": "agents/menace.md"'
check "append state" "$(api POST /api/knowledge '{"file":"projects/demo/STATE.md","content":"- coffee machine refilled (fake)","mode":"append","author":"menace","message":"demo: state update"}')" 'STATE.md'
check "read back" "$(api GET '/api/knowledge?file=agents/menace.md')" 'dummy conformance agent'
check "git log has author" "$(api GET /api/state)" '"author": "menace"'

echo "7. review gate: park, send back via capability link, approve via capability link"
check "park in review" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","status":"review","note":"ready for sign-off"}')" '"review"'
DETAIL=$(api GET "/api/tasks/$TID")
check "review links issued" "$DETAIL" 'review_links'
SB_TOKEN=$(echo "$DETAIL" | grep -A2 '"sendback"' | grep -o '"token": "[a-f0-9]*"' | grep -o '[a-f0-9]\{32\}')
check "link page renders without acting" "$(curl -s "$BUREAU_URL/r/$SB_TOKEN")" 'Send back'
check "still in review after GET" "$(api GET "/api/tasks/$TID")" '"review"'
check "sendback without note refused" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BUREAU_URL/r/$SB_TOKEN" --data 'note=')" '400'
check "sendback with note re-queues" "$(curl -s -X POST "$BUREAU_URL/r/$SB_TOKEN" --data-urlencode 'note=more beans, fewer pixels')" 'Sent back'
check "note reached the log" "$(api GET "/api/tasks/$TID")" 'more beans, fewer pixels'
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TID\"}" > /dev/null
api PATCH "/api/tasks/$TID" '{"agent":"menace","status":"review","note":"fixed per the note"}' > /dev/null
AP_TOKEN=$(api GET "/api/tasks/$TID" | grep -A2 '"approve"' | grep -o '"token": "[a-f0-9]*"' | grep -o '[a-f0-9]\{32\}')
check "approve via link" "$(curl -s -X POST "$BUREAU_URL/r/$AP_TOKEN")" 'Approved'
check "task is done" "$(api GET "/api/tasks/$TID")" '"done"'
check "used link is dead" "$(curl -s -o /dev/null -w '%{http_code}' "$BUREAU_URL/r/$AP_TOKEN")" '410'

echo "8. lease expiry re-queues abandoned work"
T2=$(api POST /api/tasks '{"title":"Water the plastic plant","priority":3,"project":"demo"}')
T2ID=$(echo "$T2" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$T2ID\",\"lease_minutes\":0.03}" > /dev/null
sleep 3
check "expired lease returns to queue" "$(api GET '/api/tasks?status=queued')" "\"id\": \"$T2ID\""

echo "9. the event stream speaks"
EVENTS=$(curl -s -N -m 3 "$BUREAU_URL/api/events?token=$BUREAU_TOKEN" -H "$AUTH" & sleep 1; api POST /api/agents/heartbeat '{"name":"menace","activity":"idle"}' > /dev/null; wait)
check "SSE delivers heartbeat" "$EVENTS" 'agent.heartbeat'

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ] && echo "CONFORMANT: the hub is fully drivable by curl." || echo "NOT CONFORMANT."
exit $FAIL
