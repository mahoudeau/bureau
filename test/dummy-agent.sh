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
check "claiming under that same string only works via the normal claim path" "$(api POST /api/tasks/claim "{\"agent\":\"phantom-crew-1\",\"id\":\"$GHOSTID\"}")" '"claimed"'
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
TI=$(api POST /api/tasks '{"title":"Curation proposals","project":"ops","priority":2}')
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

echo "8. lease expiry re-queues abandoned work"
T2=$(api POST /api/tasks '{"title":"Water the plastic plant","priority":3}')
T2ID=$(echo "$T2" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$T2ID\",\"lease_minutes\":0.03}" > /dev/null
sleep 3
check "expired lease returns to queue" "$(api GET '/api/tasks?status=queued')" "\"id\": \"$T2ID\""
check "non-cowork expiry keeps the reservation" "$(api GET "/api/tasks/$T2ID")" '"reserved_for": "menace"'
# Unified reservations: cowork holders keep their mission only for the TTL.
# The lapse check needs a hub started with a tiny BUREAU_RESERVATION_TTL_MIN (the
# local runner sets 0.02 = 1.2s); against a default hub it would wait 30 minutes.
api POST /api/agents/register '{"name":"shifty","kind":"cowork"}' > /dev/null
T3=$(api POST /api/tasks '{"title":"Straighten the office plants","priority":1}')
T3ID=$(echo "$T3" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"shifty\",\"id\":\"$T3ID\",\"lease_minutes\":0.03}" > /dev/null
sleep 3
api GET /api/tasks > /dev/null
check "cowork expiry reserves for the shift worker too" "$(api GET "/api/tasks/$T3ID")" '"reserved_for": "shifty"'
sleep 2
check "lapsed cowork reservation returns to the pool" "$(api POST /api/tasks/claim '{"agent":"worker-x"}')" "\"id\": \"$T3ID\""
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$T2ID\"}" > /dev/null
api PATCH "/api/tasks/$T2ID" '{"agent":"menace","status":"done","note":"plant watered"}' > /dev/null
api PATCH "/api/tasks/$T3ID" '{"agent":"worker-x","status":"done","note":"plants straightened"}' > /dev/null

echo "8c. the gate: boss-gate reviews move only by the boss's hand"
TG=$(api POST /api/tasks '{"title":"Gate check mission","project":"ops","priority":2}')
TGID=$(echo "$TG" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
check "gate defaults to boss" "$TG" '"gate": "boss"'
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TGID\"}" > /dev/null
api PATCH "/api/tasks/$TGID" '{"agent":"menace","status":"review","note":"parked"}' > /dev/null
check "agent cannot close a boss-gate review" "$(api PATCH "/api/tasks/$TGID" '{"agent":"moneta","status":"done"}')" 'boss-gate'
check "agent cannot set critic gate" "$(api PATCH "/api/tasks/$TGID" '{"agent":"menace","gate":"critic"}')" 'only the boss or ummon'
check "ummon sets critic gate" "$(api PATCH "/api/tasks/$TGID" '{"agent":"ummon","gate":"critic"}')" '"gate": "critic"'
check "critic closes a critic-gate review" "$(api PATCH "/api/tasks/$TGID" '{"agent":"moneta","status":"done","note":"passes the bar"}')" '"done"'
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
check "raw read serves the right content-type" "$(curl -si "$BUREAU_URL/api/knowledge?file=projects/ops/references/pixel.png&raw=1" -H "$AUTH" | tr -d '\r')" 'content-type: image/png'
check "off-whitelist extension refused" "$(api POST /api/knowledge '{"file":"projects/ops/references/tool.exe","content":"x","author":"menace"}')" 'only .md'
PNG_APPEND="{\"file\":\"projects/ops/references/pixel.png\",\"content\":\"$PNG_B64\",\"encoding\":\"base64\",\"mode\":\"append\"}"
check "base64 append refused" "$(api POST /api/knowledge "$PNG_APPEND")" 'replace-only'
TE=$(api POST /api/tasks '{"title":"Evidence renders inline","project":"ops","priority":2}')
TEID=$(echo "$TE" | grep -o '"id": "t-[0-9]*"' | head -1 | grep -o 't-[0-9]*')
api POST /api/tasks/claim "{\"agent\":\"menace\",\"id\":\"$TEID\"}" > /dev/null
api PATCH "/api/tasks/$TEID" '{"agent":"menace","artifact":{"label":"screenshot","url":"projects/ops/references/pixel.png"},"status":"review","note":"evidence attached"}' > /dev/null
EV_TOKEN=$(api GET "/api/tasks/$TEID" | grep -A2 '"approve"' | grep -o '"token": "[a-f0-9]*"' | grep -o '[a-f0-9]\{32\}')
check "review page renders evidence inline" "$(curl -s "$BUREAU_URL/r/$EV_TOKEN")" '<img src="/r/'
check "capability image route serves the bytes" "$(curl -si "$BUREAU_URL/r/$EV_TOKEN/img?file=projects/ops/references/pixel.png" | tr -d '\r')" 'content-type: image/png'
check "bad capability gets no image" "$(curl -s -o /dev/null -w '%{http_code}' "$BUREAU_URL/r/00000000000000000000000000000000/img?file=projects/ops/references/pixel.png")" '404'
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
check "claim by id bypasses capacity" "$(api POST /api/tasks/claim "{\"agent\":\"worker-c\",\"id\":\"$BBID\"}")" '"claimed"'
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
mcp "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"update_mission\",\"arguments\":{\"id\":\"$MID\",\"items\":[{\"title\":\"Oil the hinges\"}]}}}" > /dev/null
check "items filed over MCP" "$(api GET "/api/tasks/$MID")" 'Oil the hinges'
mcp "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"update_mission\",\"arguments\":{\"id\":\"$MID\",\"status\":\"done\",\"note\":\"hinges fine\"}}}" > /dev/null
check "bad capability token is 404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${MURL%/*}/000000000000000000000000000000000000000000000000" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":9,"method":"ping"}')" '404'

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ] && echo "CONFORMANT: the hub is fully drivable by curl." || echo "NOT CONFORMANT."
exit $FAIL
