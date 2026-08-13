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
check "unknown project refused with the registry" "$(api POST /api/tasks '{"title":"x","project":"nonexistent"}')" '"projects"'
api POST /api/projects '{"name":"demo"}' > /dev/null
T1=$(api POST /api/tasks '{"title":"Refill the coffee machine","body":"The beans are decorative pixels. Replace them.","priority":2,"project":"demo"}')
check "create" "$T1" '"status": "queued"'
TID=$(echo "$T1" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
CLAIM=$(api POST /api/tasks/claim '{"agent":"menace"}')
check "claim highest priority" "$CLAIM" "\"id\": \"$TID\""
check "claim carries a lease" "$CLAIM" '"lease_until"'
check "progress note" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","status":"in_progress","note":"located the machine"}')" '"in_progress"'
check "artifact" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","artifact":{"label":"bean report","url":"https://example.com/beans"},"note":"filed the bean report"}')" 'bean report'

echo "4. blocked pauses the lease; the boss answers via capability link; work resumes"
check "blocked" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","status":"blocked","note":"waiting on: bean delivery"}')" '"blocked"'
check "blocked clears lease" "$(api GET "/api/tasks/$TID")" '"lease_until": null'
AN_TOKEN=$(api GET "/api/tasks/$TID" | grep -A2 '"answer_link"' | grep -o '"token": "[a-f0-9]*"' | grep -o '[a-f0-9]\{32\}')
check "answer link issued" "$AN_TOKEN" '[a-f0-9]'
check "answer form renders" "$(curl -s "$BUREAU_URL/r/$AN_TOKEN")" 'Answer'
check "empty answer refused" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BUREAU_URL/r/$AN_TOKEN" --data 'note=')" '400'
check "answer re-queues the mission" "$(curl -s -X POST "$BUREAU_URL/r/$AN_TOKEN" --data-urlencode 'note=beans are in the cupboard, second shelf')" 'Answer filed'
check "answer reached the log" "$(api GET "/api/tasks/$TID")" 'second shelf'
check "answered mission is reserved for the asker" "$(api GET "/api/tasks/$TID")" '"reserved_for": "menace"'
check "strangers cannot claim a reserved mission" "$(api POST /api/tasks/claim '{"agent":"stranger"}')" 'queue_empty'
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TID\"}" > /dev/null
check "owner claim clears the reservation" "$(api GET "/api/tasks/$TID" | grep -c reserved_for || true)" '0'
check "resume with fresh lease" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","status":"in_progress","lease_minutes":60,"note":"beans found, resuming"}')" '"in_progress"'

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

echo "6b. projects: default name, rename moves tasks and brain, view link"
TP=$(api POST /api/tasks '{"title":"Dust the pixel plants"}')
check "project defaults to general" "$TP" '"project": "general"'
check "projects listing carries ids" "$(api GET /api/projects)" '"id": "demo"'
check "create empty project" "$(api POST /api/projects '{"name":"garden"}')" '"id": "garden"'
check "duplicate project refused" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BUREAU_URL/api/projects" -H "$AUTH" -H "$JSON" -d '{"name":"garden"}')" '409'
check "empty project listed with zero tasks" "$(api GET /api/projects)" '"id": "garden"'
check "free-text label slugifies" "$(api POST /api/projects '{"label":"Chasse aux Trésors"}')" '"id": "chasse-aux-tresors"'
check "relabel keeps the id" "$(api PATCH /api/projects/garden '{"label":"Le Jardin"}')" '"label": "Le Jardin"'
check "delete refused with open missions" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BUREAU_URL/api/projects/demo" -H "$AUTH")" '409'
check "delete empty project" "$(api DELETE /api/projects/garden)" '"deleted": true'
check "deleted project gone" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BUREAU_URL/api/projects/garden" -H "$AUTH")" '404'
check "bad project name rejected" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BUREAU_URL/api/tasks" -H "$AUTH" -H "$JSON" -d '{"title":"x","project":"../evil"}')" '400'
check "rename moves tasks" "$(api POST /api/projects/rename '{"from":"demo","to":"ops"}')" '"renamed": 1'
check "task carries new project" "$(api GET "/api/tasks/$TID")" '"project": "ops"'
check "brain folder moved" "$(api GET '/api/knowledge?file=projects/ops/STATE.md')" 'coffee machine refilled'
VIEW_TOKEN=$(api GET "/api/tasks/$TID" | grep -o '"view_token": "[a-f0-9]*"' | grep -o '[a-f0-9]\{32\}')
check "view page renders the record" "$(curl -s "$BUREAU_URL/m/$VIEW_TOKEN")" 'Refill the coffee machine'
check "bad view token is 404" "$(curl -s -o /dev/null -w '%{http_code}' "$BUREAU_URL/m/00000000000000000000000000000000")" '404'

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
T2=$(api POST /api/tasks '{"title":"Water the plastic plant","priority":3}')
T2ID=$(echo "$T2" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$T2ID\",\"lease_minutes\":0.03}" > /dev/null
sleep 3
check "expired lease returns to queue" "$(api GET '/api/tasks?status=queued')" "\"id\": \"$T2ID\""

echo "8b. project capacity: one desk per project, spillover, all_busy, by-id bypass"
api POST /api/projects '{"label":"Busy Corner"}' > /dev/null
check "capacity is settable" "$(api PATCH /api/projects/busy-corner '{"capacity":2}')" '"capacity": 2'
check "capacity bounds enforced" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BUREAU_URL/api/projects/busy-corner" -H "$AUTH" -H "$JSON" -d '{"capacity":0}')" '400'
api PATCH /api/projects/busy-corner '{"capacity":1}' > /dev/null
BA=$(api POST /api/tasks '{"title":"Polish the busy corner sign","project":"busy-corner","priority":1}')
BAID=$(echo "$BA" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
BB=$(api POST /api/tasks '{"title":"Wax the busy corner floor","project":"busy-corner","priority":1}')
BBID=$(echo "$BB" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
check "first worker takes the busy corner" "$(api POST /api/tasks/claim '{"agent":"worker-a"}')" "\"id\": \"$BAID\""
check "second worker spills to the next project" "$(api POST /api/tasks/claim '{"agent":"worker-b"}')" 'Dust the pixel plants'
check "third worker finds every desk taken" "$(api POST /api/tasks/claim '{"agent":"worker-c"}')" 'all_busy'
check "claim by id bypasses capacity" "$(api POST /api/tasks/claim "{\"agent\":\"worker-c\",\"id\":\"$BBID\"}")" '"claimed"'

echo "9. the event stream speaks"
EVENTS=$(curl -s -N -m 3 "$BUREAU_URL/api/events?token=$BUREAU_TOKEN" -H "$AUTH" & sleep 1; api POST /api/agents/heartbeat '{"name":"menace","activity":"idle"}' > /dev/null; wait)
check "SSE delivers heartbeat" "$EVENTS" 'agent.heartbeat'

echo "10. the MCP door: same bureau, no shell required"
MURL=$(api GET /api/mcp | grep -o '"url": "[^"]*"' | cut -d'"' -f4)
mcp () { curl -s -X POST "$MURL" -H "Content-Type: application/json" -d "$1"; }
check "connector url revealed to the token holder" "$MURL" '/mcp/'
check "initialize negotiates" "$(mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"conformance","version":"0"}}}')" '"protocolVersion"'
check "initialized notification gets 202" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$MURL" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}')" '202'
check "tools listed" "$(mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')" 'create_mission'
check "whoami answers as consul" "$(mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"whoami","arguments":{}}}')" 'consul'
check "unknown project refused over MCP" "$(mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_mission","arguments":{"title":"x","project":"nonexistent"}}}')" 'unknown project'
MC=$(mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"create_mission","arguments":{"title":"Check the MCP door hinges","project":"general","priority":3}}}')
check "mission created over MCP" "$MC" 'Check the MCP door hinges'
MID=$(echo "$MC" | grep -o 't-[0-9]*' | head -1)
check "mission started over MCP" "$(mcp "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"start_mission\",\"arguments\":{\"id\":\"$MID\",\"note\":\"testing hinges\"}}}")" 'in_progress'
check "knowledge written over MCP" "$(mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"write_knowledge","arguments":{"file":"projects/general/STATE.md","content":"- MCP door checked (fake)","mode":"append","message":"general: mcp check"}}}')" 'STATE.md'
mcp "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"update_mission\",\"arguments\":{\"id\":\"$MID\",\"status\":\"done\",\"note\":\"hinges fine\"}}}" > /dev/null
check "bad capability token is 404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${MURL%/*}/000000000000000000000000000000000000000000000000" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":9,"method":"ping"}')" '404'

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ] && echo "CONFORMANT: the hub is fully drivable by curl." || echo "NOT CONFORMANT."
exit $FAIL
