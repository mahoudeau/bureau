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
  if printf '%s\n' "$2" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ok: $1"
  else FAIL=$((FAIL+1)); echo "  FAIL: $1"; echo "    wanted: $3"; echo "    got: $(printf '%s\n' "$2" | head -c 300)"; fi
}
# The body goes through stdin, not argv: on Windows, curl reads its arguments
# in the ANSI code page, so "é" in -d arrives as a byte that is not UTF-8.
api () {
  if [ -n "${3-}" ]; then printf '%s' "$3" | curl -s -X "$1" "$BUREAU_URL$2" -H "$AUTH" -H "$JSON" --data-binary @-
  else curl -s -X "$1" "$BUREAU_URL$2" -H "$AUTH" -H "$JSON"; fi
}

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
T1=$(api POST /api/tasks '{"title":"Refill the coffee machine","body":"The beans are decorative pixels. Replace them.","priority":2,"project":"demo","gate":"critic"}')
# gate:critic here deliberately (t-119): section 7 below exercises the
# capability-link review mechanism itself (park/sendback/approve links),
# not gate authorization - that's section 8c's own dedicated job. A
# gate:critic mission is parked into review by any agent exactly as always
# (the acceptance's own no-regression clause), so this keeps section 7
# testing what it always tested.
check "create" "$T1" '"status": "queued"'
TID=$(echo "$T1" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
CLAIM=$(api POST /api/tasks/claim '{"agent":"menace"}')
check "claim highest priority" "$CLAIM" "\"id\": \"$TID\""
check "claim carries a lease" "$CLAIM" '"lease_until"'
check "progress note" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","status":"in_progress","note":"located the machine"}')" '"in_progress"'
check "artifact" "$(api PATCH "/api/tasks/$TID" '{"agent":"menace","artifact":{"label":"bean report","url":"https://example.com/beans"},"note":"filed the bean report"}')" 'bean report'

echo "3b. sub-agent fleets: heartbeat sub_agents, fleet history, roster exclusion"
check "heartbeat with a 3-entry fleet accepted" "$(api POST /api/agents/heartbeat '{"name":"menace","activity":"editing","sub_agents":[{"label":"variant A of t-58","activity":"editing"},{"label":"variant B of t-58","activity":"thinking"},{"label":"inner critic round 4","activity":"reading"}]}')" '"label": "variant A of t-58"'
STATE1=$(api GET /api/state)
check "fleet nested under the parent's own agent record" "$STATE1" '"label": "variant B of t-58"'
check "fleet never inserted into the top-level roster (no name entry for it)" "$(echo "$STATE1" | grep -c '"name": "variant A of t-58"')" '^0$'
check "fleet composition change logged on the active mission" "$(api GET "/api/tasks/$TID")" 'fleet: 3 running - variant A of t-58 (editing), variant B of t-58 (thinking), inner critic round 4 (reading)'
LOGLEN1=$(api GET "/api/tasks/$TID" | grep -c '"note"')
api POST /api/agents/heartbeat '{"name":"menace","activity":"editing","sub_agents":[{"label":"variant A of t-58","activity":"editing"},{"label":"variant B of t-58","activity":"thinking"},{"label":"inner critic round 4","activity":"reading"}]}' > /dev/null
LOGLEN2=$(api GET "/api/tasks/$TID" | grep -c '"note"')
check "identical composition repeated: no new log line" "$([ "$LOGLEN1" -eq "$LOGLEN2" ] && echo unchanged)" 'unchanged'
api POST /api/agents/heartbeat '{"name":"menace","activity":"editing","sub_agents":[{"label":"variant A of t-58","activity":"editing"},{"label":"variant B of t-58","activity":"thinking"},{"label":"inner critic round 4","activity":"reading"},{"label":"variant C of t-58"}]}' > /dev/null
LOGLEN3=$(api GET "/api/tasks/$TID" | grep -c '"note"')
check "composition change (4th entry) adds exactly one new log line" "$([ "$LOGLEN3" -eq $((LOGLEN2+1)) ] && echo grew_by_one)" 'grew_by_one'
check "label-only entry (no activity) renders with no parens" "$(api GET "/api/tasks/$TID")" 'variant C of t-58"'
api POST /api/agents/heartbeat '{"name":"menace","activity":"editing","sub_agents":[]}' > /dev/null
check "fleet dropping to zero writes the closing line" "$(api GET "/api/tasks/$TID")" 'fleet: 0 - cleared'
SUBS=""; for i in $(seq 1 30); do [ -n "$SUBS" ] && SUBS="$SUBS,"; SUBS="$SUBS{\"label\":\"w$i\"}"; done
api POST /api/agents/heartbeat "{\"name\":\"menace\",\"sub_agents\":[$SUBS]}" > /dev/null
check "fleet array capped at 24 entries server-side, not rejected" "$(api GET /api/state | grep -c '"label": "w')" '^24$'
# Isolate the roster array from the rest of /api/state: the ring-buffer
# activity log also carries agent names on every register/heartbeat event, so
# a plain grep over the whole snapshot over-counts. Slice out just "agents".
agents_section () { api GET /api/state | sed -n '/"agents": \[/,/"tasks": \[/p'; }
api POST /api/agents/heartbeat '{"name":"menace","sub_agents":[{"label":"menace"}]}' > /dev/null
check "fleet label matching a real registered agent name stays inert data" "$(agents_section | grep -c '"name": "menace"')" '^1$'
check "a fleet-only label is absent from the roster before ever registering" "$(agents_section | grep -c '"name": "phantom-crew-1"')" '^0$'
api POST /api/agents/heartbeat '{"name":"menace","sub_agents":[{"label":"phantom-crew-1"}]}' > /dev/null
check "still absent from the roster after being reported as a sub-agent label" "$(agents_section | grep -c '"name": "phantom-crew-1"')" '^0$'
GHOST=$(api POST /api/tasks '{"title":"Ghost errand","priority":5}')
GHOSTID=$(echo "$GHOST" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
# Body in a variable: macOS bash 3.2 mangles escaped quotes inside "$(...)"
GHOSTCLAIM="{\"agent\":\"phantom-crew-1\",\"id\":\"$GHOSTID\"}"
check "claiming under that same string only works via the normal claim path" "$(api POST /api/tasks/claim "$GHOSTCLAIM")" '"status": "claimed"'
check "it is now an independent roster agent, unrelated to menace's fleet" "$(agents_section | grep -c '"name": "phantom-crew-1"')" '^1$'
api PATCH "/api/tasks/$GHOSTID" '{"agent":"phantom-crew-1","status":"done","note":"closed - was only a claim-path identity-blur proof"}' > /dev/null

echo "3c. roster curation: DELETE /api/agents/:name removes, never a ban"
check "register a throwaway probe" "$(api POST /api/agents/register '{"name":"probe-1","kind":"dummy"}')" '"name": "probe-1"'
PROBE_TASK=$(api POST /api/tasks '{"title":"Probe leaves a mark","priority":5}')
PROBE_TID=$(echo "$PROBE_TASK" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"probe-1\",\"id\":\"$PROBE_TID\"}" > /dev/null
check "removal refused while a live lease is held" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BUREAU_URL/api/agents/probe-1" -H "$AUTH")" '409'
check "refusal names the mission and says to release it" "$(api DELETE /api/agents/probe-1)" "$PROBE_TID"
api PATCH "/api/tasks/$PROBE_TID" '{"agent":"probe-1","status":"done","note":"probe finished, releasing the lease"}' > /dev/null
check "removal succeeds once the lease is released" "$(api DELETE /api/agents/probe-1)" '"removed": true'
check "removed name is gone from the roster" "$(agents_section | grep -c '"name": "probe-1"')" '^0$'
check "its old mission log survives untouched" "$(api GET "/api/tasks/$PROBE_TID")" 'probe finished, releasing the lease'
check "removing an unknown name is 404" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BUREAU_URL/api/agents/probe-1" -H "$AUTH")" '404'
check "removal is curation, not a ban: the name re-registers clean" "$(api POST /api/agents/register '{"name":"probe-1","kind":"dummy"}')" '"name": "probe-1"'
check "re-registered entry is back on the roster" "$(agents_section | grep -c '"name": "probe-1"')" '^1$'

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
check "entity settable on create" "$(api POST /api/projects '{"label":"Acme Site","entity":"acme"}')" '"entity": "acme"'
check "entity patchable" "$(api PATCH /api/projects/acme-site '{"entity":"acme-corp"}')" '"entity": "acme-corp"'
check "bad entity slug rejected" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BUREAU_URL/api/projects/acme-site" -H "$AUTH" -H "$JSON" -d '{"entity":"../evil"}')" '400'
check "empty entity clears the wall" "$(api PATCH /api/projects/acme-site '{"entity":""}' | grep -c '"entity"' || true)" '0'
check "repo settable" "$(api PATCH /api/projects/acme-site '{"repo":"https://github.com/acme/site"}')" '"repo": "https://github.com/acme/site"'
check "bad repo url refused" "$(api PATCH /api/projects/acme-site '{"repo":"git@github.com:acme/site.git"}')" 'https clone URL'
api DELETE /api/projects/acme-site > /dev/null
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

echo "7b. itemized review: proposals filed, per-item verdicts via capability link"
TI=$(api POST /api/tasks '{"title":"Curation proposals","project":"ops","priority":2,"gate":"critic"}')
TIID=$(echo "$TI" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TIID\"}" > /dev/null
check "items filed with server ids" "$(api PATCH "/api/tasks/$TIID" '{"agent":"menace","items":[{"title":"Promote the coffee fact","body":"- [fact] the beans are pixels"},{"title":"Compact the ops STATE"}]}')" '"id": "i2"'
api PATCH "/api/tasks/$TIID" '{"agent":"menace","status":"review","note":"proposal set ready"}' > /dev/null
IT_AP=$(api GET "/api/tasks/$TIID" | grep -A2 '"approve"' | grep -o '"token": "[a-f0-9]*"' | grep -o '[a-f0-9]\{32\}')
check "review page renders the items" "$(curl -s "$BUREAU_URL/r/$IT_AP")" 'Promote the coffee fact'
check "verdicts ride the approve" "$(curl -s -X POST "$BUREAU_URL/r/$IT_AP" --data 'v_i1=approved&v_i2=rejected&c_i2=not+yet+convinced')" 'Approved'
IT_DETAIL=$(api GET "/api/tasks/$TIID")
check "approval persisted on the item" "$IT_DETAIL" '"verdict": "approved"'
check "rejection comment persisted" "$IT_DETAIL" 'not yet convinced'
check "verdicts reached the log" "$IT_DETAIL" 'verdicts: i1 approved'

echo "7c. history at write time: from/to on status changes, agent fallback, the boss's kind"
# The boss's hand, read back from the log entries sections 4, 7 and 7b wrote
TID_LOG=$(api GET "/api/tasks/$TID")
check "a review-link approve carries kind approve" "$(echo "$TID_LOG" | grep -A3 '"note": "approved via link"')" '"kind": "approve"'
check "the approve records from review" "$(echo "$TID_LOG" | grep -A3 '"note": "approved via link"')" '"from": "review"'
check "the approve records to done" "$(echo "$TID_LOG" | grep -A3 '"note": "approved via link"')" '"to": "done"'
check "a review-link send-back carries kind send_back" "$(echo "$TID_LOG" | grep -A3 '"note": "more beans, fewer pixels"')" '"kind": "send_back"'
check "the send-back records to queued" "$(echo "$TID_LOG" | grep -A3 '"note": "more beans, fewer pixels"')" '"to": "queued"'
check "an answer carries kind answer, from blocked" "$(echo "$TID_LOG" | grep -A3 '"note": "beans are in the cupboard')" '"from": "blocked"'
check "an answer carries kind answer" "$(echo "$TID_LOG" | grep -A3 '"note": "beans are in the cupboard')" '"kind": "answer"'
check "a claim records from queued" "$(echo "$TID_LOG" | grep -A2 '"note": "claimed')" '"from": "queued"'
check "the boss's verdicts carry kind verdict" "$(api GET "/api/tasks/$TIID" | grep -A1 '"note": "verdicts: i1')" '"kind": "verdict"'
# A worker's PATCH that carries both a status and a note keeps both
TW=$(api POST /api/tasks '{"title":"History probe","project":"ops","priority":4,"gate":"critic"}')
TWID=$(echo "$TW" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
TW_CLAIM="{\"agent\":\"menace\",\"id\":\"$TWID\"}"
api POST /api/tasks/claim "$TW_CLAIM" > /dev/null
TW_START='{"agent":"menace","status":"in_progress","note":"history probe started"}'
api PATCH "/api/tasks/$TWID" "$TW_START" > /dev/null
check "a status change with a note keeps the note" "$(api GET "/api/tasks/$TWID")" 'history probe started'
check "and records from" "$(api GET "/api/tasks/$TWID" | grep -A2 '"note": "history probe started"')" '"from": "claimed"'
check "and records to" "$(api GET "/api/tasks/$TWID" | grep -A2 '"note": "history probe started"')" '"to": "in_progress"'
check "a worker's entry carries no kind" "$(api GET "/api/tasks/$TWID" | grep -A3 '"note": "history probe started"' | grep -c '"kind"' || true)" '^0$'
TW_NOAGENT='{"note":"nobody named here"}'
check "an update without agent is accepted while a lease is held" "$(api PATCH "/api/tasks/$TWID" "$TW_NOAGENT")" '"status": "in_progress"'
check "and is credited to the lease holder" "$(api GET "/api/tasks/$TWID" | grep -B1 '"note": "nobody named here"')" '"by": "menace"'
TW_DONE='{"agent":"menace","status":"done","note":"probe closed"}'
api PATCH "/api/tasks/$TWID" "$TW_DONE" > /dev/null
TU=$(api POST /api/tasks '{"title":"Unheld probe","project":"ops","priority":5}')
TUID=$(echo "$TU" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
TU_NOAGENT='{"note":"who am I"}'
check "an update without agent and no holder is refused" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BUREAU_URL/api/tasks/$TUID" -H "$AUTH" -H "$JSON" -d "$TU_NOAGENT")" '400'
check "the refusal says an agent is required" "$(api PATCH "/api/tasks/$TUID" "$TU_NOAGENT")" 'agent required'
check "the refused update wrote nothing" "$(api GET "/api/tasks/$TUID" | grep -c 'who am I' || true)" '^0$'
TU_HUMAN='{"agent":"human","status":"discarded","note":"probe not needed"}'
check "a human edit outside review carries kind edit" "$(api PATCH "/api/tasks/$TUID" "$TU_HUMAN" | grep -A3 '"note": "probe not needed"')" '"kind": "edit"'

echo "8. lease expiry re-queues abandoned work"
T2=$(api POST /api/tasks '{"title":"Water the plastic plant","priority":3}')
T2ID=$(echo "$T2" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$T2ID\",\"lease_minutes\":0.03}" > /dev/null
sleep 3
check "expired lease returns to queue" "$(api GET '/api/tasks?status=queued')" "\"id\": \"$T2ID\""
check "non-cowork expiry keeps the reservation" "$(api GET "/api/tasks/$T2ID")" '"reserved_for": "menace"'
check "a lease expiry records from and to" "$(api GET "/api/tasks/$T2ID" | grep -A3 '"note": "lease expired')" '"to": "queued"'
# Unified reservations: cowork holders keep their mission only for the TTL.
# The lapse check needs a hub started with a tiny BUREAU_RESERVATION_TTL_MIN
# (0.02 = 1.2s) and CONF_SHORT_TTL=1 here, as CI does; against a default hub it
# would wait 30 minutes, so without the flag it is skipped, not failed.
api POST /api/agents/register '{"name":"shifty","kind":"cowork"}' > /dev/null
T3=$(api POST /api/tasks '{"title":"Straighten the office plants","priority":1}')
T3ID=$(echo "$T3" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"shifty\",\"id\":\"$T3ID\",\"lease_minutes\":0.03}" > /dev/null
sleep 3
api GET /api/tasks > /dev/null
check "cowork expiry reserves for the shift worker too" "$(api GET "/api/tasks/$T3ID")" '"reserved_for": "shifty"'
if [ -n "${CONF_SHORT_TTL:-}" ]; then
  sleep 2
  check "lapsed cowork reservation returns to the pool" "$(api POST /api/tasks/claim '{"agent":"worker-x"}')" "\"id\": \"$T3ID\""
else
  # same end state as the check: worker-x holds it, the pool is clear for 8b
  api POST /api/tasks/claim "{\"agent\":\"worker-x\",\"id\":\"$T3ID\"}" > /dev/null
  echo "  skip: lapsed cowork reservation (needs BUREAU_RESERVATION_TTL_MIN=0.02 on the hub and CONF_SHORT_TTL=1)"
fi
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$T2ID\"}" > /dev/null
api PATCH "/api/tasks/$T2ID" '{"agent":"menace","status":"done","note":"plant watered"}' > /dev/null
api PATCH "/api/tasks/$T3ID" '{"agent":"worker-x","status":"done","note":"plants straightened"}' > /dev/null

echo "8c. the gate: boss-gate reviews move only by the boss's hand"
TG=$(api POST /api/tasks '{"title":"Gate check mission","project":"ops","priority":2}')
TGID=$(echo "$TG" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
check "gate defaults to boss" "$TG" '"gate": "boss"'
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TGID\"}" > /dev/null

# t-119: boss-gate review ENTRY is hub-enforced, generically (no agent name
# is ever compared - "the critic" and "the lead" are whichever registered
# agent's own capabilities[] includes that literal tag).
check "plain agent cannot park a boss-gate review" "$(api PATCH "/api/tasks/$TGID" '{"agent":"menace","status":"review","note":"parked"}')" 'only the critic, the lead, or the boss'
check "refused park leaves the mission untouched, not half-applied" "$(api GET "/api/tasks/$TGID")" '"status": "claimed"'
# A refused update changes nothing, gate included: raising the gate to boss in
# the same PATCH as a park the agent may not make leaves a critic gate alone
TPG=$(api POST /api/tasks '{"title":"Half-applied probe","project":"ops","priority":4,"gate":"critic"}')
TPGID=$(echo "$TPG" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
TPG_CLAIM="{\"agent\":\"menace\",\"id\":\"$TPGID\"}"
api POST /api/tasks/claim "$TPG_CLAIM" > /dev/null
check "gate raise riding a refused park is refused with it" "$(api PATCH "/api/tasks/$TPGID" '{"agent":"menace","gate":"boss","status":"review","note":"parked"}')" 'only the critic, the lead, or the boss'
check "the refused update left the critic gate in place" "$(api GET "/api/tasks/$TPGID")" '"gate": "critic"'
api PATCH "/api/tasks/$TPGID" '{"agent":"menace","status":"done","note":"probe closed"}' > /dev/null
api POST /api/agents/register '{"name":"moneta","kind":"cowork","capabilities":["review","critic"]}' > /dev/null
check "critic-capability agent parks a boss-gate review" "$(api PATCH "/api/tasks/$TGID" '{"agent":"moneta","status":"review","note":"parked by critic"}')" '"status": "review"'

check "agent cannot close a boss-gate review" "$(api PATCH "/api/tasks/$TGID" '{"agent":"moneta","status":"done"}')" 'boss-gate'
check "agent cannot set critic gate" "$(api PATCH "/api/tasks/$TGID" '{"agent":"menace","gate":"critic"}')" 'only the boss or the lead'
api POST /api/agents/register '{"name":"consul","kind":"claude-code","capabilities":["code","lead"]}' > /dev/null
check "lead-capability agent sets critic gate" "$(api PATCH "/api/tasks/$TGID" '{"agent":"consul","gate":"critic"}')" '"gate": "critic"'
check "critic closes a critic-gate review" "$(api PATCH "/api/tasks/$TGID" '{"agent":"moneta","status":"done","note":"passes the bar"}')" '"done"'

TL=$(api POST /api/tasks '{"title":"Gate check mission 2 (lead parks)","project":"ops","priority":2}')
TLID=$(echo "$TL" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TLID\"}" > /dev/null
check "lead-capability agent also parks a boss-gate review" "$(api PATCH "/api/tasks/$TLID" '{"agent":"consul","status":"review","note":"parked by lead"}')" '"status": "review"'
check "human closes it" "$(api PATCH "/api/tasks/$TLID" '{"agent":"human","status":"done","note":"approved"}')" '"done"'

TH=$(api POST /api/tasks '{"title":"Gate check mission 3 (human parks)","project":"ops","priority":2}')
THID=$(echo "$TH" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$THID\"}" > /dev/null
check "human (the boss himself) can always park a boss-gate review" "$(api PATCH "/api/tasks/$THID" '{"agent":"human","status":"review","note":"self-parked"}')" '"status": "review"'
api PATCH "/api/tasks/$THID" '{"agent":"human","status":"done"}' > /dev/null

# t-356: the librarian parks its own digest. Both halves are required, the
# "librarian" tag on the roster AND a title prefixed with the agent's own
# name; either alone is refused like any plain agent.
api POST /api/agents/register '{"name":"archivist","kind":"cowork","capabilities":["curation","librarian"]}' > /dev/null
TD=$(api POST /api/tasks '{"title":"archivist: nightly digest 2026-01-01","project":"ops","priority":3}')
TDID=$(echo "$TD" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"archivist\",\"id\":\"$TDID\"}" > /dev/null
check "librarian parks its own digest into review" "$(api PATCH "/api/tasks/$TDID" '{"agent":"archivist","status":"review","note":"1 item filed"}')" '"status": "review"'
api PATCH "/api/tasks/$TDID" '{"agent":"human","status":"done","note":"approved"}' > /dev/null
TN=$(api POST /api/tasks '{"title":"menace: looks like a digest","project":"ops","priority":3}')
TNID=$(echo "$TN" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TNID\"}" > /dev/null
check "title prefix alone grants a non-librarian nothing" "$(api PATCH "/api/tasks/$TNID" '{"agent":"menace","status":"review","note":"parked"}')" 'boss-gate'
api PATCH "/api/tasks/$TNID" '{"agent":"menace","status":"done","note":"closed"}' > /dev/null
TO=$(api POST /api/tasks '{"title":"Not the archivist digest","project":"ops","priority":3}')
TOID=$(echo "$TO" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"archivist\",\"id\":\"$TOID\"}" > /dev/null
check "librarian tag alone grants nothing on a mission not titled with its name" "$(api PATCH "/api/tasks/$TOID" '{"agent":"archivist","status":"review","note":"parked"}')" 'boss-gate'
api PATCH "/api/tasks/$TOID" '{"agent":"archivist","status":"done","note":"closed"}' > /dev/null

# t-356: re-registration replaces capabilities on purpose, but never with an
# empty array, and every change is logged with before and after.
api POST /api/agents/register '{"name":"archivist","kind":"cowork","capabilities":[]}' > /dev/null
check "empty capabilities on re-register are ignored" "$(agents_section | grep -A4 '"name": "archivist"')" 'librarian'
api POST /api/agents/register '{"name":"archivist","kind":"cowork","capabilities":["curation"]}' > /dev/null
check "a changed capabilities array is logged" "$(api GET /api/state)" '"type": "agent.capabilities_changed"'
check "the log entry carries the dropped tag" "$(api GET /api/state | grep -A8 'agent.capabilities_changed')" '"librarian"'
check "the roster now holds the new array" "$(agents_section | grep -A4 '"name": "archivist"' | grep -c librarian || true)" '0'
TC=$(api POST /api/tasks '{"title":"Critic sendback mission","project":"ops","priority":2,"gate":"critic"}')
TCID=$(echo "$TC" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
check "gate settable on create" "$TC" '"gate": "critic"'
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TCID\"}" > /dev/null
api PATCH "/api/tasks/$TCID" '{"agent":"menace","status":"review","note":"parked"}' > /dev/null
check "critic send-back reserves for the builder" "$(api PATCH "/api/tasks/$TCID" '{"agent":"moneta","status":"queued","note":"gaps: the bar is not met"}')" '"reserved_for": "menace"'
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TCID\"}" > /dev/null
api PATCH "/api/tasks/$TCID" '{"agent":"menace","status":"done","note":"fixed"}' > /dev/null

echo "8d. brain attachments: base64 in, raw bytes out, whitelist enforced"
PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
# JSON with escaped quotes inside a double-quoted $() trips macOS bash 3.2's
# parser (fragments the argument); building the body in a variable is immune.
PNG_BODY="{\"file\":\"projects/ops/references/pixel.png\",\"content\":\"$PNG_B64\",\"encoding\":\"base64\",\"author\":\"menace\",\"message\":\"ops: bar reference\"}"
check "base64 attachment accepted" "$(api POST /api/knowledge "$PNG_BODY")" '"bytes"'
check "binary read returns base64" "$(api GET '/api/knowledge?file=projects/ops/references/pixel.png')" 'content_base64'
check "raw read serves the right content-type" "$(curl -si "$BUREAU_URL/api/knowledge?file=projects/ops/references/pixel.png&raw=1" -H "$AUTH" | LC_ALL=C tr -d '\r')" 'content-type: image/png'
check "off-whitelist extension refused" "$(api POST /api/knowledge '{"file":"projects/ops/references/tool.exe","content":"x","author":"menace"}')" 'only .md'
PNG_APPEND="{\"file\":\"projects/ops/references/pixel.png\",\"content\":\"$PNG_B64\",\"encoding\":\"base64\",\"mode\":\"append\"}"
check "base64 append refused" "$(api POST /api/knowledge "$PNG_APPEND")" 'replace-only'
TE=$(api POST /api/tasks '{"title":"Evidence renders inline","project":"ops","priority":2,"gate":"critic"}')
TEID=$(echo "$TE" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TEID\"}" > /dev/null
api PATCH "/api/tasks/$TEID" '{"agent":"menace","artifact":{"label":"screenshot","url":"projects/ops/references/pixel.png"},"status":"review","note":"evidence attached"}' > /dev/null
EV_TOKEN=$(api GET "/api/tasks/$TEID" | grep -A2 '"approve"' | grep -o '"token": "[a-f0-9]*"' | grep -o '[a-f0-9]\{32\}')
check "review page renders evidence inline" "$(curl -s "$BUREAU_URL/r/$EV_TOKEN")" '<img src="/r/'
check "capability image route serves the bytes" "$(curl -si "$BUREAU_URL/r/$EV_TOKEN/img?file=projects/ops/references/pixel.png" | LC_ALL=C tr -d '\r')" 'content-type: image/png'
check "bad capability gets no image" "$(curl -s -o /dev/null -w '%{http_code}' "$BUREAU_URL/r/00000000000000000000000000000000/img?file=projects/ops/references/pixel.png")" '404'
# A live link reaches only the images its own mission cites, never the rest of the brain
OTHER_BODY="{\"file\":\"projects/other/references/secret.png\",\"content\":\"$PNG_B64\",\"encoding\":\"base64\",\"author\":\"menace\"}"
api POST /api/knowledge "$OTHER_BODY" > /dev/null
check "a live link cannot reach an image its mission does not cite" "$(curl -s -o /dev/null -w '%{http_code}' "$BUREAU_URL/r/$EV_TOKEN/img?file=projects/other/references/secret.png")" '404'
curl -s -X POST "$BUREAU_URL/r/$EV_TOKEN" > /dev/null

echo "8e. intake sweep: hand-dropped brain files become commits (needs CONF_BRAIN_DIR)"
if [ -n "${CONF_BRAIN_DIR:-}" ]; then
  mkdir -p "$CONF_BRAIN_DIR/import"
  echo "- dropped by hand, fake" > "$CONF_BRAIN_DIR/import/dropped-note.md"
  check "sweep commits the drop" "$(api POST /api/knowledge/sweep)" '"committed": 1'
  check "dropped file readable via the API" "$(api GET '/api/knowledge?file=import/dropped-note.md')" 'dropped by hand'
  check "intake commit authored by the human hand" "$(api GET /api/state)" 'intake: files dropped or edited by hand'
  check "clean sweep is a no-op" "$(api POST /api/knowledge/sweep)" '"committed": 0'
else
  echo "  skip: CONF_BRAIN_DIR not set (sweep checks need filesystem access to the hub's brain)"
fi

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
BBCLAIM="{\"agent\":\"worker-c\",\"id\":\"$BBID\"}"
check "claim by id bypasses capacity" "$(api POST /api/tasks/claim "$BBCLAIM")" '"status": "claimed"'
GOAL=$(api POST /api/tasks '{"title":"goal: tidy the corner","project":"busy-corner","priority":1}')
GOALID=$(echo "$GOAL" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
GKID=$(api POST /api/tasks '{"title":"Sweep under the goal","project":"busy-corner","priority":1}')
GKIDID=$(echo "$GKID" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api PATCH "/api/tasks/$BAID" '{"agent":"worker-a","status":"done","note":"sign polished"}' > /dev/null
api PATCH "/api/tasks/$BBID" '{"agent":"worker-c","status":"done","note":"floor waxed"}' > /dev/null
api POST /api/tasks/claim "{\"agent\":\"lead-x\",\"id\":\"$GOALID\"}" > /dev/null
check "a held goal does not occupy the desk" "$(api POST /api/tasks/claim '{"agent":"worker-d"}')" "\"id\": \"$GKIDID\""

echo "9. the event stream speaks"
EVENTS=$(curl -s -N -m 3 "$BUREAU_URL/api/events?token=$BUREAU_TOKEN" -H "$AUTH" & sleep 1; api POST /api/agents/heartbeat '{"name":"menace","activity":"idle"}' > /dev/null; wait)
check "SSE delivers heartbeat" "$EVENTS" 'agent.heartbeat'

echo "10. the MCP door: same bureau, no shell required"
MURL=$(api GET /api/mcp | grep -o '"url": "[^"]*"' | cut -d'"' -f4)
mcp () { printf '%s' "$1" | curl -s -X POST "$MURL" -H "Content-Type: application/json" --data-binary @-; } # stdin, as api
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
mcp "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"update_mission\",\"arguments\":{\"id\":\"$MID\",\"items\":[{\"title\":\"Oil the hinges\"}]}}}" > /dev/null
check "items filed over MCP" "$(api GET "/api/tasks/$MID")" 'Oil the hinges'
mcp "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"update_mission\",\"arguments\":{\"id\":\"$MID\",\"status\":\"done\",\"note\":\"hinges fine\"}}}" > /dev/null
check "bad capability token is 404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${MURL%/*}/000000000000000000000000000000000000000000000000" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":9,"method":"ping"}')" '404'
check "update_mission advertises approved_in_session" "$(mcp '{"jsonrpc":"2.0","id":10,"method":"tools/list"}')" 'approved_in_session'

echo "11. settings (S2): absent means today's behavior, every stricter rule opt-in"
# JSON bodies that carry a variable are built in a variable first (bash 3.2).
tid () { echo "$1" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*'; }
new_claimed () { # new_claimed <title> <agent>: a boss-gate mission in ops, claimed
  local body="{\"title\":\"$1\",\"project\":\"ops\",\"priority\":4}"
  local id; id=$(tid "$(api POST /api/tasks "$body")")
  local claim="{\"agent\":\"$2\",\"id\":\"$id\"}"
  api POST /api/tasks/claim "$claim" > /dev/null
  echo "$id"
}
check "no settings by default" "$(api GET /api/settings)" '"global": {}'
S1=$(new_claimed "Settings: no policy" menace)
check "no settings: an agent still closes its own boss-gate mission done" "$(api PATCH "/api/tasks/$S1" '{"agent":"menace","status":"done","note":"closed as always"}')" '"status": "done"'

check "bad approval enum refused" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BUREAU_URL/api/settings" -H "$AUTH" -H "$JSON" -d '{"global":{"approval":"maybe"}}')" '400'
check "refusal names the allowed values" "$(api PATCH /api/settings '{"global":{"approval":"maybe"}}')" 'dashboard, in-session, critic'
check "unknown key refused" "$(api PATCH /api/settings '{"global":{"vibes":"on"}}')" 'unknown key vibes'
check "unknown project refused" "$(api PATCH /api/settings '{"projects":{"nowhere":{"approval":"dashboard"}}}')" 'unknown project'
check "bad role refused" "$(api PATCH /api/settings '{"agents":{"menace":{"roles":["boss"]}}}')" 'roles'
check "bad librarian schedule refused" "$(api PATCH /api/settings '{"global":{"librarian":{"schedule":"3am"}}}')" 'HH:MM'
check "a refused patch applies nothing" "$(api GET /api/settings)" '"global": {}'

check "PATCH sets global dashboard" "$(api PATCH /api/settings '{"global":{"approval":"dashboard","notify":"review","librarian":{"schedule":"03:00","gap_missions_per_week":5}}}')" '"approval": "dashboard"'
check "GET round-trips it" "$(api GET /api/settings)" '"gap_missions_per_week": 5'
check "merge is key by key" "$(api PATCH /api/settings '{"global":{"notify":"none"}}')" '"approval": "dashboard"'
check "settings.changed logged" "$(api GET /api/state)" '"type": "settings.changed"'
check "the event carries before and after" "$(api GET /api/state | grep -A30 'settings.changed' | tr -d ' \n')" '"before":{'

S2=$(new_claimed "Settings: dashboard" menace)
check "explicit dashboard refuses an agent closing boss-gate work done" "$(api PATCH "/api/tasks/$S2" '{"agent":"menace","status":"done"}')" 'approval policy (dashboard)'
check "the refused close leaves the mission claimed" "$(api GET "/api/tasks/$S2")" '"status": "claimed"'
check "a chat quote is refused under dashboard" "$(api PATCH "/api/tasks/$S2" '{"agent":"menace","status":"done","approved_in_session":"ship it"}')" 'does not accept chat approvals'
check "the boss still closes it" "$(api PATCH "/api/tasks/$S2" '{"agent":"human","status":"done"}')" '"status": "done"'
S2C=$(api POST /api/tasks '{"title":"Settings: critic gate under dashboard","project":"ops","priority":4,"gate":"critic"}')
S2CID=$(tid "$S2C")
S2CCLAIM="{\"agent\":\"menace\",\"id\":\"$S2CID\"}"
api POST /api/tasks/claim "$S2CCLAIM" > /dev/null
check "dashboard leaves critic-gate missions alone" "$(api PATCH "/api/tasks/$S2CID" '{"agent":"menace","status":"done"}')" '"status": "done"'

check "project override to in-session" "$(api PATCH /api/settings '{"projects":{"ops":{"approval":"in-session"}}}')" '"approval": "in-session"'
S3=$(new_claimed "Settings: in-session" menace)
check "in-session without a quote is refused" "$(api PATCH "/api/tasks/$S3" '{"agent":"menace","status":"done"}')" 'needs approved_in_session'
check "an empty quote is refused" "$(api PATCH "/api/tasks/$S3" '{"agent":"menace","status":"done","approved_in_session":"  "}')" 'cannot be empty'
check "a quote rides only a close to done" "$(api PATCH "/api/tasks/$S3" '{"agent":"menace","status":"in_progress","approved_in_session":"ship it"}')" 'only rides a close'
check "in-session with the quote closes it" "$(api PATCH "/api/tasks/$S3" '{"agent":"menace","status":"done","approved_in_session":"ship it, looks right"}')" '"status": "done"'
check "the quote is in the mission log" "$(api GET "/api/tasks/$S3")" 'approved by boss in session: \\"ship it, looks right\\" (recorded by menace)'
check "task.approved_in_session logged" "$(api GET /api/state)" '"type": "task.approved_in_session"'
SG=$(tid "$(api POST /api/tasks '{"title":"Settings: general stays dashboard","project":"general","priority":4}')")
SGCLAIM="{\"agent\":\"menace\",\"id\":\"$SG\"}"
api POST /api/tasks/claim "$SGCLAIM" > /dev/null
check "global stays dashboard for other projects" "$(api PATCH "/api/tasks/$SG" '{"agent":"menace","status":"done","approved_in_session":"x"}')" 'does not accept chat approvals'
api PATCH "/api/tasks/$SG" '{"agent":"human","status":"done"}' > /dev/null
S3R=$(new_claimed "Settings: in-session from review" menace)
S3RPARK="{\"agent\":\"consul\",\"status\":\"review\",\"note\":\"parked by lead\"}"
api PATCH "/api/tasks/$S3R" "$S3RPARK" > /dev/null
check "in-session: no quote, review exit stays the boss's" "$(api PATCH "/api/tasks/$S3R" '{"agent":"menace","status":"done"}')" 'only the boss moves'
check "in-session: the quote closes it out of review" "$(api PATCH "/api/tasks/$S3R" '{"agent":"menace","status":"done","approved_in_session":"approved, merge it"}')" '"status": "done"'
MS=$(mcp '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"create_mission","arguments":{"title":"Settings: MCP quote","project":"ops"}}}')
MSID=$(echo "$MS" | grep -o 't-[0-9]*' | head -1)
MSSTART="{\"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"tools/call\",\"params\":{\"name\":\"start_mission\",\"arguments\":{\"id\":\"$MSID\"}}}"
mcp "$MSSTART" > /dev/null
MSDONE="{\"jsonrpc\":\"2.0\",\"id\":13,\"method\":\"tools/call\",\"params\":{\"name\":\"update_mission\",\"arguments\":{\"id\":\"$MSID\",\"status\":\"done\",\"approved_in_session\":\"yes, close it\"}}}"
mcp "$MSDONE" > /dev/null
check "MCP update_mission records the quote" "$(api GET "/api/tasks/$MSID")" 'recorded by consul'

api PATCH /api/settings '{"projects":{"ops":{"approval":"critic"}}}' > /dev/null
S4=$(new_claimed "Settings: critic policy" menace)
check "critic policy: a plain agent cannot close boss-gate work" "$(api PATCH "/api/tasks/$S4" '{"agent":"menace","status":"done"}')" 'approval policy (critic)'
check "critic policy: the critic closes it" "$(api PATCH "/api/tasks/$S4" '{"agent":"moneta","status":"done","note":"critic pass"}')" '"status": "done"'

api PATCH /api/settings '{"global":{"default_gate":"critic"}}' > /dev/null
check "default_gate applies when no gate is given" "$(api POST /api/tasks '{"title":"Settings: default gate","project":"general","priority":5}')" '"gate": "critic"'
check "an explicit gate still wins" "$(api POST /api/tasks '{"title":"Settings: explicit gate","project":"general","priority":5,"gate":"boss"}')" '"gate": "boss"'
api PATCH /api/settings '{"global":{"default_gate":null}}' > /dev/null

S5=$(new_claimed "Settings: roles" menace)
check "before roles: menace cannot set critic gate" "$(api PATCH "/api/tasks/$S5" '{"agent":"menace","gate":"critic"}')" 'only the boss or the lead'
api PATCH /api/settings '{"agents":{"menace":{"roles":["lead"]},"moneta":{"roles":[]}}}' > /dev/null
check "settings roles grant lead without the capability" "$(api PATCH "/api/tasks/$S5" '{"agent":"menace","gate":"critic"}')" '"gate": "critic"'
S6=$(new_claimed "Settings: roles drop critic" menace)
check "settings roles override a self-registered critic tag" "$(api PATCH "/api/tasks/$S6" '{"agent":"moneta","status":"review"}')" 'only the critic, the lead, or the boss'
check "re-registering with critic changes nothing" "$(api POST /api/agents/register '{"name":"moneta","kind":"cowork","capabilities":["review","critic"]}' > /dev/null; api PATCH "/api/tasks/$S6" '{"agent":"moneta","status":"review"}')" 'only the critic'
check "role changes logged" "$(api GET /api/state)" '"type": "agent.roles_changed"'
# S2-c: once any roles exist, settings are the only source of lead and critic.
check "an agent absent from settings.agents has no lead (consul's capability ignored)" "$(api PATCH "/api/tasks/$S6" '{"agent":"consul","gate":"critic"}')" 'only the boss or the lead'
UPSTART=$(api POST /api/agents/register '{"name":"upstart","kind":"dummy","capabilities":["code","lead"]}')
check "registering with lead still succeeds" "$UPSTART" '"name": "upstart"'
check "the reply says settings govern the roles" "$UPSTART" 'settings govern lead, critic'
check "the capabilities are stored anyway" "$(agents_section | grep -A6 '"name": "upstart"')" '"lead"'
check "the capability log says the tag grants nothing" "$(api GET /api/state | grep -A12 '"name": "upstart"')" 'grant nothing'
check "a self-registered lead is ignored once roles exist" "$(api PATCH "/api/tasks/$S6" '{"agent":"upstart","gate":"critic"}')" 'only the boss or the lead'

check "null clears back to no settings" "$(api PATCH /api/settings '{"global":{"approval":null,"default_gate":null,"notify":null,"librarian":null},"projects":{"ops":null},"agents":{"menace":null,"moneta":null}}' | tr -d ' \n')" '"settings":{"global":{},"projects":{},"agents":{}}'
check "cleared: moneta's capability counts again" "$(api PATCH "/api/tasks/$S6" '{"agent":"moneta","status":"review","note":"parked by critic"}')" '"status": "review"'
S7=$(new_claimed "Settings: cleared" menace)
check "cleared: a self-registered lead counts again" "$(api PATCH "/api/tasks/$S7" '{"agent":"upstart","gate":"critic"}')" '"gate": "critic"'
api PATCH "/api/tasks/$S7" '{"agent":"menace","gate":"boss"}' > /dev/null
check "cleared: an agent closes boss-gate work done again" "$(api PATCH "/api/tasks/$S7" '{"agent":"menace","status":"done"}')" '"status": "done"'
check "cleared: a quote is refused again" "$(api PATCH "/api/tasks/$S5" '{"agent":"menace","status":"done","approved_in_session":"x"}')" 'does not accept chat approvals'

echo "12. curated compartments: knowledge/, recipes/, PROFILE.md and attic/ take only the boss, the librarian or a curator"
code () { # the status code only; the body through stdin, as api
  if [ -n "${3-}" ]; then printf '%s' "$3" | curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BUREAU_URL$2" -H "$AUTH" -H "$JSON" --data-binary @-
  else curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BUREAU_URL$2" -H "$AUTH" -H "$JSON"; fi
}
# A well-formed note (frontmatter, a sourced observation), so a write the wall
# lets through also passes write-time lint (section 12b covers lint itself)
kw () { echo "{\"file\":\"$1\",\"content\":\"---\\ntitle: Kettle probe\\ncompartment: $(basename "$(dirname "$1")")\\npermalink: kettle-probe\\nversion: 1\\n---\\n\\n- [fact] the kettle hums (fake) (source: t-1)\\n\",\"author\":\"$2\",\"message\":\"acl probe\"}"; }
mcpcall () { echo "{\"jsonrpc\":\"2.0\",\"id\":40,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"; }
for f in knowledge/kettle.md recipes/kettle.md entities/acme/knowledge/kettle.md entities/acme/recipes/kettle.md entities/acme/PROFILE.md attic/knowledge/kettle.md; do
  B=$(kw "$f" menace)
  check "a plain agent is refused on $f (403)" "$(code POST /api/knowledge "$B")" '^403$'
done
B=$(kw knowledge/kettle.md menace)
check "the refusal names the compartment and who may write" "$(api POST /api/knowledge "$B")" 'curated compartment knowledge/: only the boss, the librarian or a curator'
B=$(kw journal/../knowledge/sneak.md menace)
check "a traversal into knowledge/ is judged by where it lands" "$(code POST /api/knowledge "$B")" '^403$'
B=$(kw Knowledge/sneak.md menace)
check "case does not slip past the wall" "$(code POST /api/knowledge "$B")" '^403$'
B='{"file":"knowledge/anon.md","content":"x"}'
check "no author is refused too" "$(code POST /api/knowledge "$B")" '^403$'
check "a refused write left no file" "$(code GET '/api/knowledge?file=knowledge/kettle.md')" '^404$'
check "and no commit" "$(api GET /api/state | grep -c 'acl probe' || true)" '^0$'
for f in journal/2026-01-01.md daily/2026-01-01.md projects/ops/learnings.md entities/acme/notes.md archive/journal/old.md; do
  B=$(kw "$f" menace)
  check "$f stays open to any agent" "$(api POST /api/knowledge "$B")" '"bytes"'
done
B=$(kw knowledge/kettle.md human)
check "the boss writes knowledge/" "$(api POST /api/knowledge "$B")" '"bytes"'
api POST /api/agents/register '{"name":"shelver","kind":"cowork","capabilities":["curation","librarian"]}' > /dev/null
api POST /api/agents/register '{"name":"scribe","kind":"claude-code","capabilities":["curator"]}' > /dev/null
B=$(kw recipes/kettle.md shelver)
check "no roles in settings: the librarian tag writes recipes/" "$(api POST /api/knowledge "$B")" '"bytes"'
B=$(kw entities/acme/PROFILE.md scribe)
check "no roles in settings: the curator tag writes a PROFILE.md" "$(api POST /api/knowledge "$B")" '"bytes"'
MK=$(mcpcall write_knowledge '{"file":"knowledge/mcp-kettle.md","content":"- x","message":"acl probe mcp"}')
check "MCP write_knowledge to knowledge/ is refused while consul holds no curating role" "$(mcp "$MK")" 'curated compartment knowledge/'
check "the MCP refusal is an error result" "$(mcp "$MK")" '"isError": true'
check "and left no file" "$(code GET '/api/knowledge?file=knowledge/mcp-kettle.md')" '^404$'
MJ=$(mcpcall write_knowledge '{"file":"journal/2026-01-02.md","content":"- 09:00 [chat] probe","mode":"append"}')
check "MCP write_knowledge to journal/ stays open" "$(mcp "$MJ")" '"isError": false'

# Once roles live in settings, librarian and curator come from settings only
api PATCH /api/settings '{"agents":{"menace":{"roles":["lead"]}}}' > /dev/null
B=$(kw recipes/kettle-2.md shelver)
check "roles configured: the librarian tag alone no longer writes" "$(code POST /api/knowledge "$B")" '^403$'
B=$(kw knowledge/kettle-2.md scribe)
check "roles configured: the curator tag alone no longer writes" "$(code POST /api/knowledge "$B")" '^403$'
check "registering with librarian says the tag grants nothing" "$(api POST /api/agents/register '{"name":"shelver","kind":"cowork","capabilities":["curation","librarian"]}')" 'grant nothing'
check "librarian and curator are settings roles" "$(api PATCH /api/settings '{"agents":{"shelver":{"roles":["librarian"]},"consul":{"roles":["critic","lead","curator"]}}}')" '"curator"'
B=$(kw recipes/kettle-2.md shelver)
check "the settings librarian writes recipes/" "$(api POST /api/knowledge "$B")" '"bytes"'
MK2=$(mcpcall write_knowledge '{"file":"knowledge/mcp-kettle.md","content":"---\ntitle: MCP kettle\ncompartment: knowledge\npermalink: mcp-kettle\nversion: 1\n---\n\n- [fact] written over MCP (source: t-1)\n","message":"curated by consul"}')
check "consul as curator writes knowledge/ over MCP" "$(mcp "$MK2")" '"isError": false'
check "the commit is consul's" "$(api GET /api/state)" '"author": "consul"'
DG=$(tid "$(api POST /api/tasks '{"title":"shelver: nightly digest 2026-01-02","project":"ops","priority":3}')")
DGC="{\"agent\":\"shelver\",\"id\":\"$DG\"}"
api POST /api/tasks/claim "$DGC" > /dev/null
check "the settings librarian parks its own digest" "$(api PATCH "/api/tasks/$DG" '{"agent":"shelver","status":"review","note":"2 items"}')" '"status": "review"'
api PATCH "/api/tasks/$DG" '{"agent":"human","status":"done","note":"ruled"}' > /dev/null
api POST /api/agents/register '{"name":"tagonly","kind":"cowork","capabilities":["librarian"]}' > /dev/null
DT=$(tid "$(api POST /api/tasks '{"title":"tagonly: nightly digest","project":"ops","priority":3}')")
DTC="{\"agent\":\"tagonly\",\"id\":\"$DT\"}"
api POST /api/tasks/claim "$DTC" > /dev/null
check "roles configured: a librarian tag alone parks no digest" "$(api PATCH "/api/tasks/$DT" '{"agent":"tagonly","status":"review"}')" 'boss-gate'
api PATCH "/api/tasks/$DT" '{"agent":"tagonly","status":"discarded","note":"probe"}' > /dev/null
api PATCH /api/settings '{"agents":{"scribe":{"roles":["curator"]}}}' > /dev/null
DS=$(tid "$(api POST /api/tasks '{"title":"scribe: looks like a digest","project":"ops","priority":3}')")
DSC="{\"agent\":\"scribe\",\"id\":\"$DS\"}"
api POST /api/tasks/claim "$DSC" > /dev/null
check "a curator writes but parks no digest" "$(api PATCH "/api/tasks/$DS" '{"agent":"scribe","status":"review"}')" 'boss-gate'
api PATCH "/api/tasks/$DS" '{"agent":"scribe","status":"discarded","note":"probe"}' > /dev/null
check "an unknown role is still refused" "$(api PATCH /api/settings '{"agents":{"scribe":{"roles":["janitor"]}}}')" 'lead, critic, librarian, curator'
api PATCH /api/settings '{"agents":{"menace":null,"shelver":null,"consul":null,"scribe":null}}' > /dev/null

echo "12b. write-time lint: a curated write that would fail brain-lint is refused, nothing written"
# shelver holds the librarian tag and no roles are configured, so the wall lets it through
check "a note sourced by its file and by a mission id is accepted" "$(api POST /api/knowledge '{"file":"knowledge/lint-ok.md","author":"shelver","content":"---\ntitle: Lint probe\ncompartment: knowledge\npermalink: lint-ok\nversion: 1\nsource: t-1\n---\n\n- [step] covered by the file source\n- [fact] its own mission source (source: t-2)\n"}')" '"bytes"'
LB='{"file":"knowledge/lint-bad.md","author":"shelver","message":"lint probe bad","content":"---\ntitle: Lint bad\ncompartment: knowledge\npermalink: lint-bad\nversion: 1\n---\n\n- [fact] nobody knows where this came from\n"}'
check "an unsourced observation is refused (422)" "$(code POST /api/knowledge "$LB")" '^422$'
LR=$(api POST /api/knowledge "$LB")
check "the refusal lists the lint error" "$LR" 'knowledge/lint-bad.md: unsourced observation'
check "and says how to fix it" "$LR" 'needs a source'
check "the refused write left no file" "$(code GET '/api/knowledge?file=knowledge/lint-bad.md')" '^404$'
check "and no commit" "$(api GET /api/state | grep -c 'lint probe bad' || true)" '^0$'
check "a malformed file-level source is refused" "$(api POST /api/knowledge '{"file":"knowledge/lint-ref.md","author":"shelver","content":"---\ntitle: Lint ref\ncompartment: knowledge\npermalink: lint-ref\nversion: 1\nsource: the boss said so\n---\n\n- [fact] covered by nothing\n"}')" 'malformed ref'
api POST /api/knowledge '{"file":"knowledge/lint-strict.md","author":"shelver","content":"---\ntitle: Lint strict\ncompartment: knowledge\npermalink: lint-strict\nversion: 1\n---\n\n- [fact] sourced on its own line (source: t-3)\n"}' > /dev/null
check "an append that would add an unsourced line is refused" "$(code POST /api/knowledge '{"file":"knowledge/lint-strict.md","author":"shelver","mode":"append","content":"- [fact] appended without a source"}')" '^422$'
check "and the file is unchanged" "$(api GET '/api/knowledge?file=knowledge/lint-strict.md' | grep -c 'appended without' || true)" '^0$'
LF='{"file":"knowledge/lint-bad.md","author":"shelver","force":true,"content":"---\ntitle: Lint bad\ncompartment: knowledge\npermalink: lint-bad\nversion: 1\n---\n\n- [fact] nobody knows where this came from\n"}'
check "force from an agent changes nothing (422)" "$(code POST /api/knowledge "$LF")" '^422$'
LH='{"file":"knowledge/lint-bad.md","author":"human","force":true,"content":"---\ntitle: Lint bad\ncompartment: knowledge\npermalink: lint-bad\nversion: 1\n---\n\n- [fact] nobody knows where this came from\n"}'
check "the boss can force a write past lint" "$(api POST /api/knowledge "$LH")" '"forced"'
check "and the override is logged" "$(api GET /api/state)" 'knowledge.forced'
check "journal/ stays free text" "$(api POST /api/knowledge '{"file":"journal/2026-01-03.md","author":"menace","content":"- [lesson] anything goes here, no source needed"}')" '"bytes"'
api PATCH /api/settings '{"agents":{"consul":{"roles":["curator"]}}}' > /dev/null
ML=$(mcpcall write_knowledge '{"file":"knowledge/mcp-lint.md","content":"---\ntitle: MCP lint\ncompartment: knowledge\npermalink: mcp-lint\nversion: 1\n---\n\n- [fact] no source over MCP either\n"}')
MLR=$(mcp "$ML")
check "MCP write_knowledge meets the same lint" "$MLR" '"isError": true'
check "with the lint error in the result" "$MLR" 'unsourced observation'
api PATCH /api/settings '{"agents":{"consul":null}}' > /dev/null

echo "13. the work store: a mission's evidence, plain files, gone when the mission closes"
PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
wb () { echo "{\"file\":\"$1\",\"content\":\"$2\"${3:+,\"encoding\":\"base64\"}}"; }
W1=$(tid "$(api POST /api/tasks '{"title":"Photograph the kettle","project":"ops","priority":4,"gate":"critic"}')")
W1C="{\"agent\":\"menace\",\"id\":\"$W1\"}"
api POST /api/tasks/claim "$W1C" > /dev/null
B=$(wb "work/$W1/notes.md" "first line")
check "text evidence written" "$(api POST /api/work "$B")" "\"file\": \"work/$W1/notes.md\""
B="{\"file\":\"work/$W1/notes.md\",\"content\":\"second line\",\"mode\":\"append\"}"
api POST /api/work "$B" > /dev/null
check "append and read back" "$(api GET "/api/work?file=work/$W1/notes.md")" 'first line\\nsecond line'
B=$(wb "work/$W1/shot.png" "$PNG_B64" b64)
check "a base64 screenshot is accepted" "$(api POST /api/work "$B")" '"bytes"'
check "binary read returns base64" "$(api GET "/api/work?file=work/$W1/shot.png")" 'content_base64'
check "raw read serves image/png" "$(curl -si "$BUREAU_URL/api/work?file=work/$W1/shot.png&raw=1" -H "$AUTH" | LC_ALL=C tr -d '\r')" 'content-type: image/png'
B="{\"file\":\"work/$W1/shot.png\",\"content\":\"$PNG_B64\",\"encoding\":\"base64\",\"mode\":\"append\"}"
check "base64 append refused" "$(api POST /api/work "$B")" 'replace-only'
B=$(wb "work/$W1/tool.exe" "x")
check "off-whitelist extension refused (400)" "$(code POST /api/work "$B")" '^400$'
B=$(wb "work/$W1/../t-1/escape.md" "x")
check "traversal out of the mission folder refused" "$(code POST /api/work "$B")" '^400$'
B=$(wb "projects/ops/escape.md" "x")
check "a path outside work/<t-id>/ refused" "$(api POST /api/work "$B")" 'work/<t-id>/<name>'
B=$(wb "work/t-999999/x.md" "x")
check "an unknown mission is 404" "$(code POST /api/work "$B")" '^404$'
check "listing by mission" "$(api GET "/api/work?task=$W1")" "work/$W1/shot.png"
check "evidence is not in the brain" "$(api GET /api/knowledge | grep -c 'shot.png' || true)" '^0$'
check "and not committed" "$(api GET /api/state | grep -c "work/$W1" || true)" '^0$'
B=$(wb "work/$W1/extra.png" "$PNG_B64" b64)
api POST /api/work "$B" > /dev/null
W2=$(tid "$(api POST /api/tasks '{"title":"Another open mission","project":"ops","priority":5,"gate":"critic"}')")
B=$(wb "work/$W2/theirs.png" "$PNG_B64" b64)
api POST /api/work "$B" > /dev/null
ART="{\"agent\":\"menace\",\"artifact\":{\"label\":\"kettle shot\",\"url\":\"work/$W1/shot.png\"}}"
api PATCH "/api/tasks/$W1" "$ART" > /dev/null
ART2="{\"agent\":\"menace\",\"artifact\":{\"label\":\"borrowed\",\"url\":\"work/$W2/theirs.png\"},\"status\":\"review\",\"note\":\"evidence attached\"}"
api PATCH "/api/tasks/$W1" "$ART2" > /dev/null
WT=$(api GET "/api/tasks/$W1" | grep -A2 '"approve"' | grep -o '"token": "[a-f0-9]*"' | grep -o '[a-f0-9]\{32\}')
WPAGE=$(curl -s "$BUREAU_URL/r/$WT")
check "the review page shows the cited work image" "$WPAGE" "work%2F$W1%2Fshot.png"
check "and the mission's uncited work image" "$WPAGE" "work%2F$W1%2Fextra.png"
check "but not another mission's, even cited" "$(echo "$WPAGE" | grep -c "theirs.png" || true)" '^0$'
check "the link serves its own work image" "$(curl -si "$BUREAU_URL/r/$WT/img?file=work/$W1/extra.png" | LC_ALL=C tr -d '\r')" 'content-type: image/png'
check "the link refuses another mission's work image" "$(curl -s -o /dev/null -w '%{http_code}' "$BUREAU_URL/r/$WT/img?file=work/$W2/theirs.png")" '404'
check "evidence survives while the mission is in review" "$(code GET "/api/work?file=work/$W1/shot.png")" '^200$'
check "approve via the link" "$(curl -s -X POST "$BUREAU_URL/r/$WT")" 'Approved'
check "closed by a review link: the evidence is gone" "$(code GET "/api/work?file=work/$W1/shot.png")" '^404$'
check "the whole folder is gone" "$(api GET "/api/work?task=$W1" | grep -c "work/$W1" || true)" '^0$'
check "another mission's evidence is untouched" "$(code GET "/api/work?file=work/$W2/theirs.png")" '^200$'
B=$(wb "work/$W1/late.md" "x")
check "a closed mission takes no new evidence (409)" "$(code POST /api/work "$B")" '^409$'
for st in done failed discarded; do
  WX=$(tid "$(api POST /api/tasks '{"title":"Close path probe","project":"ops","priority":5,"gate":"critic"}')")
  WXC="{\"agent\":\"menace\",\"id\":\"$WX\"}"
  api POST /api/tasks/claim "$WXC" > /dev/null
  B=$(wb "work/$WX/log.txt" "probe")
  api POST /api/work "$B" > /dev/null
  WXS="{\"agent\":\"menace\",\"status\":\"$st\",\"note\":\"probe\"}"
  api PATCH "/api/tasks/$WX" "$WXS" > /dev/null
  check "closed $st by PATCH: the evidence is gone" "$(code GET "/api/work?file=work/$WX/log.txt")" '^404$'
done
WB=$(tid "$(api POST /api/tasks '{"title":"Blocked keeps evidence","project":"ops","priority":5,"gate":"critic"}')")
WBC="{\"agent\":\"menace\",\"id\":\"$WB\"}"
api POST /api/tasks/claim "$WBC" > /dev/null
B=$(wb "work/$WB/log.txt" "probe")
api POST /api/work "$B" > /dev/null
api PATCH "/api/tasks/$WB" '{"agent":"menace","status":"blocked","note":"waiting on: probe"}' > /dev/null
check "blocked keeps the evidence" "$(code GET "/api/work?file=work/$WB/log.txt")" '^200$'
api PATCH "/api/tasks/$WB" '{"agent":"human","status":"discarded","note":"probe"}' > /dev/null
check "the boss's discard removes it" "$(code GET "/api/work?file=work/$WB/log.txt")" '^404$'
check "tools listed include the work store" "$(mcp '{"jsonrpc":"2.0","id":41,"method":"tools/list"}')" 'write_work'
WM=$(mcp '{"jsonrpc":"2.0","id":42,"method":"tools/call","params":{"name":"create_mission","arguments":{"title":"MCP evidence probe","project":"ops"}}}')
WMID=$(echo "$WM" | grep -o 't-[0-9]*' | head -1)
WMS=$(mcpcall start_mission "{\"id\":\"$WMID\"}")
mcp "$WMS" > /dev/null
WMW=$(mcpcall write_work "{\"file\":\"work/$WMID/chat.png\",\"content\":\"$PNG_B64\",\"encoding\":\"base64\"}")
check "MCP write_work stores evidence" "$(mcp "$WMW")" '\\"bytes\\"'
WMR=$(mcpcall read_work "{\"task\":\"$WMID\"}")
check "MCP read_work lists it" "$(mcp "$WMR")" "work/$WMID/chat.png"
WMD=$(mcpcall update_mission "{\"id\":\"$WMID\",\"status\":\"done\",\"note\":\"probe\"}")
mcp "$WMD" > /dev/null
check "closed over MCP: the evidence is gone" "$(code GET "/api/work?file=work/$WMID/chat.png")" '^404$'
check "MCP write_work to a closed mission is refused" "$(mcp "$WMW")" '"isError": true'

echo "14. approval pins the text: payloads, the approved status, apply"
sha256 () { if command -v sha256sum > /dev/null; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi; }
# The hub hashes the canonical JSON of ops: each op exactly {op, file, content}.
# The item below sends its keys in another order on purpose.
# The content is a well-formed note, since curated payloads are linted when filed.
CANON='[{"op":"write","file":"knowledge/m4-kettle.md","content":"---\ntitle: M4 kettle\ncompartment: knowledge\npermalink: m4-kettle\nversion: 1\n---\n\n- [fact] the kettle hums at 3am (fake) (source: t-1)\n"}]'
H1=$(printf '%s' "$CANON" | sha256)
P1=$(new_claimed "M4: pinned digest" menace)
P1ITEMS='{"agent":"menace","items":[{"title":"Add the kettle fact","body":"from the journal","payload":{"ops":[{"content":"---\ntitle: M4 kettle\ncompartment: knowledge\npermalink: m4-kettle\nversion: 1\n---\n\n- [fact] the kettle hums at 3am (fake) (source: t-1)\n","file":"knowledge/m4-kettle.md","op":"write"}]}},{"title":"Log it","payload":{"ops":[{"op":"append","file":"projects/ops/m4-log.md","content":"- kettle fact filed (fake)"}]}},{"title":"A question","body":"keep the attic copy?"}]}'
P1R=$(api PATCH "/api/tasks/$P1" "$P1ITEMS")
check "an item with a payload is filed" "$P1R" '"title": "Add the kettle fact"'
check "the payload hash is stored at filing, over the canonical ops" "$P1R" "\"payload_sha256\": \"$H1\""
P1TAMPER='{"agent":"menace","items":[{"id":"i1","title":"Add the kettle fact","payload":{"ops":[{"op":"write","file":"knowledge/m4-kettle.md","content":"tampered"}]}}]}'
check "a later items PATCH cannot rewrite a filed payload" "$(api PATCH "/api/tasks/$P1" "$P1TAMPER")" 'payload is pinned'
check "the stored hash is unchanged" "$(api GET "/api/tasks/$P1")" "\"payload_sha256\": \"$H1\""
check "and no item was added" "$(api GET "/api/tasks/$P1" | grep -c '"id": "i4"' || true)" '^0$'
B='{"agent":"menace","items":[{"title":"bad op","payload":{"ops":[{"op":"move","file":"knowledge/x.md","content":"x"}]}}]}'
check "an unknown op is refused" "$(api PATCH "/api/tasks/$P1" "$B")" 'use one of write, append'
B='{"agent":"menace","items":[{"title":"bad path","payload":{"ops":[{"op":"write","file":"journal/../../escape.md","content":"x"}]}}]}'
check "a payload path is validated like a knowledge path" "$(api PATCH "/api/tasks/$P1" "$B")" 'bad path'
B='{"agent":"menace","items":[{"title":"binary","payload":{"ops":[{"op":"write","file":"projects/ops/x.png","content":"x"}]}}]}'
check "a binary target is refused" "$(api PATCH "/api/tasks/$P1" "$B")" 'text files only'
B='{"agent":"menace","items":[{"title":"empty","payload":{"ops":[]}}]}'
check "an empty payload is refused" "$(api PATCH "/api/tasks/$P1" "$B")" 'at least one op'
check "refused payloads added no item" "$(api GET "/api/tasks/$P1" | grep -c '"id": "i4"' || true)" '^0$'
B="{\"file\":\"work/$P1/draft.md\",\"content\":\"the staged draft\"}"
api POST /api/work "$B" > /dev/null
B='{"agent":"menace","status":"in_progress","after_approval":"return"}'
check "after_approval rides only a move into review" "$(api PATCH "/api/tasks/$P1" "$B")" 'rides the PATCH that moves'
B='{"agent":"consul","status":"review","after_approval":"later"}'
check "after_approval takes only return" "$(api PATCH "/api/tasks/$P1" "$B")" 'the only value is'
B='{"agent":"menace","item":"i1"}'
check "apply refused while the mission is in progress" "$(api POST "/api/tasks/$P1/apply" "$B")" 'only an approved mission applies'
B='{"agent":"consul","status":"review","after_approval":"return","note":"3 items, 2 with payloads"}'
P1PARK=$(api PATCH "/api/tasks/$P1" "$B")
check "parked in review with after_approval return" "$P1PARK" '"after_approval": "return"'
check "parking issued review links" "$P1PARK" '"review_links"'
B='{"agent":"human","status":"done","note":"approved","verdicts":[{"id":"i1","verdict":"approved"},{"id":"i2","verdict":"approved"}]}'
check "approve with an undecided item is refused on PATCH (400)" "$(code PATCH "/api/tasks/$P1" "$B")" '^400$'
check "the refusal names the undecided item" "$(api PATCH "/api/tasks/$P1" "$B")" 'undecided items: i3'
P1D=$(api GET "/api/tasks/$P1")
check "the refused approve changed nothing: still in review" "$P1D" '"status": "review"'
check "and its verdicts were not recorded" "$(echo "$P1D" | grep -c '"verdict": "approved"' || true)" '^0$'
P1AP=$(echo "$P1D" | grep -A2 '"approve"' | grep -o '"token": "[a-f0-9]*"' | grep -o '[a-f0-9]\{32\}')
P1PAGE=$(curl -s "$BUREAU_URL/r/$P1AP")
check "the review page says approving returns the mission to its agent" "$P1PAGE" 'Approving returns this mission to menace'
check "the review page shows the exact payload text" "$P1PAGE" 'the kettle hums at 3am'
check "approve with an undecided item is refused on the review link (400)" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BUREAU_URL/r/$P1AP" --data 'v_i1=approved&v_i2=approved')" '^400$'
check "the link page names the undecided item" "$(curl -s -X POST "$BUREAU_URL/r/$P1AP" --data 'v_i1=approved&v_i2=approved')" 'undecided items: i3'
check "still in review after the refused link" "$(api GET "/api/tasks/$P1")" '"status": "review"'
check "approve via the link with every item decided" "$(curl -s -X POST "$BUREAU_URL/r/$P1AP" --data 'v_i1=approved&v_i2=approved&v_i3=rejected&c_i3=no+attic+copy')" 'Back with menace'
P1D=$(api GET "/api/tasks/$P1")
check "after_approval return lands on approved, not done" "$P1D" '"status": "approved"'
check "the holder keeps the mission" "$P1D" '"assignee": "menace"'
check "approved holds no lease" "$P1D" '"lease_until": null'
check "the approve is logged from review" "$(echo "$P1D" | grep -A4 '"note": "approved via link"')" '"from": "review"'
check "to approved" "$(echo "$P1D" | grep -A4 '"note": "approved via link"')" '"to": "approved"'
check "with kind approve" "$(echo "$P1D" | grep -A4 '"note": "approved via link"')" '"kind": "approve"'
check "the work folder survives the approval" "$(api GET "/api/work?file=work/$P1/draft.md")" 'the staged draft'
B="{\"file\":\"work/$P1/after.md\",\"content\":\"x\"}"
check "the work store still takes writes" "$(code POST /api/work "$B")" '^200$'
B="{\"agent\":\"worker-z\",\"id\":\"$P1\"}"
check "an approved mission is not claimable" "$(api POST /api/tasks/claim "$B")" 'not claimable (status: approved)'
check "approved is a listed status" "$(api GET '/api/tasks?status=approved')" "\"id\": \"$P1\""
B='{"agent":"menace","item":"i3"}'
check "apply refuses an item that is not approved (409)" "$(code POST "/api/tasks/$P1/apply" "$B")" '^409$'
check "and says why" "$(api POST "/api/tasks/$P1/apply" "$B")" 'i3 is rejected, not approved'
B='{"agent":"worker-z","item":"i1"}'
check "apply refuses a caller who is not the holder (403)" "$(code POST "/api/tasks/$P1/apply" "$B")" '^403$'
B='{"agent":"menace","item":"i9"}'
check "apply refuses an unknown item (404)" "$(code POST "/api/tasks/$P1/apply" "$B")" '^404$'
B='{"agent":"menace","status":"done","note":"closing"}'
check "close to done refused while approved items are unapplied" "$(api PATCH "/api/tasks/$P1" "$B")" 'apply i1, i2 before closing'
B='{"agent":"worker-z","status":"done"}'
check "only the holder or the boss closes an approved mission" "$(api PATCH "/api/tasks/$P1" "$B")" 'only its holder (menace)'
B='{"agent":"menace","status":"queued"}'
check "no send-back from approved" "$(api PATCH "/api/tasks/$P1" "$B")" 'its holder applies the approved items'
B='{"agent":"menace","items":[{"title":"late idea"}]}'
check "an approved mission takes no new items" "$(api PATCH "/api/tasks/$P1" "$B")" 'file new ones on a new mission'
B=$(kw knowledge/m4-kettle.md menace)
check "menace cannot write knowledge/ directly (403)" "$(code POST /api/knowledge "$B")" '^403$'
B='{"agent":"menace","item":"i1"}'
P1A=$(api POST "/api/tasks/$P1/apply" "$B")
check "the holder applies the approved payload into knowledge/" "$P1A" '"applied_by": "menace"'
check "the item records when" "$P1A" '"applied_at": "'
check "the item records the commit field" "$P1A" '"commit": '
check "the item records the hash it applied" "$P1A" "\"payload_sha256\": \"$H1\""
check "the applied text reads back" "$(api GET '/api/knowledge?file=knowledge/m4-kettle.md')" 'the kettle hums at 3am (fake) (source: t-1)\\n"'
P1RAW=$(curl -s "$BUREAU_URL/api/knowledge?file=knowledge/m4-kettle.md&raw=1" -H "$AUTH"; echo x)
P1WANT=$(printf -- '---\ntitle: M4 kettle\ncompartment: knowledge\npermalink: m4-kettle\nversion: 1\n---\n\n- [fact] the kettle hums at 3am (fake) (source: t-1)\nx')
check "the bytes on disk are exactly the payload" "$([ "$P1RAW" = "$P1WANT" ] && echo identical)" '^identical$'
check "the write is committed as the caller" "$(api GET /api/state)" "$P1 i1: apply the boss-approved write to knowledge/m4-kettle.md"
check "the apply is logged on the mission" "$(api GET "/api/tasks/$P1")" 'applied i1: write knowledge/m4-kettle.md (sha256 '
check "applying twice is refused (409)" "$(code POST "/api/tasks/$P1/apply" "$B")" '^409$'
check "and says it was applied" "$(api POST "/api/tasks/$P1/apply" "$B")" 'was applied at'
B='{"agent":"human","verdicts":[{"id":"i1","verdict":"rejected"}]}'
check "an applied item's verdict cannot be flipped" "$(api PATCH "/api/tasks/$P1" "$B")" 'already applied'
B='{"agent":"menace","status":"done","note":"closing"}'
check "close still refused with i2 unapplied" "$(api PATCH "/api/tasks/$P1" "$B")" 'apply i2 before closing'
B='{"agent":"menace","item":"i2"}'
check "the append payload applies" "$(api POST "/api/tasks/$P1/apply" "$B")" '"applied_by": "menace"'
check "and reads back" "$(api GET '/api/knowledge?file=projects/ops/m4-log.md')" 'kettle fact filed (fake)'
B='{"agent":"menace","status":"done","note":"i1 and i2 applied"}'
check "close to done accepted once every approved item is applied" "$(api PATCH "/api/tasks/$P1" "$B")" '"status": "done"'
check "closing done removes the work folder" "$(code GET "/api/work?file=work/$P1/draft.md")" '^404$'
B='{"agent":"menace","item":"i2"}'
check "apply on a closed mission is refused" "$(api POST "/api/tasks/$P1/apply" "$B")" 'only an approved mission applies'
# Backward compatibility: without after_approval an approve still closes done
P2=$(new_claimed "M4: no opt-in" menace)
B='{"agent":"menace","items":[{"title":"Fact with a payload","payload":{"ops":[{"op":"write","file":"projects/ops/m4-plain.md","content":"x"}]}}]}'
api PATCH "/api/tasks/$P2" "$B" > /dev/null
B="{\"file\":\"work/$P2/draft.md\",\"content\":\"x\"}"
api POST /api/work "$B" > /dev/null
B='{"agent":"consul","status":"review","note":"parked"}'
check "parked without after_approval" "$(api PATCH "/api/tasks/$P2" "$B" | grep -c '"after_approval"' || true)" '^0$'
B='{"agent":"human","status":"done","note":"approved","verdicts":[{"id":"i1","verdict":"approved"}]}'
check "approve without after_approval still closes done" "$(api PATCH "/api/tasks/$P2" "$B")" '"status": "done"'
check "and its work folder goes, as before" "$(code GET "/api/work?file=work/$P2/draft.md")" '^404$'
B='{"agent":"human","status":"approved"}'
P3=$(new_claimed "M4: explicit approved" menace)
check "status approved is refused outside review" "$(api PATCH "/api/tasks/$P3" "$B")" 'only a mission in review'
api PATCH "/api/tasks/$P3" '{"agent":"consul","status":"review"}' > /dev/null
check "status approved needs after_approval return" "$(api PATCH "/api/tasks/$P3" "$B")" 'after_approval'
api PATCH "/api/tasks/$P3" '{"agent":"human","status":"done"}' > /dev/null
# The MCP door: the same rule, and the new tool
check "MCP update_mission advertises after_approval" "$(mcp '{"jsonrpc":"2.0","id":50,"method":"tools/list"}')" 'after_approval'
check "MCP lists apply_item" "$(mcp '{"jsonrpc":"2.0","id":51,"method":"tools/list"}')" 'apply_item'
MA=$(mcp '{"jsonrpc":"2.0","id":52,"method":"tools/call","params":{"name":"create_mission","arguments":{"title":"M4: MCP undecided","project":"ops","gate":"critic"}}}')
MAID=$(echo "$MA" | grep -o 't-[0-9]*' | head -1)
MB=$(mcpcall start_mission "{\"id\":\"$MAID\"}")
mcp "$MB" > /dev/null
MB=$(mcpcall update_mission "{\"id\":\"$MAID\",\"items\":[{\"title\":\"Open question\"}]}")
mcp "$MB" > /dev/null
MB=$(mcpcall update_mission "{\"id\":\"$MAID\",\"status\":\"review\",\"after_approval\":\"return\"}")
mcp "$MB" > /dev/null
MB=$(mcpcall update_mission "{\"id\":\"$MAID\",\"status\":\"done\"}")
check "MCP: an approval with an undecided item is refused" "$(mcp "$MB")" 'undecided items: i1'
MB=$(mcpcall apply_item "{\"task\":\"$MAID\",\"item\":\"i1\"}")
check "MCP apply_item on a mission in review is refused" "$(mcp "$MB")" '"isError": true'
B='{"agent":"human","status":"done","verdicts":[{"id":"i1","verdict":"rejected"}]}'
check "decided, a critic-gate approval with after_approval lands on approved" "$(api PATCH "/api/tasks/$MAID" "$B")" '"status": "approved"'
MB=$(mcpcall update_mission "{\"id\":\"$MAID\",\"status\":\"done\",\"note\":\"nothing approved to apply\"}")
check "MCP: nothing to apply, consul closes it done" "$(mcp "$MB")" '\\"status\\": \\"done\\"'

echo "14b. Later is a ruling; curated payloads are linted when filed"
L1=$(new_claimed "M4: one item deferred" menace)
api PATCH "/api/tasks/$L1" '{"agent":"menace","items":[{"title":"Defer me"},{"title":"Take me"}]}' > /dev/null
api PATCH "/api/tasks/$L1" '{"agent":"consul","status":"review"}' > /dev/null
LTOK=$(api GET "/api/tasks/$L1" | grep -A2 '"approve"' | grep -o '"token": "[a-f0-9]*"' | grep -o '[a-f0-9]\{32\}')
check "on the review page, items nobody ruled on start with no choice selected" "$(curl -s "$BUREAU_URL/r/$LTOK" | grep -c ' checked' || true)" '^0$'
check "the page offers Later as a verdict" "$(curl -s "$BUREAU_URL/r/$LTOK")" 'value="later"'
B='{"agent":"human","status":"done","note":"approved","verdicts":[{"id":"i1","verdict":"later"},{"id":"i2","verdict":"approved"}]}'
check "an approval with one item deferred (later) goes through" "$(api PATCH "/api/tasks/$L1" "$B")" '"status": "done"'
check "the deferred item keeps the verdict later" "$(api GET "/api/tasks/$L1" | grep -A3 '"title": "Defer me"')" '"verdict": "later"'
F1=$(new_claimed "M4: lint at filing" menace)
B='{"agent":"menace","items":[{"title":"Unsourced note","payload":{"ops":[{"op":"write","file":"knowledge/m4-unsourced.md","content":"---\ntitle: Unsourced\ncompartment: knowledge\npermalink: m4-unsourced\nversion: 1\n---\n\n- [fact] no source here\n"}]}}]}'
check "a curated payload that would fail lint is refused at filing" "$(api PATCH "/api/tasks/$F1" "$B")" 'would fail brain-lint'
check "and no item was filed" "$(api GET "/api/tasks/$F1" | grep -c '"id": "i1"' || true)" '^0$'
B='{"agent":"menace","items":[{"title":"Free note","payload":{"ops":[{"op":"append","file":"projects/ops/m4-free.md","content":"- [lesson] no source needed here"}]}}]}'
check "a payload outside the curated folders is not linted" "$(api PATCH "/api/tasks/$F1" "$B")" '"title": "Free note"'
api PATCH "/api/tasks/$F1" '{"agent":"menace","status":"discarded","note":"probe"}' > /dev/null

echo "15. typed capture: JSON in, one claim block in the journal day, JSON out"
# Two checks read the stored Markdown with the hub's own reader (node, no hub
# code beyond lib/claims.js); everything else is curl.
CLAIMS_JS="$(cd "$(dirname "$0")/.." && pwd)/hub/lib/claims.js"
parse_day () { # stdin: a day file -> "<format> <n> errors <n> claims"
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=require(process.argv[1]).parseFile(s,{path:"journal/"+process.argv[2]+".md"});console.log(r.format+" "+r.errors.length+" errors "+r.claims.length+" claims")})' "$CLAIMS_JS" "$1"
}
same_record () { # same_record <sent json> <GET body>: "matches" when one record carries exactly what was sent
  node -e 'const sent=JSON.parse(process.argv[1]),got=JSON.parse(process.argv[2]).records;const r=got.find(x=>x.text===sent.text);const same=r&&r.kind===sent.kind&&r.fields.evidence===sent.evidence&&JSON.stringify(r.tags)===JSON.stringify(sent.tags||[])&&r.fields.confidence===(sent.confidence||"observed")&&r.fields.by===sent.agent;console.log(same?"matches":"differs: "+JSON.stringify(r))' "$1" "$2"
}
TODAY=$(date -u +%Y-%m-%d)
api POST /api/agents/register '{"name":"scrivener","kind":"dummy"}' > /dev/null
# Cutover: today's day starts as v0.2 free text, then takes its first capture
B="{\"file\":\"journal/$TODAY.md\",\"content\":\"- 09:00 [scrivener] a v0.2 line, free text (fake)\",\"mode\":\"append\",\"author\":\"scrivener\"}"
api POST /api/knowledge "$B" > /dev/null
V02_BEFORE=$(curl -s "$BUREAU_URL/api/knowledge?file=journal/$TODAY.md&raw=1" -H "$AUTH"; echo x)
C0='{"agent":"scrivener","kind":"fact","text":"the kettle hums at 3am (fake)","evidence":"heard it on the night shift"}'
C0R=$(api POST /api/journal "$C0")
check "a capture is accepted and returned as a long-form record" "$C0R" '"form": "long"'
check "stamped with a j- id" "$C0R" '"id": "j-[a-z0-9]\{8\}"'
check "by the agent" "$C0R" '"by": "scrivener"'
check "at, in UTC to the minute" "$C0R" "\"at\": \"${TODAY}T[0-9][0-9]:[0-9][0-9]Z\""
check "confidence defaults to observed" "$C0R" '"confidence": "observed"'
check "an agent holding no mission gets no mission line" "$(echo "$C0R" | grep -c '"mission"' || true)" '^0$'
C0ID=$(echo "$C0R" | grep -o '"id": "j-[a-z0-9]*"' | head -1 | grep -o 'j-[a-z0-9]*')
V02_AFTER=$(curl -s "$BUREAU_URL/api/knowledge?file=journal/$TODAY.v02.md&raw=1" -H "$AUTH"; echo x)
check "cutover: the v0.2 day moved to .v02.md, byte for byte" "$([ "$V02_BEFORE" = "$V02_AFTER" ] && echo identical)" '^identical$'
check "cutover: the move is a commit of its own" "$(api GET /api/state)" "moved to journal/$TODAY.v02.md before its first typed capture"
DAY=$(api GET "/api/knowledge?file=journal/$TODAY.md")
check "the new day file carries format 0.3" "$DAY" 'format: 0.3'
check "and its title" "$DAY" "title: Journal $TODAY"
check "and holds the record" "$DAY" "\\^$C0ID"
check "and none of the v0.2 text" "$(echo "$DAY" | grep -c 'a v0.2 line' || true)" '^0$'
check "the capture is an activity line" "$(api GET /api/state)" '"type": "journal.captured"'
JM=$(tid "$(api POST /api/tasks '{"title":"Journal probe","project":"ops","priority":5,"gate":"critic"}')")
B="{\"agent\":\"scrivener\",\"id\":\"$JM\"}"
api POST /api/tasks/claim "$B" > /dev/null
C1='{"agent":"scrivener","kind":"gotcha","text":"Quote \"smart\" and (parens), #hash, a URL https://example.com/a?b=1#c, café 🚀 `code: x`","evidence":"seen twice: once by hand (fake)","tags":["deploy","lftp"],"confidence":"stated"}'
C1R=$(api POST /api/journal "$C1")
check "the one mission the agent holds is stamped" "$C1R" "\"mission\": \"$JM\""
check "confidence as sent" "$C1R" '"confidence": "stated"'
JG=$(api GET "/api/journal?mission=$JM")
check "GET returns the record, and its JSON matches what was sent" "$(same_record "$C1" "$JG")" '^matches$'
check "GET filters by kind and author" "$(api GET "/api/journal?kind=fact&author=scrivener")" "\"id\": \"$C0ID\""
check "a filter that matches nothing returns no records" "$(api GET "/api/journal?kind=fact&author=nobody" | tr -d ' \n')" '"records":\[\]'
check "GET by day" "$(api GET "/api/journal?day=$TODAY")" "\"id\": \"$C0ID\""
check "since in the future returns nothing" "$(api GET '/api/journal?since=2999-01-01' | tr -d ' \n')" '"records":\[\]'
check "a bad day is refused (400)" "$(code GET '/api/journal?day=yesterday')" '^400$'
check "GET never reads the .v02 file" "$(api GET "/api/journal?day=$TODAY" | grep -c 'a v0.2 line' || true)" '^0$'
check "the day file reads with claims.parseFile, no errors" "$(curl -s "$BUREAU_URL/api/knowledge?file=journal/$TODAY.md&raw=1" -H "$AUTH" | parse_day "$TODAY")" '^0.3 0 errors 2 claims$'
JM2=$(tid "$(api POST /api/tasks '{"title":"Journal probe 2","project":"ops","priority":5,"gate":"critic"}')")
B="{\"agent\":\"scrivener\",\"id\":\"$JM2\"}"
api POST /api/tasks/claim "$B" > /dev/null
B="{\"agent\":\"scrivener\",\"kind\":\"step\",\"text\":\"pick the second desk (fake)\",\"evidence\":\"two missions held\",\"mission\":\"$JM2\"}"
check "holding several, the body's mission picks one" "$(api POST /api/journal "$B")" "\"mission\": \"$JM2\""
B='{"agent":"scrivener","kind":"step","text":"no pick among two (fake)","evidence":"two missions held"}'
check "holding several without a pick: no mission line" "$(api POST /api/journal "$B" | grep -c '"mission"' || true)" '^0$'
COUNT_BEFORE=$(api GET '/api/journal?author=scrivener' | grep -c '"id": "j-')
refused () { # refused <label> <body> <code>
  check "refused: $1 (400)" "$(code POST /api/journal "$2")" '^400$'
  check "refused: $1 names $3" "$(api POST /api/journal "$2")" "\"code\": \"$3\""
}
refused "a kind outside the list" '{"agent":"scrivener","kind":"hunch","text":"x (fake)","evidence":"y"}' E_KIND
refused "missing evidence" '{"agent":"scrivener","kind":"fact","text":"x (fake)"}' E_EVIDENCE
refused "a line break in the text" '{"agent":"scrivener","kind":"fact","text":"one\ntwo (fake)","evidence":"y"}' E_WRAP
refused "an id in the text" '{"agent":"scrivener","kind":"fact","text":"see ^j-1a2b3c4d (fake)","evidence":"y"}' E_ID
LONG=$(printf 'x%.0s' $(seq 1 2001))
B="{\"agent\":\"scrivener\",\"kind\":\"fact\",\"text\":\"$LONG\",\"evidence\":\"y\"}"
refused "text over 2000 characters" "$B" E_TOO_LONG
refused "an unknown key" '{"agent":"scrivener","kind":"fact","text":"x (fake)","evidence":"y","colour":"blue"}' E_FIELD
for k in id by at; do
  B="{\"agent\":\"scrivener\",\"kind\":\"fact\",\"text\":\"x (fake)\",\"evidence\":\"y\",\"$k\":\"forged\"}"
  refused "$k sent by the writer" "$B" E_FIELD
done
check "the refusal says the hub stamps it" "$(api POST /api/journal '{"agent":"scrivener","kind":"fact","text":"x","evidence":"y","by":"someone"}')" 'stamped by the hub'
B='{"agent":"scrivener","kind":"fact","text":"x (fake)","evidence":"y","mission":"t-1"}'
refused "a mission the agent does not hold" "$B" E_MISSION
refused "an agent not on the roster" '{"agent":"nobody-here","kind":"fact","text":"x (fake)","evidence":"y"}' E_AGENT
check "refused captures wrote nothing" "$(api GET '/api/journal?author=scrivener' | grep -c '"id": "j-')" "^$COUNT_BEFORE$"
# The free-text window: open by default, lines that are not claims only
B="{\"file\":\"journal/$TODAY.md\",\"content\":\"  - colour: blue\",\"mode\":\"append\",\"author\":\"scrivener\"}"
check "a line that would change the last record is refused" "$(code POST /api/knowledge "$B")" '^422$'
B="{\"file\":\"journal/$TODAY.md\",\"content\":\"- 12:00 [scrivener] a free-text line in a 0.3 day (fake)\",\"mode\":\"append\",\"author\":\"scrivener\"}"
check "window open: a free-text line is accepted in a 0.3 day" "$(api POST /api/knowledge "$B")" '"bytes"'
B="{\"file\":\"journal/$TODAY.md\",\"content\":\"- [hunch] typed by hand (fake)\",\"mode\":\"append\",\"author\":\"scrivener\"}"
check "an invalid claim line is refused (422)" "$(code POST /api/knowledge "$B")" '^422$'
check "the refusal points to POST /api/journal" "$(api POST /api/knowledge "$B")" 'POST /api/journal'
check "and neither reached the day" "$(api GET "/api/knowledge?file=journal/$TODAY.md" | grep -c 'typed by hand\|colour' || true)" '^0$'
MW=$(mcpcall write_knowledge "{\"file\":\"journal/$TODAY.md\",\"content\":\"- [fact] typed over MCP (fake)\",\"mode\":\"append\"}")
check "MCP write_knowledge meets the same rule" "$(mcp "$MW")" 'POST /api/journal'
check "settings take journal_free_text" "$(api PATCH /api/settings '{"global":{"journal_free_text":false}}')" '"journal_free_text": false'
check "journal_free_text is true or false" "$(api PATCH /api/settings '{"global":{"journal_free_text":"no"}}')" 'true or false'
B='{"file":"journal/2026-01-05.md","content":"- 12:00 [scrivener] after the window (fake)","mode":"append","author":"scrivener"}'
check "window closed: an agent's journal write is refused (403)" "$(code POST /api/knowledge "$B")" '^403$'
check "with the pointer to POST /api/journal" "$(api POST /api/knowledge "$B")" 'POST /api/journal'
B='{"file":"journal/2026-01-05.md","content":"- 12:00 [boss] the boss writes as he likes (fake)","mode":"append","author":"human"}'
check "window closed: the boss still writes the journal" "$(api POST /api/knowledge "$B")" '"bytes"'
check "window closed: capture still works" "$(api POST /api/journal '{"agent":"scrivener","kind":"fact","text":"captured after the window (fake)","evidence":"y"}')" '"by": "scrivener"'
api PATCH /api/settings '{"global":{"journal_free_text":null}}' > /dev/null
# A block nobody can read is listed, never dropped: the boss's hand plants one
B="{\"file\":\"journal/$TODAY.md\",\"content\":\"- [hunch] planted by hand (fake)\",\"mode\":\"append\",\"author\":\"human\"}"
api POST /api/knowledge "$B" > /dev/null
JI=$(api GET "/api/journal?day=$TODAY")
check "an invalid block is reported in invalid" "$JI" '"code": "E_KIND"'
check "with its file" "$JI" "\"file\": \"journal/$TODAY.md\""
check "and is not a record" "$(echo "$JI" | grep -c '"text": "planted by hand' || true)" '^0$'
# MCP capture, as consul
check "MCP lists capture" "$(mcp '{"jsonrpc":"2.0","id":60,"method":"tools/list"}')" '"name": "capture"'
check "the MCP instructions point at capture" "$(mcp '{"jsonrpc":"2.0","id":61,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"conformance","version":"0"}}}')" 'record it with capture'
MC=$(mcpcall capture '{"kind":"preference","text":"approve in the chat, not twice (fake)","evidence":"the boss, in session","confidence":"stated"}')
MCR=$(mcp "$MC")
check "MCP capture writes a record" "$MCR" '"isError": false'
check "as consul" "$MCR" '\\"by\\": \\"consul\\"'
check "and GET reads it back" "$(api GET '/api/journal?author=consul&kind=preference')" 'approve in the chat, not twice'
MC=$(mcpcall capture '{"kind":"fact","text":"no evidence (fake)"}')
check "MCP capture refuses what the route refuses" "$(mcp "$MC")" 'E_EVIDENCE'
api PATCH "/api/tasks/$JM" '{"agent":"scrivener","status":"done","note":"probe"}' > /dev/null
api PATCH "/api/tasks/$JM2" '{"agent":"scrivener","status":"done","note":"probe"}' > /dev/null

echo "16. memory health: drift measured by the hub, one JSON for the route and MCP"
hv () { # hv <json> <dotted.path>: one value from a JSON body
  node -e 'const o=JSON.parse(process.argv[1]);const v=process.argv[2].split(".").reduce((a,k)=>a==null?a:a[k],o);console.log(typeof v==="object"?JSON.stringify(v):v)' "$1" "$2"
}
MH=$(api GET /api/memory/health)
for k in status reasons lint journal approved_unapplied stale contradictions provenance reads computed_at; do
  check "the health block carries $k" "$MH" "\"$k\": "
done
check "reads are not tracked yet, and say so" "$(hv "$MH" reads)" '^{"tracked":false}$'
# The boss's hand cleans what earlier sections left on purpose: the note
# forced past lint (12b) and the block planted in today's journal (15).
B='{"file":"knowledge/lint-bad.md","author":"human","content":"---\ntitle: Lint bad\ncompartment: knowledge\npermalink: lint-bad\nversion: 1\n---\n\n- [fact] now it has a source (source: t-1)\n"}'
api POST /api/knowledge "$B" > /dev/null
B=$(curl -s "$BUREAU_URL/api/knowledge?file=journal/$TODAY.md&raw=1" -H "$AUTH" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({file:process.argv[1],author:"human",content:s.split("\n").filter(l=>!l.includes("planted by hand")).join("\n")})))' "journal/$TODAY.md")
api POST /api/knowledge "$B" > /dev/null
MH=$(api GET /api/memory/health)
check "a clean brain: status ok" "$(hv "$MH" status)" '^ok$'
check "with no reasons" "$(hv "$MH" reasons)" '^\[\]$'
check "and 0 lint errors" "$(hv "$MH" lint.errors)" '^0$'
check "the week's captures are counted by kind" "$(hv "$MH" journal.by_kind.fact)" '^[1-9]'
check "and by author" "$(hv "$MH" journal.by_author.scrivener)" '^[1-9]'
# Provenance: a small hand-made set, counted as a difference
P_OWN=$(hv "$MH" provenance.own); P_FILE=$(hv "$MH" provenance.file); P_NONE=$(hv "$MH" provenance.none)
B='{"file":"knowledge/health-own.md","author":"human","content":"---\ntitle: Health own\ncompartment: knowledge\npermalink: health-own\nversion: 1\n---\n\n- [fact] the plant wants water on Mondays (fake) (source: t-1)\n- [fact] the plant dislikes the radiator (fake) (source: t-2)\n"}'
api POST /api/knowledge "$B" > /dev/null
B='{"file":"knowledge/health-file.md","author":"human","content":"---\ntitle: Health file\ncompartment: knowledge\npermalink: health-file\nversion: 1\nsource: t-1\n---\n\n- [fact] the lamp has its own source (fake) (source: t-3)\n- [fact] the lamp is covered by the file (fake)\n- [step] switch the lamp off at six (fake)\n"}'
api POST /api/knowledge "$B" > /dev/null
B='{"file":"knowledge/health-bad.md","author":"human","force":true,"content":"---\ntitle: Health bad\ncompartment: knowledge\npermalink: health-bad\nversion: 1\n---\n\n- [fact] nobody knows where this came from either (fake)\n"}'
check "the boss forces an unsourced note past lint" "$(api POST /api/knowledge "$B")" '"forced"'
MH=$(api GET /api/memory/health)
check "a forced note that fails lint: status attention" "$(hv "$MH" status)" '^attention$'
check "with the lint reason" "$(hv "$MH" reasons)" 'lint error'
check "and its message" "$(hv "$MH" lint.messages)" 'knowledge/health-bad.md: unsourced observation'
check "provenance: 3 more claims with their own source" "$(( $(hv "$MH" provenance.own) - P_OWN ))" '^3$'
check "2 more covered only by the file's source" "$(( $(hv "$MH" provenance.file) - P_FILE ))" '^2$'
check "1 more with none" "$(( $(hv "$MH" provenance.none) - P_NONE ))" '^1$'
check "and a percentage with any source" "$(hv "$MH" provenance.sourced_pct)" '^[0-9.]*$'
B='{"file":"knowledge/health-bad.md","author":"human","content":"---\ntitle: Health bad\ncompartment: knowledge\npermalink: health-bad\nversion: 1\n---\n\n- [fact] now the boss knows (fake) (source: t-4)\n"}'
api POST /api/knowledge "$B" > /dev/null
check "fixed, the write drops the cache: ok again" "$(hv "$(api GET /api/memory/health)" status)" '^ok$'
# Freshness and contradictions: long-form claims with their own fields
B='{"file":"knowledge/health-fresh.md","author":"human","content":"---\ntitle: Health fresh\ncompartment: knowledge\npermalink: health-fresh\nversion: 1\nsource: t-1\nformat: 0.3\n---\n\n- [fact] the kettle costs 30 coins (fake) ^c-hk0001\n  - volatility: volatile\n  - verified: 2020-01-01\n- [fact] the kettle costs 31 coins (fake) ^c-hk0002\n  - volatility: volatile\n  - verified: 2099-01-01\n  - contradicts: c-hk0001\n- [fact] water boils at 100 degrees here (fake) ^c-hk0003\n  - volatility: durable\n  - verified: 2000-01-01\n- [fact] the kettle is blue (fake) ^c-hk0004\n  - volatility: volatile\n"}'
check "a 0.3 note with its own freshness fields is written" "$(api POST /api/knowledge "$B")" '"bytes"'
MH=$(api GET /api/memory/health)
STALE=$(hv "$MH" stale.claims)
check "a volatile claim verified long ago is stale" "$STALE" '"id":"c-hk0001"'
check "with its file and age" "$STALE" '"file":"knowledge/health-fresh.md","line":[0-9]*,"id":"c-hk0001","volatility":"volatile","verified":"2020-01-01","age_days":[0-9]'
check "a durable claim never is" "$(echo "$STALE" | grep -c 'c-hk0003' || true)" '^0$'
check "nor a fresh one" "$(echo "$STALE" | grep -c 'c-hk0002' || true)" '^0$'
check "a volatile claim with no verified date is counted as undated" "$(hv "$MH" stale.undated)" '^[1-9]'
check "a contradiction is listed with both ids" "$(hv "$MH" contradictions)" '"id":"c-hk0002","contradicts":"c-hk0001"'
check "stale claims alone do not call for attention" "$(hv "$MH" status)" '^ok$'
# An approved mission with a payload nobody applied yet
H1=$(tid "$(api POST /api/tasks '{"title":"Health: unapplied payload","project":"ops","priority":5,"gate":"critic"}')")
B="{\"agent\":\"menace\",\"id\":\"$H1\"}"
api POST /api/tasks/claim "$B" > /dev/null
api PATCH "/api/tasks/$H1" '{"agent":"menace","items":[{"title":"Log the plant","payload":{"ops":[{"op":"append","file":"projects/ops/health-log.md","content":"- plant watered (fake)"}]}}]}' > /dev/null
api PATCH "/api/tasks/$H1" '{"agent":"menace","status":"review","after_approval":"return"}' > /dev/null
check "approved, back with its holder" "$(api PATCH "/api/tasks/$H1" '{"agent":"human","status":"done","verdicts":[{"id":"i1","verdict":"approved"}]}')" '"status": "approved"'
AU=$(hv "$(api GET /api/memory/health)" approved_unapplied)
check "the approved mission shows under approved_unapplied" "$AU" "\"id\":\"$H1\""
check "with its unapplied item and how long it has waited" "$AU" '"items":\["i1"\],"approved_at":"[^"]*","waiting_hours":[0-9]'
check "a fresh wait is not overdue" "$AU" '"overdue":false'
check "nor a reason for attention" "$(hv "$(api GET /api/memory/health)" status)" '^ok$'
api POST "/api/tasks/$H1/apply" '{"agent":"menace","item":"i1"}' > /dev/null
check "applied, it leaves the list" "$(hv "$(api GET /api/memory/health)" approved_unapplied)" '^\[\]$'
api PATCH "/api/tasks/$H1" '{"agent":"menace","status":"done","note":"applied"}' > /dev/null
# A v0.3 journal day with a block nobody can read, by the boss's hand
B='{"file":"journal/2020-01-02.md","author":"human","content":"---\ntitle: Journal 2020-01-02\ncompartment: journal\nformat: 0.3\n---\n\n- [fact] a record without its evidence (fake) ^j-hlth0001\n  - by: human\n  - at: 2020-01-02T10:00Z\n"}'
api POST /api/knowledge "$B" > /dev/null
MH=$(api GET /api/memory/health)
check "a broken journal block shows under invalid" "$(hv "$MH" journal.invalid)" '"file":"journal/2020-01-02.md","line":7'
check "with its error" "$(hv "$MH" journal.invalid)" 'E_EVIDENCE'
check "and makes status attention" "$(hv "$MH" status)" '^attention$'
check "with the unreadable reason" "$(hv "$MH" reasons)" 'unreadable journal block'
check "MCP lists memory_health" "$(mcp '{"jsonrpc":"2.0","id":70,"method":"tools/list"}')" '"name": "memory_health"'
MHM=$(mcp "$(mcpcall memory_health '{}')")
check "MCP memory_health answers" "$MHM" '"isError": false'
check "with the same status as the route" "$MHM" "\\\\\"status\\\\\": \\\\\"$(hv "$MH" status)\\\\\""
check "the route is behind the token" "$(curl -s -o /dev/null -w '%{http_code}' "$BUREAU_URL/api/memory/health")" '^401$'

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ] && echo "CONFORMANT: the hub is fully drivable by curl." || echo "NOT CONFORMANT."
exit $FAIL
